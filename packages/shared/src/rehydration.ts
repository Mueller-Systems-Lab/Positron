/** Restart-safe, secret-free snapshot for an interrupted lifecycle run. */
export interface RunRehydrationArtifact {
	schema: 'positron.run-rehydration.v1';
	objective: string;
	project: string;
	repository: string;
	branch: string;
	baseSha: string;
	currentHead: string;
	activeStage: string;
	activeDecisions: string[];
	completedGates: string[];
	evidenceRefs: string[];
	provider: string | null;
	requestedModel: string | null;
	selectedModel: string | null;
	executedModel: string | null;
	runtimeVersions: Record<string, string>;
	blockers: string[];
	nextLegalActions: string[];
}

const secretLike = /(token|secret|password|api[_-]?key|private[_-]?key|bearer|credential)/i;

export function validateRunRehydrationArtifact(value: unknown): RunRehydrationArtifact {
	if (!value || typeof value !== 'object')
		throw new Error('rehydration artifact must be an object');
	const candidate = value as Record<string, unknown>;
	if (candidate.schema !== 'positron.run-rehydration.v1')
		throw new Error('unsupported rehydration schema');
	for (const field of [
		'objective',
		'project',
		'repository',
		'branch',
		'baseSha',
		'currentHead',
		'activeStage',
	]) {
		if (typeof candidate[field] !== 'string' || !candidate[field])
			throw new Error(`${field} is required`);
	}
	for (const field of [
		'activeDecisions',
		'completedGates',
		'evidenceRefs',
		'blockers',
		'nextLegalActions',
	]) {
		if (
			!Array.isArray(candidate[field]) ||
			(candidate[field] as unknown[]).some((item) => typeof item !== 'string')
		)
			throw new Error(`${field} must be a string array`);
	}
	for (const field of ['provider', 'requestedModel', 'selectedModel', 'executedModel']) {
		if (candidate[field] !== null && typeof candidate[field] !== 'string')
			throw new Error(`${field} must be a string or null`);
	}
	if (
		!candidate.runtimeVersions ||
		typeof candidate.runtimeVersions !== 'object' ||
		Array.isArray(candidate.runtimeVersions)
	)
		throw new Error('runtimeVersions is required');
	const serialized = JSON.stringify(candidate);
	if (
		secretLike.test(serialized) &&
		/gh[pob]_?[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._-]{12,}/i.test(
			serialized,
		)
	) {
		throw new Error('rehydration artifact contains secret-like material');
	}
	return candidate as unknown as RunRehydrationArtifact;
}

export function serializeRunRehydrationArtifact(value: RunRehydrationArtifact): string {
	return JSON.stringify(validateRunRehydrationArtifact(value), null, 2);
}
