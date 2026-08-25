/**
 * Evidence Portfolio Auto-Update
 *
 * Post-run mechanism for incrementally updating Living Evidence Portfolio
 * files with new capabilities, limitations, and evidence trail entries.
 *
 * Part of Issue #305: Automate post-run capability and limitation updates.
 */

// Markdown utilities (exported for testing)
export type { MarkerBlock } from './markdown-utils.js';
export {
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
	rowExists,
	tableRow,
	tableSeparator,
} from './markdown-utils.js';

// Core functions
export {
	applyEvidencePortfolioUpdate,
	extractPortfolioUpdateFromRunSummary,
	planEvidencePortfolioUpdate,
} from './portfolio-updater.js';
// Types
export type {
	EvidencePortfolioConfig,
	EvidenceRunStatus,
	PortfolioFileDetail,
	PortfolioFileTarget,
	PortfolioSection,
	PortfolioUpdateInput,
	PortfolioUpdateResult,
} from './types.js';
export {
	DEFAULT_PORTFOLIO_CONFIG,
	MARKER_PREFIX,
	MARKER_SUFFIX,
	resolvePortfolioConfig,
	statusMeetsMinimum,
} from './types.js';
