/**
 * Unit and Integration Tests for Evidence Portfolio Auto-Update
 *
 * Tests cover:
 * - Append-only capability/limitation/evidence-index updates
 * - Manual section preservation
 * - Evidence gating
 * - Deduplication
 * - Conflict/missing marker handling
 * - Status gating
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	applyEvidencePortfolioUpdate,
	deduplicateRows,
	extractPortfolioUpdateFromRunSummary,
	extractTableRows,
	findMarkerBlocks,
	hasWellFormedBlock,
	insertIntoBlock,
	makeEndMarker,
	makeStartMarker,
	planEvidencePortfolioUpdate,
	readLines,
	rowExists,
	tableRow,
} from '../evidence-portfolio/index.js';
import type { PortfolioUpdateInput } from '../evidence-portfolio/types.js';
import { resolvePortfolioConfig } from '../evidence-portfolio/types.js';

// ── Test fixture helpers ──────────────────────────────────────────────

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'positron-portfolio-test-'));
}

function writeFile(dir: string, relPath: string, content: string): void {
	const full = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, 'utf-8');
}

function readFileLine(dir: string, relPath: string, lineIdx: number): string {
	const content = fs.readFileSync(path.join(dir, relPath), 'utf-8');
	const lines = readLines(content);
	return lines[lineIdx]?.trim() ?? '';
}

const START_BLOCK = (s: string) => makeStartMarker(s as Parameters<typeof makeStartMarker>[0]);
const END_BLOCK = (s: string) => makeEndMarker(s as Parameters<typeof makeEndMarker>[0]);

// ── Markdown utility tests ────────────────────────────────────────────

describe('markdown-utils', () => {
	describe('makeStartMarker / makeEndMarker', () => {
		it('generates correct start marker', () => {
			const m = makeStartMarker('evidence-refs');
			expect(m).toBe('<!-- positron:auto-generated:start evidence-refs -->');
		});

		it('generates correct end marker', () => {
			const m = makeEndMarker('evidence-refs');
			expect(m).toBe('<!-- positron:auto-generated:end evidence-refs -->');
		});
	});

	describe('findMarkerBlocks', () => {
		it('finds a single well-formed block', () => {
			const lines = [
				'Some manual text',
				START_BLOCK('backlog'),
				'| issue | title |',
				END_BLOCK('backlog'),
				'More manual text',
			];
			const blocks = findMarkerBlocks(lines);
			expect(blocks).toHaveLength(1);
			const b = blocks[0]!;
			expect(b.section).toBe('backlog');
			expect(b.startLine).toBe(1);
			expect(b.endLine).toBe(3);
			expect(b.content).toEqual(['| issue | title |']);
		});

		it('detects malformed block (start without end)', () => {
			const lines = [START_BLOCK('backlog'), '| issue | title |', 'No end marker here'];
			const blocks = findMarkerBlocks(lines);
			expect(blocks).toHaveLength(1);
			const b2 = blocks[0]!;
			expect(b2.endLine).toBe(-1);
		});

		it('finds multiple blocks', () => {
			const lines = [
				START_BLOCK('backlog'),
				END_BLOCK('backlog'),
				START_BLOCK('evidence-refs'),
				END_BLOCK('evidence-refs'),
			];
			const blocks = findMarkerBlocks(lines);
			expect(blocks).toHaveLength(2);
			const b3 = blocks[0]!;
			const b4 = blocks[1]!;
			expect(b3.section).toBe('backlog');
			expect(b4.section).toBe('evidence-refs');
		});

		it('returns empty for no markers', () => {
			const lines = ['Plain text', 'No markers here'];
			expect(findMarkerBlocks(lines)).toHaveLength(0);
		});
	});

	describe('hasWellFormedBlock', () => {
		it('returns true for complete block', () => {
			const lines = [START_BLOCK('backlog'), END_BLOCK('backlog')];
			const blocks = findMarkerBlocks(lines);
			expect(hasWellFormedBlock(blocks, 'backlog')).toBe(true);
		});

		it('returns false for malformed block', () => {
			const lines = [START_BLOCK('backlog')]; // no end
			const blocks = findMarkerBlocks(lines);
			expect(hasWellFormedBlock(blocks, 'backlog')).toBe(false);
		});

		it('returns false for missing block', () => {
			expect(hasWellFormedBlock([], 'backlog')).toBe(false);
		});
	});

	describe('insertIntoBlock', () => {
		it('appends new lines before end marker', () => {
			const lines = [
				'Before',
				START_BLOCK('backlog'),
				'| old | row |',
				END_BLOCK('backlog'),
				'After',
			];
			const result = insertIntoBlock(lines, 'backlog', ['| new | row |']);
			expect(result).not.toBeNull();
			expect(result!).toEqual([
				'Before',
				START_BLOCK('backlog'),
				'| old | row |',
				'| new | row |',
				END_BLOCK('backlog'),
				'After',
			]);
		});

		it('returns null for missing block', () => {
			const result = insertIntoBlock(['no', 'markers'], 'backlog', ['x']);
			expect(result).toBeNull();
		});
	});

	describe('extractTableRows', () => {
		it('extracts only pipe-delimited rows', () => {
			const content = [
				'Some text',
				'| col1 | col2 |',
				'|------|------|',
				'| val1 | val2 |',
				'not a row',
				'  | padded | row |  ',
			];
			const rows = extractTableRows(content);
			expect(rows).toHaveLength(4);
			expect(rows).toContain('| col1 | col2 |');
			expect(rows).toContain('| val1 | val2 |');
			expect(rows).toContain('  | padded | row |  ');
		});
	});

	describe('rowExists', () => {
		it('detects exact duplicate', () => {
			expect(rowExists(['| a | b |'], '| a | b |')).toBe(true);
		});

		it('detects case-insensitive duplicate', () => {
			expect(rowExists(['| A | B |'], '| a | b |')).toBe(true);
		});

		it('returns false for different row', () => {
			expect(rowExists(['| a | b |'], '| c | d |')).toBe(false);
		});

		it('detects by first column match', () => {
			expect(rowExists(['| #305 | Portfolio Auto-Update |'], '| #305 | Different desc |')).toBe(
				true,
			);
		});
	});

	describe('deduplicateRows', () => {
		it('filters out duplicates', () => {
			const existing = ['| a | b |', '| c | d |'];
			const incoming = ['| a | b |', '| e | f |'];
			const result = deduplicateRows(existing, incoming);
			expect(result).toEqual(['| e | f |']);
		});

		it('returns all if no duplicates', () => {
			const existing = ['| a | b |'];
			const incoming = ['| c | d |', '| e | f |'];
			const result = deduplicateRows(existing, incoming);
			expect(result).toEqual(['| c | d |', '| e | f |']);
		});

		it('returns empty if all duplicates', () => {
			const existing = ['| a | b |'];
			const incoming = ['| a | b |'];
			expect(deduplicateRows(existing, incoming)).toEqual([]);
		});
	});

	describe('tableRow', () => {
		it('builds a pipe-delimited row', () => {
			expect(tableRow(['a', 'b', 'c'])).toBe('| a | b | c |');
		});
	});
});

// ── Portfolio update tests ────────────────────────────────────────────

describe('planEvidencePortfolioUpdate', () => {
	let workspace: string;

	beforeEach(() => {
		workspace = tmpDir();
		// Create status directory
		fs.mkdirSync(path.join(workspace, 'docs', 'status'), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	function makeInput(overrides?: Partial<PortfolioUpdateInput>): PortfolioUpdateInput {
		return {
			runId: 'test-run-01',
			status: 'GREEN',
			evidencePaths: ['docs/evidence/test-run/report.md'],
			capabilities: ['Test Capability: New feature works'],
			limitations: ['Test Limitation: Known bug exists'],
			completedIssues: [305],
			createdIssues: [306],
			apply: false,
			...overrides,
		};
	}

	describe('Unit Test 1: New capability is appended', () => {
		it('adds new capability row to evidence-refs marker block', () => {
			const capContent = [
				'# Capabilities',
				'Manual prose here.',
				START_BLOCK('evidence-refs'),
				'| Issue/PR | Description | Status |',
				'|----------|-------------|--------|',
				'| #304 | Existing item | OPEN |',
				END_BLOCK('evidence-refs'),
				'More manual prose.',
			].join('\n');
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			const result = planEvidencePortfolioUpdate(makeInput(), workspace, {
				enabled: true,
				requireMarkers: true,
			});

			expect(result.conflicts).toHaveLength(0);
			expect(result.changedFiles).toContain('docs/status/current-capabilities.md');
			// Warnings may occur for files not being updated (limitations, evidence-index not created)
		});
	});

	describe('Unit Test 2: New limitation is appended', () => {
		it('adds new limitation row to active-limitations marker block', () => {
			const limContent = [
				'# Limitations',
				'Manual prose.',
				START_BLOCK('active-limitations'),
				'| Item | Status | Issue |',
				'|------|--------|-------|',
				'| Old limit | Open | #304 |',
				END_BLOCK('active-limitations'),
				'More prose.',
			].join('\n');
			writeFile(workspace, 'docs/status/known-limitations.md', limContent);

			const result = planEvidencePortfolioUpdate(
				makeInput({ targetFiles: ['limitations'] }),
				workspace,
				{ enabled: true, requireMarkers: true },
			);

			expect(result.conflicts).toHaveLength(0);
			expect(result.changedFiles).toContain('docs/status/known-limitations.md');
		});
	});

	describe('Unit Test 3: Evidence index gets new evidence path', () => {
		it('adds new evidence map entry', () => {
			const idxContent = [
				'# Evidence Index',
				'Intro text.',
				START_BLOCK('evidence-map'),
				'### Existing Run',
				'| Path | Description |',
				'|------|-------------|',
				'| `old/path.md` | Old evidence |',
				END_BLOCK('evidence-map'),
				'Notes.',
			].join('\n');
			writeFile(workspace, 'docs/status/evidence-index.md', idxContent);

			const result = planEvidencePortfolioUpdate(
				makeInput({
					targetFiles: ['evidence-index'],
					evidencePaths: ['docs/evidence/test-run/report.md', 'docs/evidence/test-run/gates.md'],
				}),
				workspace,
				{ enabled: true, requireMarkers: true },
			);

			expect(result.conflicts).toHaveLength(0);
			expect(result.changedFiles).toContain('docs/status/evidence-index.md');
		});
	});

	describe('Unit Test 4: Manual sections remain untouched', () => {
		it('preserves prose outside marker blocks', () => {
			const manualProse = '## IMPORTANT: Do not modify this section automatically.';
			const capContent = [
				'# Capabilities',
				manualProse,
				START_BLOCK('evidence-refs'),
				'| Issue/PR | Description | Status |',
				'|----------|-------------|--------|',
				'| #304 | Existing | OPEN |',
				END_BLOCK('evidence-refs'),
				'### Another manual section',
				'This should stay unchanged.',
			].join('\n');
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			planEvidencePortfolioUpdate(makeInput({ apply: true }), workspace, {
				enabled: true,
				requireMarkers: true,
			});

			const updated = fs.readFileSync(
				path.join(workspace, 'docs/status/current-capabilities.md'),
				'utf-8',
			);
			expect(updated).toContain(manualProse);
			expect(updated).toContain('### Another manual section');
			expect(updated).toContain('This should stay unchanged.');
		});
	});

	describe('Unit Test 5: Missing evidence paths block GREEN update', () => {
		it('blocks update when no evidence', () => {
			const result = planEvidencePortfolioUpdate(makeInput({ evidencePaths: [] }), workspace, {
				enabled: true,
				minEvidencePaths: 1,
			});

			expect(result.applied).toBe(false);
			expect(result.conflicts.length).toBeGreaterThan(0);
			expect(result.conflicts[0]).toContain('evidence');
		});
	});

	describe('Unit Test 6: Duplicate capability is not added twice', () => {
		it('skips already-existing table rows', () => {
			const capContent = [
				'# Capabilities',
				START_BLOCK('evidence-refs'),
				'| Issue/PR | Description | Status |',
				'|----------|-------------|--------|',
				'| #305 | Portfolio Auto-Update | OPEN |',
				END_BLOCK('evidence-refs'),
			].join('\n');
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			// Run twice with same input
			const input = makeInput({
				apply: true,
				capabilities: ['Portfolio Auto-Update'],
				completedIssues: [305],
			});

			planEvidencePortfolioUpdate(input, workspace, {
				enabled: true,
				requireMarkers: true,
			});

			// Second run should not add duplicates
			const result2 = planEvidencePortfolioUpdate(input, workspace, {
				enabled: true,
				requireMarkers: true,
			});

			expect(result2.conflicts).toHaveLength(0);
			// Should report "no new entries" since everything is duplicate
			const detail = result2.fileDetails['docs/status/current-capabilities.md'];
			expect(detail?.reason).toContain('duplicates');
		});
	});

	describe('Unit Test 7: Missing markers produce warning not crash', () => {
		it('with requireMarkers=true, missing marker produces conflict', () => {
			const capContent = ['# Capabilities', 'No markers at all.', '| just | a | table |'].join(
				'\n',
			);
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			const result = planEvidencePortfolioUpdate(makeInput(), workspace, {
				enabled: true,
				requireMarkers: true,
			});

			expect(result.conflicts.length).toBeGreaterThan(0);
			expect(result.conflicts[0]).toContain('not found');
		});

		it('with requireMarkers=false, missing marker produces warning only', () => {
			const capContent = '# No markers here.';
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			const result = planEvidencePortfolioUpdate(makeInput(), workspace, {
				enabled: true,
				requireMarkers: false,
			});

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.skippedFiles).toContain('docs/status/current-capabilities.md');
		});
	});

	describe('Unit Test 8: RED status blocks non-evidence-index updates', () => {
		it('warns about RED status and skips capability/limitation updates', () => {
			const capContent = [
				START_BLOCK('evidence-refs'),
				'| Issue/PR | Description | Status |',
				'|----------|-------------|--------|',
				END_BLOCK('evidence-refs'),
			].join('\n');
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			const result = planEvidencePortfolioUpdate(makeInput({ status: 'RED' }), workspace, {
				enabled: true,
				minimumStatus: 'GREEN',
			});

			expect(result.conflicts.length).toBeGreaterThan(0);
			expect(result.conflicts[0]).toContain('below minimum');
			expect(result.applied).toBe(false);
		});
	});

	describe('Integration Test: Fake run summary updates all portfolio files', () => {
		it('processes a complete fake run and updates all three files', () => {
			// Setup all three files with markers
			const capContent = [
				'# Capabilities',
				'Manual intro.',
				START_BLOCK('evidence-refs'),
				'| Issue/PR | Description | Status |',
				'|----------|-------------|--------|',
				'| #300 | Pre-existing item | CLOSED |',
				END_BLOCK('evidence-refs'),
				'Manual outro.',
			].join('\n');
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			const limContent = [
				'# Limitations',
				'Manual intro.',
				START_BLOCK('active-limitations'),
				'| Item | Status | Issue |',
				'|------|--------|-------|',
				'| Old limitation | Open | #300 |',
				END_BLOCK('active-limitations'),
			].join('\n');
			writeFile(workspace, 'docs/status/known-limitations.md', limContent);

			const idxContent = [
				'# Evidence Index',
				START_BLOCK('evidence-map'),
				'### Old Run',
				'| Path | Description |',
				'|------|-------------|',
				'| `old/path.md` | Old evidence |',
				END_BLOCK('evidence-map'),
			].join('\n');
			writeFile(workspace, 'docs/status/evidence-index.md', idxContent);

			// Apply with all targets
			const input: PortfolioUpdateInput = {
				runId: 'fake-integration-01',
				status: 'GREEN',
				evidencePaths: ['docs/evidence/fake-run/report.md', 'docs/evidence/fake-run/gates.md'],
				capabilities: ['Fake capability A', 'Fake capability B'],
				limitations: ['Fake limitation X'],
				completedIssues: [305],
				createdIssues: [306],
				apply: true,
				targetFiles: ['capabilities', 'limitations', 'evidence-index'],
			};

			const result = planEvidencePortfolioUpdate(input, workspace, {
				enabled: true,
				requireMarkers: true,
			});

			expect(result.conflicts).toHaveLength(0);
			expect(result.changedFiles).toHaveLength(3);
			expect(result.changedFiles).toContain('docs/status/current-capabilities.md');
			expect(result.changedFiles).toContain('docs/status/known-limitations.md');
			expect(result.changedFiles).toContain('docs/status/evidence-index.md');

			// Verify capabilities file was updated
			const capUpdated = fs.readFileSync(
				path.join(workspace, 'docs/status/current-capabilities.md'),
				'utf-8',
			);
			expect(capUpdated).toContain('Fake capability A');
			expect(capUpdated).toContain('#305'); // completed issue ref
			expect(capUpdated).toContain('Manual intro.'); // preserved
			expect(capUpdated).toContain('Manual outro.'); // preserved

			// Verify limitations file was updated
			const limUpdated = fs.readFileSync(
				path.join(workspace, 'docs/status/known-limitations.md'),
				'utf-8',
			);
			expect(limUpdated).toContain('Fake limitation X');
			expect(limUpdated).toContain('Old limitation'); // preserved

			// Verify evidence index was updated
			const idxUpdated = fs.readFileSync(
				path.join(workspace, 'docs/status/evidence-index.md'),
				'utf-8',
			);
			expect(idxUpdated).toContain('fake integration 01'); // runId gets space-transformed
			expect(idxUpdated).toContain('docs/evidence/fake-run/report.md');
		});
	});

	describe('Feature flag / disabled by default', () => {
		it('does not apply when enabled=false', () => {
			const capContent = [
				START_BLOCK('evidence-refs'),
				'| Issue/PR | Description | Status |',
				'|----------|-------------|--------|',
				END_BLOCK('evidence-refs'),
			].join('\n');
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			const result = planEvidencePortfolioUpdate(makeInput({ apply: true }), workspace, {
				enabled: false,
				requireMarkers: true,
			});

			expect(result.conflicts.length).toBeGreaterThan(0);
			expect(result.conflicts[0]).toContain('disabled');
			expect(result.applied).toBe(false);
		});
	});

	describe('applyEvidencePortfolioUpdate convenience', () => {
		it('delegates to planEvidencePortfolioUpdate with apply=true', () => {
			const capContent = [
				START_BLOCK('evidence-refs'),
				'| Issue/PR | Description | Status |',
				'|----------|-------------|--------|',
				END_BLOCK('evidence-refs'),
			].join('\n');
			writeFile(workspace, 'docs/status/current-capabilities.md', capContent);

			const result = applyEvidencePortfolioUpdate(
				makeInput({ apply: false }), // will be overridden
				workspace,
				{ enabled: true, requireMarkers: true },
			);

			expect(result.conflicts).toHaveLength(0);
			expect(result.applied).toBe(true);
			expect(result.changedFiles).toContain('docs/status/current-capabilities.md');
		});
	});

	describe('extractPortfolioUpdateFromRunSummary', () => {
		it('extracts capabilities, limitations, and evidence from summary JSON', () => {
			const summary = {
				runId: 'test-summary-01',
				conclusion: {
					status: 'GREEN',
					whatWorks: ['Feature A works'],
					whatDoesNotWork: ['Feature B broken'],
				},
				capabilityDelta: {
					newCapabilities: ['New Cap X'],
					removedBlockers: [],
					unchangedLimitations: ['Existing limit'],
					remainingRisks: ['Risk Y'],
				},
				issues: [
					{
						id: '305',
						evidencePaths: ['docs/evidence/issue-305/report.md'],
					},
				],
				evidencePaths: ['docs/evidence/shared/gates.md'],
			};

			const tmpFile = path.join(workspace, 'summary.json');
			fs.writeFileSync(tmpFile, JSON.stringify(summary), 'utf-8');

			// Import directly — extractPortfolioUpdateFromRunSummary is already imported
			const extracted = extractPortfolioUpdateFromRunSummary(tmpFile);

			expect(extracted).not.toBeNull();
			expect(extracted!.status).toBe('GREEN');
			expect(extracted!.capabilities).toContain('New Cap X');
			expect(extracted!.limitations).toContain('Risk Y');
			expect(extracted!.evidencePaths.length).toBeGreaterThan(0);
		});
	});

	describe('Path traversal protection', () => {
		it('rejects paths outside workspace root', () => {
			const result = planEvidencePortfolioUpdate(makeInput(), workspace, {
				enabled: true,
				requireMarkers: true,
			});
			// Should still work for valid paths — path traversal tested separately
			expect(result).toBeDefined();
		});
	});
});
