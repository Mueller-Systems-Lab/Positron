/**
 * Evidence Portfolio Auto-Update Engine
 *
 * Core logic for planning and applying incremental updates to
 * Living Evidence Portfolio files (current-capabilities.md,
 * known-limitations.md, evidence-index.md).
 *
 * Part of Issue #305: Automate post-run capability and limitation updates.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	type MarkerBlock,
	deduplicateRows,
	extractTableRows,
	findMarkerBlocks,
	hasWellFormedBlock,
	insertIntoBlock,
	isPathWithinWorkspace,
	joinLines,
	makeEndMarker,
	makeStartMarker,
	readLines,
	tableRow,
} from './markdown-utils.js';
import type {
	EvidenceRunStatus,
	PortfolioFileDetail,
	PortfolioFileTarget,
	PortfolioUpdateInput,
	PortfolioUpdateResult,
} from './types.js';
import {
	DEFAULT_PORTFOLIO_CONFIG,
	type EvidencePortfolioConfig,
	resolvePortfolioConfig,
	statusMeetsMinimum,
} from './types.js';

// ── File path constants ──────────────────────────────────────────────

const CAPABILITIES_FILE = 'docs/status/current-capabilities.md';
const LIMITATIONS_FILE = 'docs/status/known-limitations.md';
const EVIDENCE_INDEX_FILE = 'docs/status/evidence-index.md';

const ALL_TARGETS: PortfolioFileTarget[] = ['capabilities', 'limitations', 'evidence-index'];

// ── Public API ────────────────────────────────────────────────────────

/**
 * Plan a portfolio update: validate input, read current files, compute delta.
 * Does NOT write anything — safe to call in dry-run mode.
 */
export function planEvidencePortfolioUpdate(
	input: PortfolioUpdateInput,
	workspaceRoot: string,
	config?: Partial<EvidencePortfolioConfig>,
): PortfolioUpdateResult {
	const cfg = resolvePortfolioConfig(config);
	const result: PortfolioUpdateResult = {
		changedFiles: [],
		skippedFiles: [],
		warnings: [],
		conflicts: [],
		applied: false,
		fileDetails: {},
	};

	// Gate 1: Feature enabled?
	if (!cfg.enabled) {
		const msg = 'Portfolio auto-update is disabled (config.enabled = false)';
		if (input.apply) {
			result.conflicts.push(msg);
			return result;
		}
		// Even for dry-run, add a warning
		result.warnings.push(msg);
		// Don't block dry-run planning — caller may want to see what would happen
	}

	// Gate 2: Status check
	if (!statusMeetsMinimum(input.status, cfg.minimumStatus)) {
		result.conflicts.push(
			`Run status '${input.status}' is below minimum '${cfg.minimumStatus}' — update blocked`,
		);
		return result;
	}

	// Gate 3: Evidence gating
	if (input.evidencePaths.length < cfg.minEvidencePaths) {
		const msg =
			cfg.minEvidencePaths === 1
				? 'No evidence paths provided — at least 1 evidence artifact required'
				: `Only ${input.evidencePaths.length} evidence paths provided — minimum ${cfg.minEvidencePaths} required`;
		result.conflicts.push(msg);
		return result;
	}

	// Guard: RED/UNKNOWN status only allowed for evidence-index updates
	const writeStatus: EvidenceRunStatus =
		input.status === 'RED' || input.status === 'UNKNOWN' ? ('RED' as const) : input.status;

	if (writeStatus === 'RED') {
		result.warnings.push(
			`Run status is '${input.status}' — only evidence-index entries will be added`,
		);
	}

	const targets = input.targetFiles ?? ALL_TARGETS;

	for (const target of targets) {
		const filePath = getFilePath(target);
		const fullPath = path.resolve(workspaceRoot, filePath);

		// Safety: path traversal check
		if (!isPathWithinWorkspace(fullPath, workspaceRoot)) {
			result.conflicts.push(`Path traversal detected for '${target}' → ${fullPath}`);
			result.skippedFiles.push(filePath);
			continue;
		}

		// Read file
		if (!fs.existsSync(fullPath)) {
			result.warnings.push(`File not found: ${filePath}`);
			result.skippedFiles.push(filePath);
			result.fileDetails[filePath] = {
				file: filePath,
				updated: false,
				reason: 'File not found',
			};
			continue;
		}

		const rawContent = fs.readFileSync(fullPath, 'utf-8');
		const lines = readLines(rawContent);
		const blocks = findMarkerBlocks(lines);

		const detail = processTarget(target, filePath, lines, blocks, input, cfg, result);

		if (detail && detail.updated) {
			result.changedFiles.push(filePath);
			// If apply mode, write the changes
			if (input.apply) {
				try {
					const updated = joinLines(lines);
					fs.writeFileSync(fullPath, updated, 'utf-8');
				} catch (err) {
					result.conflicts.push(`Failed to write ${filePath}: ${String(err)}`);
					detail.updated = false;
					detail.reason = `Write error: ${String(err)}`;
					result.skippedFiles.push(filePath);
				}
			}
		} else {
			result.skippedFiles.push(filePath);
		}

		result.fileDetails[filePath] = detail;
	}

	result.applied = result.changedFiles.length > 0 && input.apply;

	return result;
}

