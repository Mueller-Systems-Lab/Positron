import { describe, expect, it } from 'vitest';
import { validateProjectEntry } from '../index.js';

describe('Project Entry API', () => {
	it('accepts an existing repository entry contract', () => {
		expect(
			validateProjectEntry({
				entryType: 'existing_repository',
				name: 'Existing',
				owner: 'acme',
				repository: 'existing',
			}),
		).toMatchObject({
			entryType: 'existing_repository',
			owner: 'acme',
			repository: 'existing',
		});
	});

	it('rejects credential values in the reference field', () => {
		expect(() =>
			validateProjectEntry({
				entryType: 'blueprint',
				name: 'Secure',
				owner: 'acme',
				blueprint: '# Secure project with enough detail',
				credentialRef: 'ghp_123456789012345678901234567890123456',
			}),
		).toThrow('reference name');
	});

	it('accepts a blueprint with reference-only credential metadata', () => {
		expect(
			validateProjectEntry({
				entryType: 'blueprint',
				name: 'New Project',
				owner: 'acme',
				blueprint: '# New Project\n\nA bounded project blueprint.',
				provider: 'opencode',
				model: 'local-model',
				credentialRef: 'github-token',
			}),
		).toMatchObject({
			entryType: 'blueprint',
			provider: 'opencode',
			model: 'local-model',
			credentialRef: 'github-token',
		});
	});
});
