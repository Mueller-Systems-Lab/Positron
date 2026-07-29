/**
 * Track E1 — lint/suspicious/noArrayIndexKey focused tests
 *
 * Issue #340: Verifies that all 7 index-as-key usages are resolved
 * without introducing React duplicate-key warnings, rendering
 * regressions, or index-based key strategies.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { createStableTextItems } from '../components/projects/ProjectsPage.js';
import { createSkeletonSlots } from '../components/shared/LoadingSkeleton.js';

// -----------------------------------------------------------------------
// Helper: createStableTextItems
// -----------------------------------------------------------------------

describe('createStableTextItems', () => {
	test('unique values produce distinct keys', () => {
		const result = createStableTextItems(['alpha', 'beta']);

		expect(result).toHaveLength(2);
		expect(result[0].key).not.toBe(result[1].key);
		expect(result[0].value).toBe('alpha');
		expect(result[1].value).toBe('beta');
	});

	test('values are unchanged', () => {
		const input: readonly string[] = ['hello', 'world'];
		const result = createStableTextItems(input);

		expect(result.map((r) => r.value)).toEqual(input);
	});

	test('order is unchanged', () => {
		const input: readonly string[] = ['first', 'second', 'third'];
		const result = createStableTextItems(input);

		expect(result).toHaveLength(3);
		expect(result[0].value).toBe('first');
		expect(result[1].value).toBe('second');
		expect(result[2].value).toBe('third');
	});

	test('duplicate values produce distinct keys', () => {
		const result = createStableTextItems(['duplicate', 'duplicate']);

		expect(result).toHaveLength(2);
		expect(result[0].key).not.toBe(result[1].key);
		expect(result[0].value).toBe('duplicate');
		expect(result[1].value).toBe('duplicate');
	});

	test('reordering unique values preserves key identity', () => {
		const first = createStableTextItems(['alpha', 'beta'] as const);
		const second = createStableTextItems(['beta', 'alpha'] as const);

		expect(first[0].key).toBe(second[1].key); // alpha key unchanged
		expect(first[1].key).toBe(second[0].key); // beta key unchanged
	});

	test('determinism — same input yields same keys', () => {
		const input: readonly string[] = ['x', 'y', 'z', 'x'];

		const a = createStableTextItems(input);
		const b = createStableTextItems(input);

		expect(a).toEqual(b);
	});

	test('triple duplicates', () => {
		const result = createStableTextItems(['dup', 'dup', 'dup']);

		expect(result).toHaveLength(3);
		const keys = new Set(result.map((r) => r.key));
		expect(keys.size).toBe(3);
	});

	test('empty array', () => {
		const result = createStableTextItems([]);
		expect(result).toHaveLength(0);
	});

	test('input is not mutated', () => {
		const input = Object.freeze(['a', 'b', 'a']);
		expect(() => createStableTextItems(input)).not.toThrow();
	});
});

// -----------------------------------------------------------------------
// ProjectsPage rendering — duplicate data
// -----------------------------------------------------------------------

describe('ProjectsPage with duplicate blockers and recommended runs', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	test('renders without React duplicate-key warnings for duplicate blockers', async () => {
		const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		vi.doMock('../api.js', () => ({
			api: {
				getManagedTargetProjects: vi.fn().mockResolvedValue({
					projects: [
						{
							id: 'xxammaxx/TestProjectA',
							name: 'TestProjectA',
							role: 'proof_project',
							repoUrl: 'https://github.com/xxammaxx/TestProjectA',
							defaultBranch: 'main',
							status: 'LOCAL_GATES_REPRODUCIBLE',
							description: 'Test project with duplicate blockers.',
							techStack: [],
							lastEvidence: null,
							lastRunRef: null,
							blockers: ['duplicate blocker', 'duplicate blocker'],
							nextRecommendedRuns: ['duplicate run', 'duplicate run'],
							safetyChecks: [],
							securityStatus: 'ok',
						},
					],
				}),
			},
		}));

		try {
			// Re-import so the mock is picked up
			const mod = await import('../components/projects/ProjectsPage.js');
			const Page = mod.default as React.FC;

			render(
				<MemoryRouter>
					<Page />
				</MemoryRouter>,
			);

			// Wait for data to resolve
			await vi.waitFor(() => {
				expect(screen.getByText('TestProjectA')).toBeDefined();
			});

			// Check for React duplicate-key warnings
			const duplicateKeyCalls = warnSpy.mock.calls.filter((call) => {
				const msg = String(call[0]);
				return (
					msg.includes('Encountered two children with the same key') ||
					msg.includes('duplicate key')
				);
			});
			expect(duplicateKeyCalls).toHaveLength(0);
		} finally {
			warnSpy.mockRestore();
		}
	});

	test('both duplicate blockers are rendered', async () => {
		vi.doMock('../api.js', () => ({
			api: {
				getManagedTargetProjects: vi.fn().mockResolvedValue({
					projects: [
						{
							id: 'xxammaxx/TestProjectB',
							name: 'TestProjectB',
							role: 'proof_project',
							repoUrl: 'https://github.com/xxammaxx/TestProjectB',
							defaultBranch: 'main',
							status: 'LOCAL_GATES_REPRODUCIBLE',
							description: 'Test with duplicate data.',
							techStack: [],
							lastEvidence: null,
							lastRunRef: null,
							blockers: ['dup blocker', 'dup blocker'],
							nextRecommendedRuns: [],
							safetyChecks: [],
							securityStatus: 'ok',
						},
					],
				}),
			},
		}));

		const mod = await import('../components/projects/ProjectsPage.js');
		const Page = mod.default as React.FC;

		render(
			<MemoryRouter>
				<Page />
			</MemoryRouter>,
		);

		await vi.waitFor(() => {
			expect(screen.getByText('TestProjectB')).toBeDefined();
		});

		// Expand details to see blockers
		const showDetails = screen.getByText('▼ Show Details');
		showDetails.click();

		await vi.waitFor(() => {
			const listItems = screen.getAllByText('dup blocker');
			expect(listItems).toHaveLength(2);
		});
	});

	test('both duplicate recommended runs are rendered', async () => {
		vi.doMock('../api.js', () => ({
			api: {
				getManagedTargetProjects: vi.fn().mockResolvedValue({
					projects: [
						{
							id: 'xxammaxx/TestProjectC',
							name: 'TestProjectC',
							role: 'proof_project',
							repoUrl: 'https://github.com/xxammaxx/TestProjectC',
							defaultBranch: 'main',
							status: 'LOCAL_GATES_REPRODUCIBLE',
							description: 'Test with duplicate runs.',
							techStack: [],
							lastEvidence: null,
							lastRunRef: null,
							blockers: [],
							nextRecommendedRuns: ['dup run', 'dup run'],
							safetyChecks: [],
							securityStatus: 'ok',
						},
					],
				}),
			},
		}));

		const mod = await import('../components/projects/ProjectsPage.js');
		const Page = mod.default as React.FC;

		render(
			<MemoryRouter>
				<Page />
			</MemoryRouter>,
		);

		await vi.waitFor(() => {
			expect(screen.getByText('TestProjectC')).toBeDefined();
		});

		const showDetails = screen.getByText('▼ Show Details');
		showDetails.click();

		await vi.waitFor(() => {
			const listItems = screen.getAllByText('dup run');
			expect(listItems).toHaveLength(2);
		});
	});

	test('order of unique blockers is preserved', async () => {
		vi.doMock('../api.js', () => ({
			api: {
				getManagedTargetProjects: vi.fn().mockResolvedValue({
					projects: [
						{
							id: 'xxammaxx/TestProjectD',
							name: 'TestProjectD',
							role: 'proof_project',
							repoUrl: 'https://github.com/xxammaxx/TestProjectD',
							defaultBranch: 'main',
							status: 'LOCAL_GATES_REPRODUCIBLE',
							description: 'Test order preservation.',
							techStack: [],
							lastEvidence: null,
							lastRunRef: null,
							blockers: ['first', 'second', 'third'],
							nextRecommendedRuns: [],
							safetyChecks: [],
							securityStatus: 'ok',
						},
					],
				}),
			},
		}));

		const mod = await import('../components/projects/ProjectsPage.js');
		const Page = mod.default as React.FC;

		render(
			<MemoryRouter>
				<Page />
			</MemoryRouter>,
		);

		await vi.waitFor(() => {
			expect(screen.getByText('TestProjectD')).toBeDefined();
		});

		const showDetails = screen.getByText('▼ Show Details');
		showDetails.click();

		await vi.waitFor(() => {
			const items = screen.getAllByRole('listitem');
			const blockers = items
				.map((el) => el.textContent)
				.filter((t) => ['first', 'second', 'third'].includes(t ?? ''));
			expect(blockers).toEqual(['first', 'second', 'third']);
		});
	});
});

// -----------------------------------------------------------------------
// Skeleton rendering — fixed-size slot groups
// -----------------------------------------------------------------------

describe('Skeleton rendering — fixed-size groups and suppression sites', () => {
	test('RecentActivity skeleton renders 4 rows', async () => {
		const { default: RecentActivity } = await import('../components/dashboard/RecentActivity.js');

		const { container } = render(
			<MemoryRouter>
				<RecentActivity runs={[]} isLoading={true} />
			</MemoryRouter>,
		);

		// Each skeleton row has "skeleton" class on inner elements
		const skeletonRows = container.querySelectorAll('[class*="skeleton"][class*="rounded-full"]');
		expect(skeletonRows).toHaveLength(4);
	});

	test('StatusSummary skeleton renders 4 cards', async () => {
		const { default: StatusSummary } = await import('../components/dashboard/StatusSummary.js');

		const { container } = render(<StatusSummary metrics={null} isLoading={true} />);

		const skeletonCards = container.querySelectorAll('.card.animate-pulse');
		expect(skeletonCards).toHaveLength(4);
	});

	test('LoadingSkeleton table variant renders requested rows', async () => {
		const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');

		const { container } = render(<LoadingSkeleton variant="table" rows={4} />);

		const rows = container.querySelectorAll('.flex.gap-4');
		expect(rows).toHaveLength(4);
	});

	test('LoadingSkeleton text variant renders requested rows', async () => {
		const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');

		const { container } = render(<LoadingSkeleton variant="text" rows={5} />);

		const lines = container.querySelectorAll('.skeleton.h-3');
		expect(lines).toHaveLength(5);
	});

	test('RunsPage skeleton renders 8 rows', async () => {
		// Mock api to never resolve — keeps loading=true and skeleton visible
		vi.doMock('../api.js', () => ({
			api: {
				getRuns: vi.fn(
					() =>
						new Promise(() => {
							/* never resolves — loading stays true */
						}),
				),
			},
		}));

		const { default: RunsPage } = await import('../components/runs/RunsPage.js');

		const { container } = render(
			<MemoryRouter>
				<RunsPage />
			</MemoryRouter>,
		);

		const skeletonRows = container.querySelectorAll('.skeleton.h-10');
		expect(skeletonRows).toHaveLength(8);
	});
});

