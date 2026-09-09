// Built-in Tools: Test Operations
// Issue #219
// tests.detect, tests.run_selected

import { execFileSync, execSync } from 'node:child_process';
import type { ToolDefinition, ToolHandler, ToolResult } from '../types.js';

// ─── Tool Definitions ────────────────────────────────────────────────

export const testsDetectDef: ToolDefinition = {
	id: 'tests.detect',
	title: 'Detect Test Commands',
	description:
		'Auto-detect available test commands in the workspace by scanning package.json and config files.',
	inputSchema: {
		type: 'object',
		properties: {},
		required: [],
	},
	outputSchema: {
		type: 'object',
		properties: {
			commands: { type: 'array' },
		},
	},
	riskLevel: 'read',
	requiredAutonomyLevel: 0,
	approvalMode: 'none',
	allowedPhases: [],
	allowedWorkspaceRoots: [],
	egressPolicy: { allowedHosts: [], allowedPorts: [] },
	evidenceRequirements: {
		logArguments: false,
		logOutput: true,
		requireArtifact: false,
	},
};

export const testsRunSelectedDef: ToolDefinition = {
	id: 'tests.run_selected',
	title: 'Run Selected Tests',
	description:
		'Run a specific pre-detected test command from the workspace. Only allows commands that were previously detected by tests.detect.',
	inputSchema: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				maxLength: 512,
				description: 'Exact test command to run (must match a detected command)',
			},
		},
		required: ['command'],
	},
	outputSchema: {
		type: 'object',
		properties: {
			exitCode: { type: 'number' },
			stdout: { type: 'string' },
			stderr: { type: 'string' },
		},
	},
	riskLevel: 'write',
	requiredAutonomyLevel: 1,
	approvalMode: 'ask',
	allowedPhases: [],
	allowedWorkspaceRoots: [],
	egressPolicy: { allowedHosts: [], allowedPorts: [] },
	evidenceRequirements: {
		logArguments: true,
		logOutput: true,
		requireArtifact: true,
	},
};

// ─── Allowed Test Commands (safe list) ───────────────────────────────

/**
 * Pre-approved test command prefixes.
 * Only commands starting with these prefixes are allowed.
 * This prevents shell injection via arbitrary command execution.
 */
const ALLOWED_TEST_PREFIXES = [
	'npm test',
	'npm run test',
	'npx vitest run',
	'npx vitest',
	'npx playwright test',
	'npx jest',
	'pnpm test',
	'pnpm run test',
	'yarn test',
	'yarn run test',
	'node --test',
];

/**
 * Validate that a command matches one of the allowed test prefixes.
 * This is the key defense against shell injection.
 */
function validateTestCommand(command: string): boolean {
	const trimmed = command.trim().toLowerCase();
	if (!trimmed || /[;&|`$<>()[\]{}\\\r\n]/.test(command)) return false;

	for (const prefix of ALLOWED_TEST_PREFIXES) {
		if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
			return true;
		}
	}

	return false;
}

function parseTestCommand(command: string): { executable: string; args: string[] } | null {
	if (!validateTestCommand(command)) return null;
	const tokens = command.trim().split(/\s+/);
	if (tokens.length === 0 || tokens.some((token) => !/^[A-Za-z0-9_./:@+,-]+$/.test(token)))
		return null;
	const [executable, ...args] = tokens;
	const containsAbsoluteOrTraversalPath = args.some(
		(token) =>
			/^\//.test(token) ||
			/^~(?:\/|$)/.test(token) ||
			/^[A-Za-z]:[\\/]/.test(token) ||
			/(^|[\\/])\.\.(?:[\\/]|$)/.test(token) ||
			/(^|=)(?:\/|~(?:\/|$)|[A-Za-z]:[\\/])/.test(token),
	);
	if (containsAbsoluteOrTraversalPath) return null;
	return executable ? { executable, args } : null;
}

// ─── Tool Handlers ───────────────────────────────────────────────────

export const testsDetectHandler: ToolHandler = async (call): Promise<ToolResult> => {
	try {
		const commands: string[] = [];

		// Read package.json for test scripts
		try {
			const pkgJson = execSync(
				'node -e "console.log(JSON.stringify(require(\'./package.json\').scripts || {}))"',
				{
					cwd: call.workspaceRoot,
					encoding: 'utf-8',
					timeout: 10000,
				},
			);
			const scripts = JSON.parse(pkgJson) as Record<string, string>;

			for (const [name, script] of Object.entries(scripts)) {
				if (name.startsWith('test') || name.includes(':test')) {
					commands.push(`npm run ${name}`);
				}
			}
		} catch {
			// package.json not found or no scripts
		}

		// Add fallback if no test scripts found
		if (commands.length === 0) {
			// Check for vitest config
			try {
				execSync('test -f vitest.config.ts || test -f vitest.config.js', {
					cwd: call.workspaceRoot,
					timeout: 5000,
					stdio: 'pipe',
				});
				commands.push('npx vitest run');
			} catch {
				// No vitest config
			}
		}

		if (commands.length === 0) {
			commands.push('npm test');
		}

		return {
			success: true,
			output: { commands },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			output: null,
			error: `Failed to detect tests: ${message}`,
		};
	}
};

export const testsRunSelectedHandler: ToolHandler = async (call): Promise<ToolResult> => {
	const command = call.arguments.command as string;

	try {
		// Security: validate command against allowed prefixes
		const parsed = parseTestCommand(command);
		if (!parsed) {
			return {
				success: false,
				output: null,
				error: `Test command not in allowed list: "${command}"`,
				blockedReason: 'SCHEMA_VALIDATION_FAILED: command not in allowed test prefixes',
			};
		}

		const result = execFileSync(parsed.executable, parsed.args, {
			cwd: call.workspaceRoot,
			encoding: 'utf-8',
			timeout: 120000,
			maxBuffer: 10 * 1024 * 1024,
		});

		return {
			success: true,
			output: {
				exitCode: 0,
				stdout: result,
				stderr: '',
			},
		};
	} catch (error) {
		// execSync throws on non-zero exit, but that's still a valid test result.
		// Also handles cases where command doesn't exist (ENOENT) or other errors.
		if (error && typeof error === 'object') {
			const execError = error as {
				stdout?: Buffer | string;
				stderr?: Buffer | string;
				status?: number;
				code?: string;
			};

			// Handle case where command simply doesn't exist on system
			if (execError.code === 'ENOENT') {
				return {
					success: false,
					output: null,
					error: `Command not found: ${command}`,
				};
			}

			// Handle non-zero exit with potentially available stdout/stderr
			if (execError.stdout != null || execError.stderr != null) {
				return {
					success: true,
					output: {
						exitCode: execError.status ?? 1,
						stdout:
							typeof execError.stdout === 'string'
								? execError.stdout
								: execError.stdout
									? String(execError.stdout)
									: '',
						stderr:
							typeof execError.stderr === 'string'
								? execError.stderr
								: execError.stderr
									? String(execError.stderr)
									: '',
					},
				};
			}
		}

		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			output: null,
			error: `Test execution failed: ${message}`,
		};
	}
};
