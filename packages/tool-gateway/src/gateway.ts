// Gateway Service — Core execution pipeline with 8 security gates
// Issue #219

import path from 'node:path';
import fs from 'node:fs';
import { redactSecrets } from '@positron/shared';
import type { ToolRegistry } from './registry.js';
import type { BlockReason, GatewayConfig, ToolCall, ToolDefinition, ToolResult } from './types.js';
import { BLOCK_REASONS, DEFAULT_GATEWAY_CONFIG } from './types.js';

/**
 * Result with timing information.
 */
interface TimedResult extends ToolResult {
	durationMs: number;
}

/**
 * Helper to create a blocked result.
 */
function blocked(reason: BlockReason, detail?: string): ToolResult {
	return {
		success: false,
		output: null,
		blockedReason: `${reason}${detail ? `: ${detail}` : ''}`,
	};
}

/**
 * GatewayService — validates, authorizes, executes, and logs tool calls.
 *
 * Security pipeline (8 gates):
 * 1. Gateway enabled check
 * 2. Schema validation (input against inputSchema)
 * 3. Tool lookup (registry allowlist)
 * 4. Phase check (allowedPhases)
 * 5. Autonomy check (requiredAutonomyLevel vs run level)
 * 6. Approval check (riskLevel + approvalMode)
 * 7. Workspace boundary check (path resolution)
 * 8. Egress check (network target validation)
 *
 * Post-execution: secret redaction, evidence generation, result assembly.
 */
export class GatewayService {
	private config: GatewayConfig;
	private registry: ToolRegistry;

	/**
	 * Optional callback for evidence event creation.
	 * Set by the server integration layer.
	 */
	public onEvidence: ((call: ToolCall, result: TimedResult) => Promise<string>) | null = null;

	/**
	 * Optional pre-execution audit callback.
	 * Called BEFORE tool execution when requiresAuditLog is true.
	 * Returns an evidence event ID string.
	 * Throws if audit/evidence write fails.
	 * Set by the server integration layer.
	 */
	public onAudit: ((call: ToolCall) => Promise<string>) | null = null;

	/**
	 * Optional approval check callback.
	 * If set, called when a tool requires approval.
	 * Should return true if approved, false if denied.
	 */
	public onApprovalCheck: ((toolId: string, call: ToolCall) => Promise<boolean>) | null = null;

	constructor(registry: ToolRegistry, config?: Partial<GatewayConfig>) {
		this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
		this.registry = registry;
	}