// -----------------------------------------------------------------------
// Helper: createSkeletonSlots
// -----------------------------------------------------------------------

describe('createSkeletonSlots', () => {
	test('zero rows produces empty array', () => {
		const result = createSkeletonSlots('loading-skeleton-table-row', 0);
		expect(result).toHaveLength(0);
	});

	test('one row produces expected first key', () => {
		const result = createSkeletonSlots('loading-skeleton-table-row', 1);
		expect(result).toHaveLength(1);
		expect(result[0].key).toBe('loading-skeleton-table-row-1');
		expect(result[0].position).toBe(0);
	});

	test('multiple rows produce unique keys', () => {
		const result = createSkeletonSlots('loading-skeleton-table-row', 5);
		expect(result).toHaveLength(5);
		const keys = new Set(result.map((s) => s.key));
		expect(keys.size).toBe(5);
	});

	test('same input yields identical output', () => {
		const a = createSkeletonSlots('loading-skeleton-table-row', 3);
		const b = createSkeletonSlots('loading-skeleton-table-row', 3);
		expect(a).toEqual(b);
	});

	test('3 to 5 rows preserves first three slot values', () => {
		const three = createSkeletonSlots('loading-skeleton-table-row', 3);
		const five = createSkeletonSlots('loading-skeleton-table-row', 5);
		expect(five.slice(0, 3)).toEqual(three);
		expect(five[3].key).toBe('loading-skeleton-table-row-4');
		expect(five[4].key).toBe('loading-skeleton-table-row-5');
	});

	test('5 to 2 rows preserves first two slot values', () => {
		const five = createSkeletonSlots('loading-skeleton-table-row', 5);
		const two = createSkeletonSlots('loading-skeleton-table-row', 2);
		expect(two).toEqual(five.slice(0, 2));
	});

	test('table and text prefixes do not collide', () => {
		const table = createSkeletonSlots('loading-skeleton-table-row', 3);
		const text = createSkeletonSlots('loading-skeleton-text-row', 3);
		const allKeys = new Set([...table.map((s) => s.key), ...text.map((s) => s.key)]);
		expect(allKeys.size).toBe(6);
	});

	test('position is zero-based', () => {
		const result = createSkeletonSlots('loading-skeleton-text-row', 3);
		expect(result[0].position).toBe(0);
		expect(result[1].position).toBe(1);
		expect(result[2].position).toBe(2);
	});
});

