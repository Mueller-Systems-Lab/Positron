import { describe, expect, it } from 'vitest';
import { serializeRunRehydrationArtifact, validateRunRehydrationArtifact } from '../rehydration.js';

const artifact = {
	schema: 'positron.run-rehydration.v1' as const,
	objective: 'Implement issue',
	project: 'demo',
	repository: 'acme/demo',
	branch: 'positron/issue-1-demo',
	baseSha: 'base',
	currentHead: 'head',
	activeStage: 'VERIFY',
	activeDecisions: [],
	completedGates: ['tests'],
	evidenceRefs: ['evidence://run/1'],
	provider: 'local',
	requestedModel: 'model-a',
	selectedModel: 'model-a',
	executedModel: 'model-a',
	runtimeVersions: { positron: '0.3.0' },
	blockers: [],
	nextLegalActions: ['review'],
};

describe('run rehydration artifact', () => {
	it('round-trips a secret-free restart snapshot', () => {
		expect(JSON.parse(serializeRunRehydrationArtifact(artifact))).toEqual(artifact);
	});
	it('rejects credential material', () => {
		expect(() =>
			validateRunRehydrationArtifact({
				...artifact,
				objective: 'bearer sk-very-long-secret-value',
			}),
		).toThrow('secret-like');
	});
});