	/**
	 * Execute a tool call through the full security pipeline.
	 */
	async execute(call: ToolCall): Promise<ToolResult> {
		const startTime = Date.now();

		try {
			// Gate 1: Gateway enabled
			if (!this.config.enabled) {
				return blocked(BLOCK_REASONS.GATEWAY_DISABLED);
			}

			// Gate 2: Schema validation
			const schemaResult = this.validateSchema(call);
			if (!schemaResult.ok) {
				return blocked(BLOCK_REASONS.SCHEMA_VALIDATION_FAILED, schemaResult.error);
			}

			// Gate 3: Tool lookup
			const entry = this.registry.get(call.toolId);
			if (!entry) {
				return blocked(BLOCK_REASONS.TOOL_NOT_FOUND, call.toolId);
			}

			const def = entry.definition;

			// Gate 4: Phase check
			if (def.allowedPhases.length > 0 && !def.allowedPhases.includes(call.phase)) {
				return blocked(
					BLOCK_REASONS.PHASE_NOT_ALLOWED,
					`Tool "${call.toolId}" not allowed in phase "${call.phase}"`,
				);
			}

			// Gate 5: Autonomy check
			if (call.autonomyLevel < def.requiredAutonomyLevel) {
				return blocked(
					BLOCK_REASONS.AUTONOMY_TOO_LOW,
					`Tool requires autonomy ${def.requiredAutonomyLevel}, run has ${call.autonomyLevel}`,
				);
			}

			// Gate 6: Approval check
			if (def.approvalMode !== 'none') {
				if (this.onApprovalCheck) {
					try {
						const approved = await this.onApprovalCheck(call.toolId, call);
						if (!approved) {
							return blocked(
								BLOCK_REASONS.APPROVAL_REQUIRED,
								`Tool "${call.toolId}" requires approval`,
							);
						}
					} catch (approvalError) {
						// If the approval callback throws, treat as denial (fail-closed)
						return blocked(
							BLOCK_REASONS.APPROVAL_REQUIRED,
							`Tool "${call.toolId}" approval check failed: ${approvalError instanceof Error ? approvalError.message : String(approvalError)}`,
						);
					}
				} else {
					// No approval callback configured — block ALL non-none approval modes.
					// This includes both "human_required" and "ask". Tools requiring
					// approval MUST have an onApprovalCheck handler configured.
					return blocked(
						BLOCK_REASONS.APPROVAL_REQUIRED,
						`Tool "${call.toolId}" requires approval (no approval handler configured, mode: ${def.approvalMode})`,
					);
				}
			}

			// Gate 7: Workspace boundary check (for file operations)
			if (this.config.enforcePathBoundaries) {
				const pathResult = this.validateWorkspaceBoundary(call, def);
				if (!pathResult.ok) {
					return blocked(BLOCK_REASONS.PATH_TRAVERSAL, pathResult.error);
				}
			}

			// Gate 8: Egress check
			if (this.config.enforceEgress) {
				const egressResult = this.validateEgress(call, def);
				if (!egressResult.ok) {
					return blocked(BLOCK_REASONS.EGRESS_BLOCKED, egressResult.error);
				}
			}

			// Gate 9: Audit enforcement (requiresAuditLog)
			// MUST come after all other gates so sealed/default-deny remains stronger.
			// If the tool definition requires audit logging, we enforce that an
			// audit/evidence sink is available and that it writes successfully
			// BEFORE the tool executes.
			let auditEvidenceId: string | undefined;

			if (def.requiresAuditLog === true) {
				if (!this.onAudit) {
					return blocked(
						BLOCK_REASONS.AUDIT_LOG_MISSING,
						`Tool "${call.toolId}" requires audit log but no audit callback is configured`,
					);
				}

				try {
					auditEvidenceId = await this.onAudit(call);
				} catch (auditError) {
					return blocked(
						BLOCK_REASONS.AUDIT_LOG_MISSING,
						`Tool "${call.toolId}" audit log write failed: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
					);
				}
			}

			// Execute the tool handler
			const result = await entry.handler(call);

			// If handler returned a blocked result, pass it through
			if (!result.success && result.blockedReason) {
				return result;
			}

			const durationMs = Date.now() - startTime;
			const timedResult: TimedResult = {
				...result,
				durationMs,
				evidenceEventId: auditEvidenceId,
			};

			// Post-execution: secret redaction
			if (this.config.redactSecrets) {
				timedResult.output = this.redactOutput(timedResult.output);
			}

			// Generate evidence event (post-execution)
			// May override the pre-execution audit evidence ID
			if (this.onEvidence) {
				timedResult.evidenceEventId = await this.onEvidence(call, timedResult);
			}

			return timedResult;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const durationMs = Date.now() - startTime;
			return {
				success: false,
				output: null,
				error: errorMessage,
				blockedReason: BLOCK_REASONS.TOOL_EXECUTION_ERROR,
				durationMs,
				evidenceEventId: undefined,
			};
		}
	}

	/**
	 * Gate 2: Validate input arguments against tool's inputSchema.
	 *
	 * For now, performs structural validation:
	 * - Checks required fields are present (using JSON Schema-like logic)
	 * - Checks types match expected types
	 *
	 * In a future iteration, full JSON Schema validation can be added.
	 */
	private validateSchema(call: ToolCall): { ok: boolean; error?: string } {
		const entry = this.registry.get(call.toolId);
		if (!entry) {
			// Tool lookup failure handled by Gate 3
			return { ok: true };
		}

		const schema = entry.definition.inputSchema;

		// Check required fields
		if (schema.required && Array.isArray(schema.required)) {
			for (const field of schema.required as string[]) {
				if (!(field in call.arguments)) {
					return {
						ok: false,
						error: `Missing required field: "${field}"`,
					};
				}
			}
		}

		// Check properties types if specified
		if (schema.properties && typeof schema.properties === 'object') {
			const props = schema.properties as Record<string, Record<string, unknown>>;
			for (const [key, propSchema] of Object.entries(props)) {
				if (key in call.arguments) {
					const value = call.arguments[key];
					const expectedType = propSchema.type as string | undefined;

					if (expectedType) {
						const actualType = Array.isArray(value) ? 'array' : typeof value;
						if (actualType !== expectedType) {
							return {
								ok: false,
								error: `Field "${key}": expected type "${expectedType}", got "${actualType}"`,
							};
						}
					}

					// Check maxLength for strings
					if (
						expectedType === 'string' &&
						typeof value === 'string' &&
						propSchema.maxLength !== undefined
					) {
						const maxLen = propSchema.maxLength as number;
						if (value.length > maxLen) {
							return {
								ok: false,
								error: `Field "${key}": max length ${maxLen}, got ${value.length}`,
							};
						}
					}
				}
			}
		}

		return { ok: true };
	}

	/**
	 * Gate 7: Validate file paths are within workspace boundaries.
	 *
	 * Resolves paths and checks they fall within the workspace root.
	 * Blocks absolute paths, parent directory traversal, and symlink escapes.
	 */
	private validateWorkspaceBoundary(
		call: ToolCall,
		def: ToolDefinition,
	): { ok: boolean; error?: string } {
		// Look for file path arguments
		const pathKeys = ['path', 'filePath', 'file', 'directory', 'dir'];
		let targetPath: string | undefined;

		for (const key of pathKeys) {
			const val = call.arguments[key];
			if (typeof val === 'string' && val.length > 0) {
				targetPath = val;
				break;
			}
		}

		// If no path argument found, boundary check is not applicable
		if (!targetPath) {
			return { ok: true };
		}

		// Check allowedWorkspaceRoots from tool definition
		if (def.allowedWorkspaceRoots && def.allowedWorkspaceRoots.length > 0) {
			const resolvedRoot = path.resolve(call.workspaceRoot);
			const isAllowed = def.allowedWorkspaceRoots.some((allowedRoot) => {
				const resolvedAllowed = path.resolve(allowedRoot);
				return this.isRealPathWithinRoot(resolvedRoot, resolvedAllowed);
			});
			if (!isAllowed) {
				return {
					ok: false,
					error: `Workspace root "${call.workspaceRoot}" not in tool's allowed workspace roots`,
				};
			}
		}

		// Block absolute paths (unless they start with workspace root)
		if (path.isAbsolute(targetPath)) {
			const normalizedWorkspace = path.resolve(call.workspaceRoot);
			const normalizedTarget = path.resolve(targetPath);

			if (
				!this.isWithinRoot(normalizedTarget, normalizedWorkspace) ||
				!this.isRealPathWithinRoot(normalizedTarget, normalizedWorkspace)
			) {
				return {
					ok: false,
					error: `Absolute path "${targetPath}" is outside workspace root`,
				};
			}
			return { ok: true };
		}

		// Resolve the path against workspace root
		const resolved = path.resolve(call.workspaceRoot, targetPath);
		const normalizedRoot = path.resolve(call.workspaceRoot);

		// Block if resolved path is outside workspace root
		if (
			!this.isWithinRoot(resolved, normalizedRoot) ||
			!this.isRealPathWithinRoot(resolved, normalizedRoot)
		) {
			return {
				ok: false,
				error: `Path "${targetPath}" resolves outside workspace root`,
			};
		}

		// Block if path contains parent directory traversal patterns
		if (targetPath.includes('..')) {
			// Additional check: validate each segment
			const segments = targetPath.split(/[/\\]/);
			let depth = 0;
			for (const segment of segments) {
				if (segment === '..') {
					depth--;
					if (depth < 0) {
						return {
							ok: false,
							error: `Path traversal detected: "${targetPath}" escapes workspace root`,
						};
					}
				} else if (segment !== '.' && segment !== '') {
					depth++;
				}
			}
		}

		// Block if max path depth exceeded (symlink loop protection)
		// Split by both Unix and Windows separators for cross-platform correctness
		const depth = resolved.split(/[/\\]/).filter(Boolean).length;
		const rootSegments = normalizedRoot.split(/[/\\]/).filter(Boolean).length;
		if (depth > this.config.maxPathDepth + rootSegments) {
			return {
				ok: false,
				error: `Path depth ${depth} exceeds maximum ${this.config.maxPathDepth}`,
			};
		}

		return { ok: true };
	}

	private isWithinRoot(candidate: string, root: string): boolean {
		return candidate === root || candidate.startsWith(`${root}${path.sep}`);
	}

	private isRealPathWithinRoot(candidate: string, root: string): boolean {
		try {
			if (!fs.existsSync(root))
				return this.isWithinRoot(path.resolve(candidate), path.resolve(root));
			const realRoot = fs.realpathSync.native(root);
			let existingAncestor = candidate;
			while (!fs.existsSync(existingAncestor)) {
				const parent = path.dirname(existingAncestor);
				if (parent === existingAncestor) return false;
				existingAncestor = parent;
			}
			const realAncestor = fs.realpathSync.native(existingAncestor);
			const realCandidate = path.resolve(realAncestor, path.relative(existingAncestor, candidate));
			return this.isWithinRoot(realCandidate, realRoot);
		} catch {
			return false;
		}
	}

	/**
	 * Gate 8: Validate network egress against tool's egress policy.
	 *
	 * Recursively scans ALL string values in the tool call arguments for
	 * URL-like patterns. This prevents bypass via unconventional key names
	 * (e.g., "destination", "callback", "webhook") or nested objects/arrays.
	 */
	private validateEgress(call: ToolCall, def: ToolDefinition): { ok: boolean; error?: string } {
		const egress = def.egressPolicy;

		// Collect all string values from arguments recursively
		const stringValues = this.collectStringValues(call.arguments);

		for (const value of stringValues) {
			// Attempt to extract a hostname from the string
			const hostname = this.extractHostname(value);
			if (!hostname) continue; // Not a URL-like string

			// If no allowed hosts configured, block all network access
			if (!egress.allowedHosts || egress.allowedHosts.length === 0) {
				return {
					ok: false,
					error: `Network access to "${hostname}" blocked: no egress policy configured for tool "${call.toolId}"`,
				};
			}

			// Check if hostname matches any allowed host
			const allowed = egress.allowedHosts.some(
				(allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
			);

			if (!allowed) {
				return {
					ok: false,
					error: `Network access to "${hostname}" blocked: not in allowed egress hosts for tool "${call.toolId}"`,
				};
			}
		}

		return { ok: true };
	}

	/**
	 * Recursively collect all string values from an arbitrary object/array.
	 * This ensures egress scanning finds URLs regardless of their key name
	 * or nesting depth.
	 */
	private collectStringValues(obj: unknown): string[] {
		const results: string[] = [];

		if (typeof obj === 'string') {
			results.push(obj);
		} else if (Array.isArray(obj)) {
			for (const item of obj) {
				results.push(...this.collectStringValues(item));
			}
		} else if (obj && typeof obj === 'object') {
			for (const value of Object.values(obj as Record<string, unknown>)) {
				results.push(...this.collectStringValues(value));
			}
		}

		return results;
	}

	/**
	 * Extract a hostname from a string that may be a URL or hostname.
	 * Returns null if the string doesn't look like a network target.
	 */
	private extractHostname(value: string): string | null {
		// Skip values that are clearly not URLs (short strings, file paths)
		if (value.length < 4) return null;

		// Skip values that look like filesystem paths (drive letters, relative,
		// absolute, or path-like patterns with slashes and no URL scheme)
		if (/^[a-zA-Z]:[\\/]/.test(value)) return null; // Windows drive path
		if (/^\.{1,2}[\\/]/.test(value)) return null; // Relative path ./ or ../
		if (/^[\\/]/.test(value)) return null; // Absolute Unix path /...

		// If the value contains slashes but no scheme, it's likely a filesystem
		// path, not a URL. Only proceed if it has an explicit URL scheme.
		const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
		if (!hasScheme && /[/\\]/.test(value)) {
			// Contains path separators but no scheme — skip (likely a file path)
			return null;
		}

		// Skip semver-like strings (e.g., "1.0.0") which the URL parser
		// may expand into fake IPv4 addresses like "1.0.0.0".
		// A real IPv4 address always has 4 octets; 3-part dotted numbers
		// are version strings, not network targets.
		if (/^\d+\.\d+\.\d+$/.test(value)) return null;

		// Try to parse as URL
		try {
			const parsed = new URL(
				value.startsWith('http') || value.startsWith('ftp') ? value : `https://${value}`,
			);
			// Only return hostname if it looks like a real hostname:
			// - Contains a dot (or is localhost)
			// - Is not a semver string (must contain at least one letter OR look like an IP address)
			const hostname = parsed.hostname;
			if (!hostname) return null;
			if (hostname === 'localhost') return hostname;
			if (!hostname.includes('.')) return null;

			// Accept: contains letters (hostname) OR is a dotted numeric IP address
			// But exclude 3-part semver patterns like "1.0.0" which are
			// never valid network targets but get expanded by URL parser
			const isHostname = /[a-zA-Z]/.test(hostname);
			const isIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
			if (isHostname || isIP) {
				return hostname;
			}
			return null;
		} catch {
			// Not a valid URL — check if it looks like a bare hostname
			// Must contain at least one letter to exclude numeric version strings
			if (
				/[a-zA-Z]/.test(value) &&
				/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
					value,
				)
			) {
				return value;
			}
			return null;
		}
	}

	/**
	 * Redact secrets from tool output before logging.
	 */
	private redactOutput(output: unknown): unknown {
		if (typeof output === 'string') {
			return redactSecrets(output);
		}
		if (output && typeof output === 'object') {
			try {
				const json = JSON.stringify(output);
				const redacted = redactSecrets(json);
				return JSON.parse(redacted);
			} catch {
				return output;
			}
		}
		return output;
	}

	/**
	 * Update gateway configuration at runtime.
	 */
	updateConfig(partial: Partial<GatewayConfig>): void {
		this.config = { ...this.config, ...partial };
	}

	/**
	 * Get current gateway configuration (read-only copy).
	 */
	getConfig(): Readonly<GatewayConfig> {
		return { ...this.config };
	}

	/**
	 * Get the underlying tool registry.
	 */
	getRegistry(): ToolRegistry {
		return this.registry;
	}
}