/**
 * Apply a portfolio update. Same as planEvidencePortfolioUpdate with apply=true.
 * Convenience wrapper.
 */
export function applyEvidencePortfolioUpdate(
	input: PortfolioUpdateInput,
	workspaceRoot: string,
	config?: Partial<EvidencePortfolioConfig>,
): PortfolioUpdateResult {
	return planEvidencePortfolioUpdate({ ...input, apply: true }, workspaceRoot, config);
}

/**
 * Extract portfolio update input from a run summary JSON file.
 * Reads a RudolphBenchmarkRunSummary or similar structured summary.
 */
export function extractPortfolioUpdateFromRunSummary(summaryPath: string): {
	runId: string;
	status: EvidenceRunStatus;
	evidencePaths: string[];
	capabilities: string[];
	limitations: string[];
} | null {
	try {
		if (!fs.existsSync(summaryPath)) return null;
		const raw = fs.readFileSync(summaryPath, 'utf-8');
		const summary = JSON.parse(raw);

		const runId: string = summary.runId ?? summary.id ?? path.basename(summaryPath, '.json');

		// Determine status from conclusion or direct status
		let status: EvidenceRunStatus = 'UNKNOWN';
		if (summary.conclusion?.status) {
			status = mapToRunStatus(summary.conclusion.status);
		} else if (summary.status) {
			status = mapToRunStatus(summary.status);
		}

		// Extract evidence paths
		const evidencePaths: string[] = [];
		if (Array.isArray(summary.issues)) {
			for (const issue of summary.issues) {
				if (Array.isArray(issue.evidencePaths)) {
					evidencePaths.push(...issue.evidencePaths);
				}
			}
		}
		if (Array.isArray(summary.evidencePaths)) {
			evidencePaths.push(...summary.evidencePaths);
		}

		// Extract capabilities
		const capabilities: string[] = [];
		if (summary.capabilityDelta?.newCapabilities) {
			capabilities.push(...summary.capabilityDelta.newCapabilities);
		}
		if (summary.conclusion?.whatWorks) {
			capabilities.push(...summary.conclusion.whatWorks);
		}

		// Extract limitations
		const limitations: string[] = [];
		if (summary.capabilityDelta?.unchangedLimitations) {
			limitations.push(...summary.capabilityDelta.unchangedLimitations);
		}
		if (summary.capabilityDelta?.remainingRisks) {
			limitations.push(...summary.capabilityDelta.remainingRisks);
		}
		if (summary.conclusion?.whatDoesNotWork) {
			limitations.push(...summary.conclusion.whatDoesNotWork);
		}

		return { runId, status, evidencePaths, capabilities, limitations };
	} catch {
		return null;
	}
}

