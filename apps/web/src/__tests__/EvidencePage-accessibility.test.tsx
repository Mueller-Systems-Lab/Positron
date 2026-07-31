/**
 * Track E17 — EvidencePage Native Expand/Collapse Control Tests
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

// ── Mock api — EvidencePage imports ../../api.js ──

vi.mock('../api.js', () => ({
	api: {
		getEvidence: vi.fn().mockResolvedValue({
			evidence: [
				{
					id: 'ev-test-001',
					type: 'test',
					kind: 'test-results',
					source: 'jest',
					sourceId: 'run-abc-123',
					status: 'pass' as const,
					summary: 'All unit tests passed',
					timestamp: '2026-07-01T10:00:00Z',
					runPhase: 'test',
				},
				{
					id: 'ev-test-002',
					type: 'diff',
					kind: 'diff',
					source: 'git',
					sourceId: 'run-def-456',
					status: 'fail' as const,
					summary: 'TypeScript compilation errors',
					timestamp: '2026-07-01T11:00:00Z',
					runPhase: 'implement',
				},
			],
		}),
		getRuns: vi.fn().mockResolvedValue({
			runs: [],
		}),
	},
}));

// ── Tests ──────────────────────────────────────────────────────────

describe('EvidencePage — E17 Native Expand/Collapse Button', () => {
	test('renders two expand buttons with aria-expanded=false initially', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		const buttons = screen.getAllByRole('button', {
			name: /expand evidence/i,
		});
		expect(buttons).toHaveLength(2);

		for (const btn of buttons) {
			expect(btn.getAttribute('aria-expanded')).toBe('false');
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
		}
	});

	test('expand button has unique accessible name per item', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		expect(screen.getByRole('button', { name: /expand evidence ev-test-001/i })).toBeDefined();
		expect(screen.getByRole('button', { name: /expand evidence ev-test-002/i })).toBeDefined();
	});

	test('clicking expand sets aria-expanded=true and shows detail', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		const btn = screen.getByRole('button', {
			name: /expand evidence ev-test-001/i,
		});
		expect(btn.getAttribute('aria-expanded')).toBe('false');

		fireEvent.click(btn);

		expect(btn.getAttribute('aria-expanded')).toBe('true');

		expect(
			screen.getByRole('button', {
				name: /collapse evidence ev-test-001/i,
			}),
		).toBeDefined();

		const detailId = btn.getAttribute('aria-controls');
		expect(detailId).toBeTruthy();
		const detailRow = document.getElementById(detailId ?? '');
		expect(detailRow).toBeDefined();
		expect(detailRow?.tagName).toBe('TR');
	});

	test('clicking collapse sets aria-expanded=false', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		const btn = screen.getByRole('button', {
			name: /expand evidence ev-test-001/i,
		});

		fireEvent.click(btn);
		expect(btn.getAttribute('aria-expanded')).toBe('true');

		fireEvent.click(btn);
		expect(btn.getAttribute('aria-expanded')).toBe('false');
	});

	test('opening second item closes first', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		const btn1 = screen.getByRole('button', {
			name: /expand evidence ev-test-001/i,
		});
		const btn2 = screen.getByRole('button', {
			name: /expand evidence ev-test-002/i,
		});

		fireEvent.click(btn1);
		expect(btn1.getAttribute('aria-expanded')).toBe('true');

		fireEvent.click(btn2);
		await waitFor(() => {
			expect(btn1.getAttribute('aria-expanded')).toBe('false');
		});
		expect(btn2.getAttribute('aria-expanded')).toBe('true');
	});

	test('table rows have no role=button and no tabIndex', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		const tbodyRows = document.querySelectorAll('tbody tr[role="button"]');
		expect(tbodyRows.length).toBe(0);

		const dataRows = document.querySelectorAll('tbody tr:not([id^="evidence-detail-"])');
		for (const row of dataRows) {
			expect(row.getAttribute('tabindex')).toBeNull();
		}
	});

	test('clicking a non-button cell does not expand', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		const summaryCell = screen.getByText('All unit tests passed');
		fireEvent.click(summaryCell);

		const btn = screen.getByRole('button', {
			name: /expand evidence ev-test-001/i,
		});
		expect(btn.getAttribute('aria-expanded')).toBe('false');
	});

	test('Run link is independent native link', async () => {
		const { default: EvidencePage } = await import('../components/evidence/EvidencePage.js');
		render(
			<MemoryRouter>
				<EvidencePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('All unit tests passed')).toBeDefined();
		});

		// Run link text shows first 8 chars of sourceId
		const runLink = screen.getByText('run-abc-');
		expect(runLink.closest('a')).toBeDefined();
		expect(runLink.closest('a')?.getAttribute('href')).toBe('/runs/run-abc-123');

		// Run link should NOT be inside a role=button ancestor
		expect(runLink.closest('[role="button"]')).toBeNull();

		// Clicking the link should not expand the row
		fireEvent.click(runLink);
		const expandBtn = screen.getByRole('button', {
			name: /expand evidence ev-test-001/i,
		});
		expect(expandBtn.getAttribute('aria-expanded')).toBe('false');
	});
});
