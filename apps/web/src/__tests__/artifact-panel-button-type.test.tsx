import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
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

describe('ArtifactPanel — button type accessibility (Track D1b)', () => {
	const mockCreateObjectURL = vi.fn(() => 'blob:test-url');
	const mockRevokeObjectURL = vi.fn();
	const mockAnchorClick = vi.fn();

	beforeEach(async () => {
		vi.stubGlobal('URL', {
			...URL,
			createObjectURL: mockCreateObjectURL,
			revokeObjectURL: mockRevokeObjectURL,
		});
		HTMLAnchorElement.prototype.click = mockAnchorClick;
		mockCreateObjectURL.mockClear();
		mockRevokeObjectURL.mockClear();
		mockAnchorClick.mockClear();

		// Reset the mocked getArtifact to default resolved value
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockReset();
		vi.mocked(api.getArtifact).mockResolvedValue({
			content: '# Test Artifact\n\nSome safe content for testing.',
			kind: 'spec',
			createdAt: '2025-01-01T00:00:00.000Z',
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	test('download button has type="button"', async () => {
		render(<ArtifactPanel runId="run-123" />);

		const downloadButton = await screen.findByRole('button', {
			name: /download/i,
		});
		expect(downloadButton).toHaveAttribute('type', 'button');
	});

	test('all four tab buttons have type="button"', () => {
		render(<ArtifactPanel runId="run-123" />);

		const tabNames = ['Spec', 'Plan', 'Tasks', 'Diff'];
		for (const name of tabNames) {
			expect(screen.getByRole('button', { name })).toHaveAttribute('type', 'button');
		}
	});

	test('five total rendered buttons all have type="button"', async () => {
		render(<ArtifactPanel runId="run-123" />);

		// Wait for artifact to load so download button appears
		await screen.findByRole('button', { name: /download/i });

		const allButtons = screen.getAllByRole('button');
		expect(allButtons).toHaveLength(5);

		for (const btn of allButtons) {
			expect(btn).toHaveAttribute('type', 'button');
		}
	});

	test('tab click does not submit enclosing form', () => {
		const onSubmit = vi.fn((event) => event.preventDefault());

		render(
			<form onSubmit={onSubmit}>
				<ArtifactPanel runId="run-123" />
			</form>,
		);

		const tasksTab = screen.getByRole('button', { name: 'Tasks' });
		fireEvent.click(tasksTab);

		expect(onSubmit).not.toHaveBeenCalled();
	});

	test('download click does not submit enclosing form', async () => {
		const onSubmit = vi.fn((event) => event.preventDefault());

		render(
			<form onSubmit={onSubmit}>
				<ArtifactPanel runId="run-123" />
			</form>,
		);

		const downloadButton = await screen.findByRole('button', {
			name: /download/i,
		});
		fireEvent.click(downloadButton);

		expect(onSubmit).not.toHaveBeenCalled();
	});

	test('tab click triggers artifact fetch for correct kind', async () => {
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockClear();

		render(<ArtifactPanel runId="run-456" />);

		// Initial fetch for 'spec' happens automatically via useEffect
		await waitFor(() => {
			expect(api.getArtifact).toHaveBeenCalledWith('run-456', 'spec');
		});

		vi.mocked(api.getArtifact).mockClear();

		const diffTab = screen.getByRole('button', { name: 'Diff' });
		fireEvent.click(diffTab);

		await waitFor(() => {
			expect(api.getArtifact).toHaveBeenCalledWith('run-456', 'diff');
		});
	});

	test('download creates blob and triggers anchor click', async () => {
		render(<ArtifactPanel runId="run-1234567890ABCDEF" />);

		const downloadButton = await screen.findByRole('button', {
			name: /download/i,
		});
		fireEvent.click(downloadButton);

		expect(mockCreateObjectURL).toHaveBeenCalled();
		expect(mockAnchorClick).toHaveBeenCalled();
		expect(mockRevokeObjectURL).toHaveBeenCalled();
	});

	test('renders error state when artifact fetch fails', async () => {
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockRejectedValueOnce(new Error('Artifact not found'));

		render(<ArtifactPanel runId="run-fail" />);

		const errorText = await screen.findByText(/Artifact not found/);
		expect(errorText).toBeDefined();
	});

	test('renders fallback error for non-Error rejections', async () => {
		const { api } = await import('../api');
		vi.mocked(api.getArtifact).mockRejectedValueOnce('connection refused');

		render(<ArtifactPanel runId="run-fail" />);

		const errorText = await screen.findByText(/Konnte spec nicht laden/);
		expect(errorText).toBeDefined();
	});
});