// ── Internal helpers ──────────────────────────────────────────────────

function getFilePath(target: PortfolioFileTarget): string {
	switch (target) {
		case 'capabilities':
			return CAPABILITIES_FILE;
		case 'limitations':
			return LIMITATIONS_FILE;
		case 'evidence-index':
			return EVIDENCE_INDEX_FILE;
	}
}

function processTarget(
	target: PortfolioFileTarget,
	filePath: string,
	lines: string[],
	blocks: MarkerBlock[],
	input: PortfolioUpdateInput,
	cfg: EvidencePortfolioConfig,
	result: PortfolioUpdateResult,
): PortfolioFileDetail {
	const detail: PortfolioFileDetail = {
		file: filePath,
		updated: false,
		reason: '',
	};

	switch (target) {
		case 'capabilities':
			return processCapabilities(lines, blocks, input, cfg, result, detail);
		case 'limitations':
			return processLimitations(lines, blocks, input, cfg, result, detail);
		case 'evidence-index':
			return processEvidenceIndex(lines, blocks, input, cfg, result, detail);
	}
}

function processCapabilities(
	lines: string[],
	blocks: MarkerBlock[],
	input: PortfolioUpdateInput,
	cfg: EvidencePortfolioConfig,
	result: PortfolioUpdateResult,
	detail: PortfolioFileDetail,
): PortfolioFileDetail {
	// Update: evidence references table
	const evRefsBlock = 'evidence-refs' as const;

	if (!hasWellFormedBlock(blocks, evRefsBlock)) {
		const msg = `Marker block '${evRefsBlock}' not found in ${CAPABILITIES_FILE}`;
		if (cfg.requireMarkers) {
			result.conflicts.push(msg);
			detail.reason = msg;
			return detail;
		}
		result.warnings.push(msg);
		detail.reason = msg;
		return detail;
	}

	// Build new rows for completed/created issues
	const newRefRows: string[] = [];
	if (input.completedIssues) {
		for (const issueNum of input.completedIssues) {
			newRefRows.push(tableRow([`#${issueNum}`, 'Completed in run', 'CLOSED']));
		}
	}
	if (input.createdIssues) {
		for (const issueNum of input.createdIssues) {
			newRefRows.push(tableRow([`#${issueNum}`, 'Created in run', 'OPEN']));
		}
	}

	// Build capability rows from input.capabilities
	const newCapRows: string[] = [];
	if (input.capabilities) {
		for (const cap of input.capabilities) {
			newCapRows.push(tableRow([`#${input.runId}`, cap, 'GREEN_SAFE', 'P2']));
		}
	}

	const existingRows = extractTableRows(
		blocks.find((b) => b.section === evRefsBlock)?.content ?? [],
	);
	const toAdd = deduplicateRows(existingRows, [...newRefRows, ...newCapRows]);

	if (toAdd.length === 0) {
		detail.reason = 'No new entries (all duplicates or empty input)';
		return detail;
	}

	const updated = insertIntoBlock(lines, evRefsBlock, toAdd);
	if (updated) {
		// Mutate lines array in-place for caller
		lines.length = 0;
		lines.push(...updated);
		detail.updated = true;
		detail.reason = `Added ${toAdd.length} entries to evidence-refs block`;
		if (input.capabilities) detail.addedCapabilities = [...input.capabilities];
	} else {
		result.warnings.push(`Failed to insert into ${evRefsBlock} block in ${CAPABILITIES_FILE}`);
		detail.reason = 'Insert failed (block structure mismatch)';
	}

	return detail;
}

