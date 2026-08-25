// MCP-Compatible Internal Tool Gateway — Public API
// Issue #219

export type { AuditEntry, AuditSinkOptions } from './audit-sink.js';
// ─── Audit Sink ──────────────────────────────────────────────────────
export { createAuditSink, createBlockedAuditEntry, hashAuditEntry } from './audit-sink.js';
// ─── Gateway ─────────────────────────────────────────────────────────
export { GatewayService } from './gateway.js';
export type {
	MCPCallToolParams,
	MCPCallToolResult,
	MCPListToolsResult,
	MCPTool,
} from './mcp-adapter.js';
// ─── MCP Adapter ─────────────────────────────────────────────────────
export {
	createMcpAdapter,
	MCPAdapter,
} from './mcp-adapter.js';
// ─── Registry ────────────────────────────────────────────────────────
export {
	RegistrySealedError,
	ToolAlreadyRegisteredError,
	ToolNotFoundError,
	ToolRegistry,
} from './registry.js';
// ─── Scanner ─────────────────────────────────────────────────────────
export { scanToolDefinition } from './scanner.js';
export type { EvidenceItem } from './tools/evidence.js';
export {
	evidenceAppendDef,
	evidenceAppendHandler,
} from './tools/evidence.js';
export {
	githubCommentEvidenceDraftDef,
	githubCommentEvidenceDraftHandler,
	githubReadIssueDef,
	githubReadIssueHandler,
} from './tools/github.js';
// ─── Built-in Tools ──────────────────────────────────────────────────
export {
	repoGetDiffDef,
	repoGetDiffHandler,
	repoListFilesDef,
	repoListFilesHandler,
	repoReadFileDef,
	repoReadFileHandler,
} from './tools/repo.js';
export {
	testsDetectDef,
	testsDetectHandler,
	testsRunSelectedDef,
	testsRunSelectedHandler,
} from './tools/tests.js';
// ─── Types ───────────────────────────────────────────────────────────
export type {
	ApprovalMode,
	BlockReason,
	EgressPolicy,
	EvidenceConfig,
	GatewayConfig,
	RiskLevel,
	ScanResult,
	ToolCall,
	ToolDefinition,
	ToolHandler,
	ToolResult,
} from './types.js';
export {
	BLOCK_REASONS,
	DEFAULT_GATEWAY_CONFIG,
} from './types.js';