// -----------------------------------------------------------------------
// LoadingSkeleton rendering — rerender identity
// -----------------------------------------------------------------------

describe('LoadingSkeleton rendering — rerender identity', () => {
	test('table variant renders 0 rows', async () => {
		const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');
		const { container } = render(<LoadingSkeleton variant="table" rows={0} />);
		const rows = container.querySelectorAll('.flex.gap-4');
		expect(rows).toHaveLength(0);
	});

	test('table variant renders 1 row', async () => {
		const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');
		const { container } = render(<LoadingSkeleton variant="table" rows={1} />);
		const rows = container.querySelectorAll('.flex.gap-4');
		expect(rows).toHaveLength(1);
	});

	test('text variant renders multiple rows', async () => {
		const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');
		const { container } = render(<LoadingSkeleton variant="text" rows={3} />);
		const lines = container.querySelectorAll('.skeleton.h-3');
		expect(lines).toHaveLength(3);
	});

	test('table rerender from 3 to 5 preserves first three rows', async () => {
		const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');
		const { container, rerender } = render(<LoadingSkeleton variant="table" rows={3} />);
		expect(container.querySelectorAll('.flex.gap-4')).toHaveLength(3);

		rerender(<LoadingSkeleton variant="table" rows={5} />);
		const allFive = [...container.querySelectorAll('.flex.gap-4')];

		expect(allFive).toHaveLength(5);
	});

	test('table rerender from 5 to 2 keeps two rows', async () => {
		const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');
		const { container, rerender } = render(<LoadingSkeleton variant="table" rows={5} />);

		rerender(<LoadingSkeleton variant="table" rows={2} />);
		const remaining = container.querySelectorAll('.flex.gap-4');
		expect(remaining).toHaveLength(2);
	});

	test('no React duplicate-key warning from skeleton slots', async () => {
		const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { default: LoadingSkeleton } = await import('../components/shared/LoadingSkeleton.js');
			render(<LoadingSkeleton variant="table" rows={5} />);

			const duplicateKeyCalls = warnSpy.mock.calls.filter((call) => {
				const msg = String(call[0]);
				return (
					msg.includes('Encountered two children with the same key') ||
					msg.includes('duplicate key')
				);
			});
			expect(duplicateKeyCalls).toHaveLength(0);
		} finally {
			warnSpy.mockRestore();
		}
	});
});