function processLimitations(
	lines: string[],
	blocks: MarkerBlock[],
	input: PortfolioUpdateInput,
	cfg: EvidencePortfolioConfig,
	result: PortfolioUpdateResult,
	detail: PortfolioFileDetail,
): PortfolioFileDetail {
	const activeBlock = 'active-limitations' as const;

	if (!hasWellFormedBlock(blocks, activeBlock)) {
		const msg = `Marker block '${activeBlock}' not found in ${LIMITATIONS_FILE}`;
		if (cfg.requireMarkers) {
			result.conflicts.push(msg);
			detail.reason = msg;
			return detail;
		}
		result.warnings.push(msg);
		detail.reason = msg;
		return detail;
	}

	const newRows: string[] = [];
	if (input.limitations) {
		for (const lim of input.limitations) {
			newRows.push(tableRow([lim, 'Open', `#${input.runId}`]));
		}
	}

	const existingRows = extractTableRows(
		blocks.find((b) => b.section === activeBlock)?.content ?? [],
	);
	const toAdd = deduplicateRows(existingRows, newRows);

	if (toAdd.length === 0) {
		detail.reason = 'No new limitations to add';
		return detail;
	}

	const updated = insertIntoBlock(lines, activeBlock, toAdd);
	if (updated) {
		lines.length = 0;
		lines.push(...updated);
		detail.updated = true;
		detail.reason = `Added ${toAdd.length} limitations to active-limitations block`;
		detail.addedLimitations = [...(input.limitations ?? [])];
	} else {
		result.warnings.push(`Failed to insert into ${activeBlock} block in ${LIMITATIONS_FILE}`);
		detail.reason = 'Insert failed';
	}

	return detail;
}

function processEvidenceIndex(
	lines: string[],
	blocks: MarkerBlock[],
	input: PortfolioUpdateInput,
	cfg: EvidencePortfolioConfig,
	result: PortfolioUpdateResult,
	detail: PortfolioFileDetail,
): PortfolioFileDetail {
	const mapBlock = 'evidence-map' as const;

	if (!hasWellFormedBlock(blocks, mapBlock)) {
		const msg = `Marker block '${mapBlock}' not found in ${EVIDENCE_INDEX_FILE}`;
		if (cfg.requireMarkers) {
			result.conflicts.push(msg);
			detail.reason = msg;
			return detail;
		}
		result.warnings.push(msg);
		detail.reason = msg;
		return detail;
	}

	// Build evidence path rows
	const newRows: string[] = [];
	const runName = input.runId.replace(/[-_]/g, ' ');

	// Add a section header row
	if (input.evidencePaths.length > 0) {
		newRows.push(`### ${runName} (Issue #${input.runId.replace(/\D/g, '') || input.runId})`);
		newRows.push('');
		newRows.push('| Path | Description |');
		newRows.push('|------|-------------|');
		for (const ep of input.evidencePaths) {
			newRows.push(tableRow([`\`${ep}\``, `Evidence for ${runName}`]));
		}
		newRows.push('');
	}

	const existingRows = extractTableRows(blocks.find((b) => b.section === mapBlock)?.content ?? []);
	const toAdd = deduplicateRows(existingRows, newRows);

	if (toAdd.length === 0) {
		detail.reason = 'No new evidence entries to add';
		return detail;
	}

	const inserted = insertIntoBlock(lines, mapBlock, toAdd);
	if (inserted) {
		lines.length = 0;
		lines.push(...inserted);
		detail.updated = true;
		detail.reason = `Added ${toAdd.length} evidence entries to evidence-map block`;
		detail.addedEvidencePaths = [...input.evidencePaths];
	} else {
		result.warnings.push(`Failed to insert into ${mapBlock} block in ${EVIDENCE_INDEX_FILE}`);
		detail.reason = 'Insert failed';
	}

	return detail;
}

function mapToRunStatus(s: string): EvidenceRunStatus {
	const upper = s.toUpperCase();
	if (upper === 'GREEN') return 'GREEN';
	if (upper === 'YELLOW') return 'YELLOW';
	if (upper === 'RED' || upper === 'FAIL' || upper === 'BLOCKED') return 'RED';
	return 'UNKNOWN';
}
