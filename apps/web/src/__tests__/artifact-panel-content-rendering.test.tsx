import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ArtifactPanel from '../components/ArtifactPanel';

// Mock the api module — factory must be inline (vi.mock is hoisted)
vi.mock('../api', () => ({
	api: {
		getArtifact: vi.fn().mockResolvedValue({
			content: '# Test Artifact\n\nSome safe content for testing.',
			kind: 'spec',
			createdAt: '2025-01-01T00:00:00.000Z',
		}),
	},
}));

const DIFF_CONTENT = ['+added line', '-removed line', '@@ context', 'plain line'].join('\n');

const MOCK_ARTIFACT = {
	createdAt: '2025-01-01T00:00:00.000Z',
};

describe('ArtifactPanel — content rendering contract (Track G1 noDangerouslySetInnerHtml)', () => {
	beforeEach(async () => {
		// Reset the mocked getArtifact to a kind-aware default
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockReset();
		vi.mocked(api.getArtifact).mockImplementation((_runId, kind) =>
			Promise.resolve({
				content:
					kind === 'diff' ? DIFF_CONTENT : '# Test Artifact\n\nSome safe content for testing.',
				kind,
				createdAt: MOCK_ARTIFACT.createdAt,
			}),
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	test('artifact content renders as text, not parsed HTML (XSS probe)', async () => {
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockResolvedValue({
			content: '<img src=x onerror="alert(1)">\n<b>bold</b>',
			kind: 'spec',
			createdAt: MOCK_ARTIFACT.createdAt,
		});

		const { container } = render(<ArtifactPanel runId="run-1" />);

		await waitFor(() => {
			expect(container.querySelector('pre')?.textContent).toContain('<img src=x');
		});

		// The markup must appear as literal text, never as parsed elements
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('b')).toBeNull();
		expect(container.querySelector('pre')?.textContent).toContain('<b>bold</b>');
	});

	test('diff line content renders as text, not parsed HTML (diff injection probe)', async () => {
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockResolvedValue({
			content: '+<script>alert(1)</script>',
			kind: 'diff',
			createdAt: MOCK_ARTIFACT.createdAt,
		});

		const { container } = render(<ArtifactPanel runId="run-1" />);
		fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

		await waitFor(() => {
			expect(container.querySelector('script')).toBeNull();
			expect(container.querySelector('pre')?.textContent).toContain('<script>alert(1)</script>');
		});
	});

	test('diff highlighting contract: +, - and @@ lines keep their color classes', async () => {
		const { container } = render(<ArtifactPanel runId="run-1" />);
		fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

		const added = await screen.findByText('+added line');
		expect(added).toHaveClass('text-green-400');

		const removed = screen.getByText('-removed line');
		expect(removed).toHaveClass('text-red-400');

		const context = screen.getByText('@@ context');
		expect(context).toHaveClass('text-slate-500');

		// Plain lines carry no color class
		const plain = screen.getByText('plain line');
		expect(plain).not.toHaveClass('text-green-400', 'text-red-400', 'text-slate-500');
		expect(container.querySelector('.text-green-400')?.textContent).toBe('+added line');
	});

	test('diff line breaks: exactly N-1 separators, no trailing newline drift', async () => {
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockResolvedValue({
			content: 'a\nb\nc',
			kind: 'diff',
			createdAt: MOCK_ARTIFACT.createdAt,
		});

		const { container } = render(<ArtifactPanel runId="run-1" />);
		fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

		await waitFor(() => {
			expect(container.querySelector('pre')?.textContent).toBe('a\nb\nc');
		});
	});
});
