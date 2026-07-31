/**
 * Track E18 — RunsPage Native Run-ID Navigation Tests
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

// ── Mock api ──

vi.mock('../api.js', () => ({
	api: {
		getRuns: vi.fn().mockResolvedValue({
			runs: [
				{
					id: 'a1b2c3d4e5f6-7890-abcd-ef01-234567890abc',
					phase: 'done',
					status: 'done',
					issueNumber: 42,
					startedAt: '2026-07-01T10:00:00Z',
					finishedAt: '2026-07-01T10:05:00Z',
				},
				{
					id: 'f6e5d4c3b2a1-0123-fedc-ba98-765432109876',
					phase: 'implement',
					status: 'active',
					issueNumber: 99,
					startedAt: '2026-07-20T14:00:00Z',
					finishedAt: null,
				},
			],
		}),
	},
}));

// ── Helpers ──

let capturedPathname = '';

function LocationProbe(): null {
	const location = useLocation();
	capturedPathname = location.pathname;
	return null;
}

// ── Tests ──

describe('RunsPage — E18 Native Run-ID Link', () => {
	afterEach(() => {
		capturedPathname = '';
	});

	test('Run ID is a native link with correct href', async () => {
		const { default: RunsPage } = await import('../components/runs/RunsPage.js');
		render(
			<MemoryRouter>
				<RunsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('a1b2c3d4e5f6')).toBeDefined();
		});

		const link = screen.getByRole('link', {
			name: /open run a1b2c3d4e5f6-7890-abcd-ef01-234567890abc/i,
		});
		expect(link.tagName).toBe('A');
		expect(link.getAttribute('href')).toBe('/runs/a1b2c3d4e5f6-7890-abcd-ef01-234567890abc');
	});

	test('Run links have unique accessible names', async () => {
		const { default: RunsPage } = await import('../components/runs/RunsPage.js');
		render(
			<MemoryRouter>
				<RunsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('a1b2c3d4e5f6')).toBeDefined();
		});

		expect(
			screen.getByRole('link', {
				name: /open run a1b2c3d4e5f6-7890-abcd-ef01-234567890abc/i,
			}),
		).toBeDefined();
		expect(
			screen.getByRole('link', {
				name: /open run f6e5d4c3b2a1-0123-fedc-ba98-765432109876/i,
			}),
		).toBeDefined();
	});

	test('clicking Run-ID link navigates via React Router', async () => {
		const { default: RunsPage } = await import('../components/runs/RunsPage.js');
		render(
			<MemoryRouter initialEntries={['/runs']}>
				<Routes>
					<Route path="/runs" element={<RunsPage />} />
					<Route
						path="/runs/:runId"
						element={
							<>
								<LocationProbe />
								<div data-testid="run-detail">Run detail route</div>
							</>
						}
					/>
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('a1b2c3d4e5f6')).toBeDefined();
		});

		const link = screen.getByRole('link', {
			name: /open run a1b2c3d4e5f6-7890-abcd-ef01-234567890abc/i,
		});
		fireEvent.click(link);

		await waitFor(() => {
			expect(screen.getByTestId('run-detail')).toBeDefined();
		});

		expect(capturedPathname).toBe('/runs/a1b2c3d4e5f6-7890-abcd-ef01-234567890abc');
	});

	test('table row has no onClick and no cursor-pointer', async () => {
		const { default: RunsPage } = await import('../components/runs/RunsPage.js');
		render(
			<MemoryRouter>
				<RunsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('a1b2c3d4e5f6')).toBeDefined();
		});

		const tbodyRows = document.querySelectorAll('tbody tr');
		expect(tbodyRows.length).toBeGreaterThanOrEqual(2);

		for (const row of tbodyRows) {
			expect(row.getAttribute('role')).toBeNull();
			expect(row.getAttribute('tabindex')).toBeNull();
			expect(row.className).not.toContain('cursor-pointer');
		}
	});

	test('clicking non-ID cells does not navigate', async () => {
		const { default: RunsPage } = await import('../components/runs/RunsPage.js');
		render(
			<MemoryRouter initialEntries={['/runs']}>
				<Routes>
					<Route path="/runs" element={<RunsPage />} />
					<Route path="/runs/:runId" element={<div data-testid="run-detail">Run detail</div>} />
				</Routes>
				<LocationProbe />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('a1b2c3d4e5f6')).toBeDefined();
		});

		// Click on phase cell (in table only — use getAllByText and pick the table one)
		const phaseCells = screen.getAllByText('done');
		const tablePhaseCell = phaseCells.find((el) => el.closest('td') !== null);
		expect(tablePhaseCell).toBeDefined();
		fireEvent.click(tablePhaseCell ?? phaseCells[0]);
		expect(capturedPathname).toBe('/runs');

		// Click on status cell
		const statusCells = screen.getAllByText('DONE');
		const tableStatusCell = statusCells.find((el) => el.closest('td') !== null) as
			| Element
			| undefined;
		expect(tableStatusCell).toBeDefined();
		fireEvent.click(tableStatusCell ?? (statusCells[0] as Element));
		expect(capturedPathname).toBe('/runs');
	});

	test('visible text is first 12 characters of run ID', async () => {
		const { default: RunsPage } = await import('../components/runs/RunsPage.js');
		render(
			<MemoryRouter>
				<RunsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('a1b2c3d4e5f6')).toBeDefined();
		});

		expect(screen.getByText('f6e5d4c3b2a1')).toBeDefined();
	});
});
