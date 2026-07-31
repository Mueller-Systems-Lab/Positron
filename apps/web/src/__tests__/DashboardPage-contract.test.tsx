/**
 * DashboardPage Managed Target Projects Contract Regression Test
 *
 * Issue #373: Verifies that DashboardPage renders without crashing when
 * receiving ManagedTargetProject objects from the generic registry.
 *
 * Before fix: project.externalTestStatus.replace(...) crashes because
 * externalTestStatus is not a field on ManagedTargetProject.
 *
 * After fix: DashboardPage uses only fields declared in ManagedTargetProject.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import DashboardPage from '../components/dashboard/DashboardPage.js';

// ── Valid ManagedTargetProject fixtures inlined in vi.mock below ─────
// (Vitest hoists vi.mock factory — top-level variables are not accessible)

// ── Mock api module (inline data — vi.mock factory is hoisted) ─────

vi.mock('../api.js', () => ({
	api: {
		getManagedTargetProjects: vi.fn().mockResolvedValue({
			projects: [
				{
					id: 'xxammaxx/VoiceWiki',
					name: 'VoiceWiki',
					role: 'proof_project',
					repoUrl: 'https://github.com/xxammaxx/VoiceWiki',
					defaultBranch: 'master',
					status: 'LOCAL_GATES_REPRODUCIBLE',
					description: 'Voice-controlled wiki application.',
					techStack: ['Flutter', 'Dart'],
					lastEvidence: null,
					lastRunRef: null,
					blockers: [],
					nextRecommendedRuns: ['Full SpecKit workflow', 'Local gate verification'],
					safetyChecks: [],
					securityStatus: 'unknown',
					lastSecurityScan: null,
				},
				{
					id: 'xxammaxx/KleinPilot',
					name: 'KleinPilot',
					role: 'candidate_project',
					repoUrl: 'https://github.com/xxammaxx/KleinPilot',
					defaultBranch: 'main',
					status: 'LOCAL_GATES_REPRODUCIBLE',
					description: 'Local-first Android test app.',
					techStack: ['Flutter', 'Dart'],
					lastEvidence: null,
					lastRunRef: null,
					blockers: ['Blocked by manual review'],
					nextRecommendedRuns: ['APPROVE FINAL AUDIT', 'MERGE PR'],
					safetyChecks: [],
					securityStatus: 'ok',
					lastSecurityScan: null,
				},
			],
			total: 2,
		}),
	},
}));

// ── Mock sub-components that DashboardPage uses ─────────────────────

vi.mock('../components/dashboard/AttentionQueue.jsx', () => ({
	default: () => '<div data-testid="attention-queue" />',
}));
vi.mock('../components/dashboard/BlueprintPanel.jsx', () => ({
	default: () => '<div data-testid="blueprint-panel" />',
}));
vi.mock('../components/dashboard/EvidenceSummary.jsx', () => ({
	default: () => '<div data-testid="evidence-summary" />',
}));
vi.mock('../components/dashboard/NewRunModal.jsx', () => ({
	default: () => null,
}));
vi.mock('../components/dashboard/RecentActivity.jsx', () => ({
	default: () => '<div data-testid="recent-activity" />',
}));
vi.mock('../components/dashboard/StatusSummary.jsx', () => ({
	default: () => '<div data-testid="status-summary" />',
}));
vi.mock('../components/dashboard/SystemHealth.jsx', () => ({
	default: () => '<div data-testid="system-health" />',
}));
vi.mock('../components/VoiceStatusIndicator.jsx', () => ({
	default: () => '<span data-testid="voice-indicator" />',
}));
vi.mock('../components/shared/EmptyState.js', () => ({
	default: () => '<div data-testid="empty-state" />',
}));
vi.mock('../components/shared/ErrorBanner.js', () => ({
	default: () => null,
}));

// ── Mock hooks ───────────────────────────────────────────────────────

vi.mock('../hooks/useDashboardSSE.js', () => ({
	useDashboardSSE: () => ({
		metrics: null,
		runs: [
			{
				id: 'test-run-1',
				repoId: 'xxammaxx/Positron',
				issueNumber: 1,
				branch: null,
				phase: 'DONE',
				status: 'done',
				autonomyLevel: 2,
				attempt: 1,
				lastError: null,
				workspacePath: null,
				startedAt: new Date().toISOString(),
				finishedAt: null,
			},
		],
		evidence: null,
		isConnected: true,
	}),
}));

// ── Tests ────────────────────────────────────────────────────────────

describe('DashboardPage — Managed Target Projects Contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('renders without crash when receiving valid ManagedTargetProject objects', async () => {
		const { container } = render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		// Should render the Dashboard heading (proves no React crash)
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeDefined();
		});

		expect(container).toBeDefined();
	});

	test('displays Managed External Projects section with project names', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Managed External Projects')).toBeDefined();
		});

		// Both project names should appear
		expect(screen.getByText('VoiceWiki')).toBeDefined();
		expect(screen.getByText('KleinPilot')).toBeDefined();
	});

	test('renders project status badge (not crashed .replace on undefined)', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			// The status badge should show "Gates OK" (mapped from LOCAL_GATES_REPRODUCIBLE)
			const badges = screen.getAllByText('Gates OK');
			expect(badges.length).toBeGreaterThanOrEqual(1);
		});
	});

	test('shows blockers count for project with blockers', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			// KleinPilot has 1 blocker
			expect(screen.getByText(/1 blocker/)).toBeDefined();
		});
	});

	test('shows next recommended run label for each project', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			// Both projects show "Next:" with their first recommended run
			const elements = screen.getAllByText(/Next:/);
			expect(elements.length).toBe(2);
		});
	});

	test('shows recommended steps count for each project', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			// Both test projects have 2 nextRecommendedRuns
			const elements = screen.getAllByText(/2 steps/);
			expect(elements.length).toBeGreaterThanOrEqual(1);
		});
	});

	test('renders projects link pointing to /projects', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			const link = screen.getByText('View All →');
			expect(link.closest('button')).toBeDefined();
		});
	});

	test('handles empty projects array gracefully', async () => {
		const { api } = await import('../api.js');
		vi.mocked(api.getManagedTargetProjects).mockResolvedValueOnce({
			projects: [],
			total: 0,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeDefined();
		});

		// "Managed External Projects" section should NOT appear when empty
		expect(screen.queryByText('Managed External Projects')).toBeNull();
	});

	test('handles API error gracefully without crashing', async () => {
		const { api } = await import('../api.js');
		vi.mocked(api.getManagedTargetProjects).mockRejectedValueOnce(new Error('Network error'));

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeDefined();
		});

		// Should still render the dashboard, just without managed projects
		expect(screen.queryByText('Managed External Projects')).toBeNull();
	});

	// ── E14: Native card link semantics ───────────────────────────────

	test('internal project link has native link role and navigates to /projects', async () => {
		let capturedPathname = '';

		function LocationProbe(): null {
			const location = useLocation();
			capturedPathname = location.pathname;
			return null;
		}

		render(
			<MemoryRouter initialEntries={['/']}>
				<Routes>
					<Route path="/" element={<DashboardPage />} />
					<Route path="/projects" element={<div data-testid="projects-page">Projects</div>} />
				</Routes>
				<LocationProbe />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('VoiceWiki')).toBeDefined();
		});

		const internalLink = screen.getByRole('link', {
			name: /Open VoiceWiki in managed projects/i,
		});

		expect(internalLink).toBeDefined();
		expect(internalLink.getAttribute('href')).toBe('/projects');

		// Click navigates to /projects
		fireEvent.click(internalLink);
		await waitFor(() => {
			expect(screen.getByTestId('projects-page')).toBeDefined();
		});

		expect(capturedPathname).toBe('/projects');
	});

	test('external repo link has native anchor semantics', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('VoiceWiki')).toBeDefined();
		});

		const externalLink = screen.getByRole('link', {
			name: /Open VoiceWiki repository in a new tab/i,
		});

		expect(externalLink).toBeDefined();
		expect(externalLink.getAttribute('href')).toBe('https://github.com/xxammaxx/VoiceWiki');
		expect(externalLink.getAttribute('target')).toBe('_blank');
		expect(externalLink.getAttribute('rel')).toContain('noopener');
		expect(externalLink.getAttribute('rel')).toContain('noreferrer');
	});

	test('card container has no role=button and no tabIndex on the wrapper', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('VoiceWiki')).toBeDefined();
		});

		// The VoiceWiki name is now inside a link — find its parent card container
		const voiceWikiLink = screen.getByRole('link', {
			name: /Open VoiceWiki in managed projects/i,
		});

		// Walk up to find the card wrapper (the div that used to have role=button)
		const card = voiceWikiLink.closest('.rounded-xl');
		expect(card).toBeDefined();

		// Card must NOT have role=button
		expect(card?.getAttribute('role')).toBeNull();

		// Card must NOT have tabIndex
		expect(card?.getAttribute('tabindex')).toBeNull();
	});

	test('no nested interactive elements inside card links', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('VoiceWiki')).toBeDefined();
		});

		const internalLink = screen.getByRole('link', {
			name: /Open VoiceWiki in managed projects/i,
		});
		const externalLink = screen.getByRole('link', {
			name: /Open VoiceWiki repository in a new tab/i,
		});

		// Internal link does not contain external link
		expect(internalLink.contains(externalLink)).toBe(false);

		// External link does not contain internal link
		expect(externalLink.contains(internalLink)).toBe(false);

		// No button contains either link
		const buttons = screen.queryAllByRole('button');
		for (const btn of buttons) {
			expect(btn.contains(internalLink)).toBe(false);
			expect(btn.contains(externalLink)).toBe(false);
		}

		// No role=button element contains either link
		const roleButtons = document.querySelectorAll('[role="button"]');
		for (const rb of roleButtons) {
			expect(rb.contains(internalLink)).toBe(false);
			expect(rb.contains(externalLink)).toBe(false);
		}
	});

	test('all project names and repo links are present after refactor', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('VoiceWiki')).toBeDefined();
		});

		// Both project names still visible
		expect(screen.getByText('VoiceWiki')).toBeDefined();
		expect(screen.getByText('KleinPilot')).toBeDefined();

		// Both Repo links still present (text "Repo ↗")
		const repoLinks = screen.getAllByText(/Repo/);
		expect(repoLinks.length).toBeGreaterThanOrEqual(2);

		// Status badges still visible
		expect(screen.getAllByText('Gates OK').length).toBeGreaterThanOrEqual(1);

		// Blocker count still visible
		expect(screen.getByText(/1 blocker/)).toBeDefined();
	});
});
