import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli.js';

describe('Issue #465 CLI compatibility contract', () => {
	it('accepts the stable run command with safe defaults', () => {
		expect(parseArgs(['node', 'positron', 'run', '--issueNumber', '465'])).toEqual({
			kind: 'ok',
			args: {
				issueNumber: 465,
				repoId: undefined,
				autonomyLevel: 2,
				serverUrl: 'http://localhost:3000',
			},
		});
	});

	it('fails closed for missing, invalid and unknown arguments', () => {
		expect(parseArgs(['node', 'positron'])).toMatchObject({ kind: 'error' });
		expect(parseArgs(['node', 'positron', 'run', '--issueNumber', '0'])).toMatchObject({
			kind: 'error',
		});
		expect(
			parseArgs(['node', 'positron', 'run', '--issueNumber', '1', '--unexpected']),
		).toMatchObject({ kind: 'error' });
	});
});