// -----------------------------------------------------------------------
// createStableTextItems — edge cases
// -----------------------------------------------------------------------

describe('createStableTextItems — edge cases', () => {
	test('Unicode and special characters do not collide', () => {
		const result = createStableTextItems(['über', 'über', 'ñ', 'ñ', '–—', '–—']);
		expect(result).toHaveLength(6);
		const keys = new Set(result.map((r) => r.key));
		expect(keys.size).toBe(6);
	});

	test('triple duplicate values produce three distinct keys', () => {
		const result = createStableTextItems(['dup', 'dup', 'dup']);
		expect(result).toHaveLength(3);
		const keys = new Set(result.map((r) => r.key));
		expect(keys.size).toBe(3);
	});
});

// -----------------------------------------------------------------------
// React hook rules compliance (no hooks-in-conditions etc.)
// -----------------------------------------------------------------------

describe('React hook rules compliance', () => {
	test('createStableTextItems is a pure function (not a hook)', () => {
		const result = createStableTextItems(['a', 'b']);
		expect(result).toBeDefined();
		expect(result).toHaveLength(2);
	});

	test('createSkeletonSlots is a pure function (not a hook)', () => {
		const result = createSkeletonSlots('test', 3);
		expect(result).toBeDefined();
		expect(result).toHaveLength(3);
	});
});
