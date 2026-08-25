// Positron — Stage 3 Base Resolver
//
// TOCTOU-safe base branch SHA resolution.
// Before any live mutation, the resolver reads the current SHA of the
// base branch from the sandbox repository and compares it with the
// approval binding's `expectedBaseSha`. If they differ, execution is
// blocked — preventing time-of-check-to-time-of-use attacks.

// ---------------------------------------------------------------------------
// Base Resolver Interface
// ---------------------------------------------------------------------------

/** Result of base branch resolution. */
export interface Stage3ResolvedBase {
	/** Branch name (e.g. 'main'). */
	branch: string;

	/** Current SHA of the branch tip. */
	sha: string;
}

/**
 * Contract for resolving the base branch SHA.
 * Implementations read from the sandbox repository read-only.
 */
export interface Stage3BaseResolver {
	resolveBase(input: { owner: string; repo: string; branch: string }): Promise<Stage3ResolvedBase>;
}

// ---------------------------------------------------------------------------
// Drift Detection
// ---------------------------------------------------------------------------

/** Result of base SHA drift check. */
export interface Stage3BaseDriftResult {
	/** Whether the base SHA matches the expected value. */
	matches: boolean;

	/** Expected SHA from the approval binding. */
	expectedSha: string;

	/** Actual SHA from the repository. */
	actualSha: string;

	/** Branch name. */
	branch: string;
}

/**
 * Compare the resolved base SHA with the expected SHA from the approval binding.
 * Returns a detailed drift result.
 */
export function checkBaseDrift(
	resolved: Stage3ResolvedBase,
	expectedSha: string,
): Stage3BaseDriftResult {
	return {
		matches: resolved.sha === expectedSha,
		expectedSha,
		actualSha: resolved.sha,
		branch: resolved.branch,
	};
}

/**
 * Error thrown when base SHA drift is detected.
 * The harness uses this to block execution with RED_BLOCK_BASE_SHA_DRIFT.
 */
export class Stage3BaseShaDriftError extends Error {
	constructor(
		public readonly expectedSha: string,
		public readonly actualSha: string,
		public readonly branch: string,
	) {
		super(
			`Base SHA drift detected on '${branch}': ` +
				`expected ${expectedSha.slice(0, 12)}..., got ${actualSha.slice(0, 12)}...`,
		);
		this.name = 'Stage3BaseShaDriftError';
	}
}

// ---------------------------------------------------------------------------
// Fake Resolver (for testing)
// ---------------------------------------------------------------------------

/**
 * Fake base resolver that always returns a synthetic SHA.
 * Used in fake mode and tests — never for live execution.
 */
export function createFakeBaseResolver(expectedSha: string): Stage3BaseResolver {
	return {
		async resolveBase(input: { owner: string; repo: string; branch: string }) {
			return {
				branch: input.branch,
				sha: expectedSha,
			};
		},
	};
}
