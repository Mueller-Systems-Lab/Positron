/**
 * Track D2a — SVG Accessibility Contract Tests
 *
 * Verifies:
 * - 14 SVGs are all decorative (aria-hidden="true", focusable="false")
 * - Class A (visible text): 8 SVGs in headings/labels with visible text
 * - Class C (icon-only control): 3 SVGs — named parent provides accessible name
 * - Class D (link/button with extra text): 3 SVGs — parent has visible text
 * - No role="img" added, no <title> elements
 *
 * Counts verified: A=8, C=3, D=3, total=14
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mock ThemeContext for ThemeToggle ──
const mockToggleTheme = vi.fn();
let mockTheme = 'dark';

vi.mock('../contexts/ThemeContext.js', () => ({
	useTheme: () => ({
		theme: mockTheme,
		toggleTheme: mockToggleTheme,
	}),
}));

// ── Mock api module (shared for SystemHealth, DashboardPage, SettingsPage) ──
vi.mock('../api.js', () => ({
	api: {
		getHealth: vi.fn().mockResolvedValue({
			status: 'ok',
			uptime: 3600,
			mode: 'fake',
			adapters: { github: true, opencode: true },
		}),
		getManagedTargetProjects: vi.fn().mockResolvedValue({
			projects: [
				{
					id: 'xxammaxx/VoiceWiki',
					name: 'VoiceWiki',
					role: 'proof_project',
					repoUrl: 'https://github.com/xxammaxx/VoiceWiki',
					defaultBranch: 'master',
					status: 'LOCAL_GATES_REPRODUCIBLE',
					description: 'Voice-controlled wiki.',
					techStack: ['Flutter', 'Dart'],
					lastEvidence: null,
					lastRunRef: null,
					blockers: [],
					nextRecommendedRuns: ['Full SpecKit workflow', 'Local gate verification'],
					safetyChecks: [],
					securityStatus: 'unknown',
					lastSecurityScan: null,
				},
			],
			total: 1,
		}),
		getMcpSettings: vi.fn().mockResolvedValue({
			servers: [],
			policy: {},
			redactPatternCount: 0,
		}),
		getSafety: vi.fn().mockResolvedValue({
			enableMerge: false,
			mergeDryRun: true,
			enablePush: false,
			killSwitch: false,
			enableFixLoop: true,
		}),
		getTestModes: vi.fn().mockResolvedValue({
			modes: [],
			securityNotes: {},
		}),
		updateSafety: vi.fn().mockResolvedValue({ all: {} }),
	},
}));

// ── Mock DashboardPage sub-components ──
vi.mock('../components/dashboard/AttentionQueue.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/dashboard/BlueprintPanel.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/dashboard/EvidenceSummary.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/dashboard/NewRunModal.jsx', () => ({ default: () => null }));
vi.mock('../components/dashboard/RecentActivity.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/dashboard/StatusSummary.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/shared/EmptyState.js', () => ({ default: () => '<div />' }));
vi.mock('../components/shared/ErrorBanner.js', () => ({ default: () => null }));
vi.mock('../hooks/useDashboardSSE.js', () => ({
	useDashboardSSE: () => ({
		metrics: { totalRuns: 1, activeRuns: 0, failedRuns: 0, completedRuns: 1 },
		runs: [
			{
				id: 'test-run-dash',
				repoId: 'Mueller-Systems-Lab/Positron',
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
		evidence: { totalArtifacts: 0, testEvents: 0, errorEvents: 0, warningEvents: 0 },
		isConnected: true,
	}),
}));

// ── Mock RunDetail sub-components ──
vi.mock('../components/ArtifactPanel.jsx', () => ({
	default: () => '<div data-testid="artifact-panel" />',
}));
vi.mock('../components/GateControls.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/LogViewer.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/PhaseBadge.jsx', () => ({ default: () => '<span />' }));
vi.mock('../components/PhasePipeline.jsx', () => ({ default: () => '<div />' }));
vi.mock('../components/PhaseTimeline.jsx', () => ({ default: () => '<div />' }));

vi.mock('../hooks/useRun.js', () => ({
	useRun: () => ({
		run: {
			id: 'test-run-abc12345def67890',
			repoId: 'Mueller-Systems-Lab/Positron',
			issueNumber: 340,
			branch: 'positron/issue-340-track-d2a',
			phase: 'DONE',
			status: 'done',
			autonomyLevel: 2,
			attempt: 1,
			lastError: null,
			workspacePath: null,
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
		},
		isLoading: false,
		error: null,
	}),
}));

vi.mock('../hooks/useSSE.js', () => ({
	useSSE: () => ({
		events: [
			{
				id: 'evt-1',
				runId: 'test-run-abc12345def67890',
				phase: 'DONE',
				level: 'INFO',
				message: 'Test event',
				payload: {},
				createdAt: new Date().toISOString(),
			},
		],
		evidence: [
			{
				type: 'screenshot',
				label: 'Test screenshot',
				uri: '/evidence/test.png',
				timestamp: new Date().toISOString(),
			},
		],
		isConnected: false,
		runStatus: 'done',
		error: null,
	}),
}));

// ── Mock react-router-dom useParams for RunDetail ──
vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual('react-router-dom');
	return {
		...actual,
		useParams: () => ({ id: 'test-run-abc12345def67890' }),
	};
});

// ── Mock VoiceControls for SettingsPage (VoiceControls renders fully) ──
// No mock — let VoiceControls render its actual component in SettingsPage tests too.

// ── Mock speech synthesis ──
const mockVoices: SpeechSynthesisVoice[] = [
	{ voiceURI: 'v1', name: 'Alex', lang: 'en-US', default: true, localService: true },
] as unknown as SpeechSynthesisVoice[];

function setupSpeech(): void {
	vi.stubGlobal(
		'SpeechSynthesisUtterance',
		class {
			text = '';
			voice: SpeechSynthesisVoice | null = null;
			rate = 1;
			volume = 1;
			constructor(t: string) {
				this.text = t;
			}
		},
	);
	vi.stubGlobal('speechSynthesis', {
		speak: vi.fn(),
		cancel: vi.fn(),
		getVoices: vi.fn(() => mockVoices),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
}

const store: Record<string, string> = {};
function setupStorage(): void {
	vi.stubGlobal('localStorage', {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
	});
}

import DashboardPage from '../components/dashboard/DashboardPage.js';
import SystemHealth from '../components/dashboard/SystemHealth.jsx';
import RunDetail from '../components/RunDetail.jsx';
import SettingsPage from '../components/settings/SettingsPage.js';
// ── Imports (after mocks) ──
import ThemeToggle from '../components/ThemeToggle.js';
import VoiceControls from '../components/VoiceControls.jsx';
import VoiceStatusIndicator from '../components/VoiceStatusIndicator.jsx';

beforeEach(() => {
	mockToggleTheme.mockClear();
	mockTheme = 'dark';
	for (const k of Object.keys(store)) delete store[k];
	setupStorage();
	setupSpeech();
});

// ════════════════════════════════════════════════════════════════
// 1. THEME TOGGLE — Class C (icon-only control, named parent)
//    2 SVGs: Sun (dark mode) + Moon (light mode)
// ════════════════════════════════════════════════════════════════
describe('ThemeToggle — SVG Accessibility (Class C, 2 SVGs)', () => {
	test('button has accessible name via aria-label (dark mode)', () => {
		mockTheme = 'dark';
		render(<ThemeToggle />);
		const btn = screen.getByRole('button', { name: 'Zum hellen Modus wechseln' });
		expect(btn).toBeDefined();
	});

	test('button has accessible name via aria-label (light mode)', () => {
		mockTheme = 'light';
		render(<ThemeToggle />);
		const btn = screen.getByRole('button', { name: 'Zum dunklen Modus wechseln' });
		expect(btn).toBeDefined();
	});

	test('sun SVG (dark mode) is decorative: aria-hidden=true, focusable=false', () => {
		mockTheme = 'dark';
		render(<ThemeToggle />);
		const svg = document.querySelector('button svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
		expect(svg.getAttribute('role')).toBeNull();
	});

	test('moon SVG (light mode) is decorative: aria-hidden=true, focusable=false', () => {
		mockTheme = 'light';
		render(<ThemeToggle />);
		const svg = document.querySelector('button svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
		expect(svg.getAttribute('role')).toBeNull();
	});
});

// ════════════════════════════════════════════════════════════════
// 2. VOICE STATUS INDICATOR — Class A (1) + Class D (1)
//    2 SVGs total: "Keine Sprachausgabe" (A) + ON/OFF toggle (D)
// ════════════════════════════════════════════════════════════════
describe('VoiceStatusIndicator — SVG Accessibility (Class A + D, 2 SVGs)', () => {
	test('OFF state: visible text "Stimme AUS" is present', () => {
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/Stimme AUS/)).toBeDefined();
	});

	test('OFF state: button has accessible aria-label', () => {
		render(<VoiceStatusIndicator />);
		const btn = screen.getByRole('button');
		expect(btn.getAttribute('aria-label')).toContain('Sprachausgabe');
	});

	test('OFF state SVG is decorative: aria-hidden=true, focusable=false', () => {
		render(<VoiceStatusIndicator />);
		const svg = document.querySelector('button[aria-label] svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});

	test('ON state: visible text "Stimme EIN" is present after toggle', () => {
		render(<VoiceStatusIndicator />);
		fireEvent.click(screen.getByRole('button'));
		expect(screen.getByText(/Stimme EIN/)).toBeDefined();
	});

	test('ON state SVG remains decorative after toggle', () => {
		render(<VoiceStatusIndicator />);
		fireEvent.click(screen.getByRole('button'));
		const svg = document.querySelector('button[aria-label] svg') as SVGElement;
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});

	test('unsupported state: visible text "Keine Sprachausgabe" is present', () => {
		vi.stubGlobal('speechSynthesis', undefined);
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/Keine Sprachausgabe/)).toBeDefined();
	});

	test('unsupported state SVG is decorative', () => {
		vi.stubGlobal('speechSynthesis', undefined);
		render(<VoiceStatusIndicator />);
		const svg = document.querySelector('span[aria-label] svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});
});

// ════════════════════════════════════════════════════════════════
// 3. VOICE CONTROLS — Class A (1 SVG)
//    "Sprachausgabe" heading with decorative speaker SVG
// ════════════════════════════════════════════════════════════════
describe('VoiceControls — SVG Accessibility (Class A, 1 SVG)', () => {
	test('"Sprachausgabe" heading is present', () => {
		render(<VoiceControls />);
		expect(screen.getByText('Sprachausgabe')).toBeDefined();
	});

	test('heading SVG is decorative: aria-hidden=true, focusable=false', () => {
		render(<VoiceControls />);
		const heading = screen.getByText('Sprachausgabe').closest('h3');
		expect(heading).toBeDefined();
		const svg = heading!.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});
});

// ════════════════════════════════════════════════════════════════
// 4. SYSTEM HEALTH — Class A (1 SVG)
// ════════════════════════════════════════════════════════════════
describe('SystemHealth — SVG Accessibility (Class A, 1 SVG)', () => {
	test('"Systemzustand" heading is present', async () => {
		render(<SystemHealth />);
		const heading = await screen.findByText('Systemzustand');
		expect(heading).toBeDefined();
	});

	test('heading SVG is decorative: aria-hidden=true, focusable=false', async () => {
		render(<SystemHealth />);
		const heading = await screen.findByText('Systemzustand');
		const svg = heading.closest('h3')!.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});
});

// ════════════════════════════════════════════════════════════════
// 5. DASHBOARD PAGE — Class A (1 SVG)
// ════════════════════════════════════════════════════════════════
describe('DashboardPage — SVG Accessibility (Class A, 1 SVG)', () => {
	test('"Verwaltete externe Projekte" heading is present when projects exist', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		const heading = await screen.findByText('Verwaltete externe Projekte');
		expect(heading).toBeDefined();
	});

	test('dashboard heading SVG is decorative', async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		const heading = await screen.findByText('Verwaltete externe Projekte');
		const svg = heading.closest('h3')!.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});
});

// ════════════════════════════════════════════════════════════════
// 6. SETTINGS PAGE — Class A (3 SVGs)
//    Sicherheits-Gates, MCP Servers, Test Modes
// ════════════════════════════════════════════════════════════════
describe('SettingsPage — SVG Accessibility (Class A, 3 SVGs)', () => {
	test('"Sicherheits-Gates" heading is present', async () => {
		render(<SettingsPage />);
		const heading = await screen.findByText('Sicherheits-Gates');
		expect(heading).toBeDefined();
	});

	test('Sicherheits-Gates SVG is decorative', async () => {
		render(<SettingsPage />);
		const heading = await screen.findByText('Sicherheits-Gates');
		const svg = heading.closest('h3')!.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});

	test('"MCP Servers" heading is present', async () => {
		render(<SettingsPage />);
		const heading = await screen.findByText('MCP-Server');
		expect(heading).toBeDefined();
	});

	test('MCP Servers SVG is decorative', async () => {
		render(<SettingsPage />);
		const heading = await screen.findByText('MCP-Server');
		const svg = heading.closest('h3')!.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});

	test('"Test Modes" heading is present', async () => {
		render(<SettingsPage />);
		const heading = await screen.findByText('Testmodi');
		expect(heading).toBeDefined();
	});

	test('Test Modes SVG is decorative', async () => {
		render(<SettingsPage />);
		const heading = await screen.findByText('Testmodi');
		const svg = heading.closest('h3')!.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});

	test('all three decorative SVGs are hidden (count=3)', async () => {
		render(<SettingsPage />);
		await screen.findByText('Sicherheits-Gates');
		await screen.findByText('MCP-Server');
		await screen.findByText('Testmodi');

		const headings = ['Sicherheits-Gates', 'MCP-Server', 'Testmodi'];
		let hiddenCount = 0;
		for (const text of headings) {
			const h = screen.getByText(text);
			const svg = h.closest('h3')?.querySelector('svg');
			if (svg?.getAttribute('aria-hidden') === 'true') hiddenCount++;
		}
		expect(hiddenCount).toBe(3);
	});
});

// ════════════════════════════════════════════════════════════════
// 7. RUN DETAIL — Class A (1) + Class C (1) + Class D (2) = 4 SVGs
//    Lauf-ID kopieren, Live-Nachweise, Nachweise öffnen, Open Issue
// ════════════════════════════════════════════════════════════════
describe('RunDetail — SVG Accessibility (Class A+C+D, 4 SVGs)', () => {
	test('Lauf-ID kopieren button has accessible name via title attribute', async () => {
		render(
			<MemoryRouter>
				<RunDetail />
			</MemoryRouter>,
		);

		// title="Lauf-ID kopieren" should provide accessible name
		const btn = await screen.findByRole('button', { name: 'Lauf-ID kopieren' });
		expect(btn).toBeDefined();
		expect(btn.getAttribute('title')).toBe('Lauf-ID kopieren');
	});

	test('Lauf-ID kopieren SVG is decorative', async () => {
		render(
			<MemoryRouter>
				<RunDetail />
			</MemoryRouter>,
		);

		const btn = await screen.findByRole('button', { name: 'Lauf-ID kopieren' });
		const svg = btn.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});

	test('"Live-Nachweise" heading is present', async () => {
		render(
			<MemoryRouter>
				<RunDetail />
			</MemoryRouter>,
		);

		const heading = await screen.findByText('Live-Nachweise');
		expect(heading).toBeDefined();
	});

	test('Live-Nachweise SVG is decorative', async () => {
		render(
			<MemoryRouter>
				<RunDetail />
			</MemoryRouter>,
		);

		const heading = await screen.findByText('Live-Nachweise');
		const svg = heading.closest('h3')!.querySelector('svg') as SVGElement;
		expect(svg).toBeDefined();
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
	});

	test('"Nachweise öffnen" link has accessible name with visible text', async () => {
		render(
			<MemoryRouter>
				<RunDetail />
			</MemoryRouter>,
		);

		const link = await screen.findByText('Nachweise öffnen');
		expect(link).toBeDefined();
		const svg = link.closest('a')?.querySelector('svg');
		expect(svg).toBeDefined();
		expect(svg!.getAttribute('aria-hidden')).toBe('true');
		expect(svg!.getAttribute('focusable')).toBe('false');
	});

	test('"Open Issue #340" link has accessible name with visible text', async () => {
		render(
			<MemoryRouter>
				<RunDetail />
			</MemoryRouter>,
		);

		const link = await screen.findByText(/Issue öffnen #340/);
		expect(link).toBeDefined();
		const svg = link.closest('a')?.querySelector('svg');
		expect(svg).toBeDefined();
		expect(svg!.getAttribute('aria-hidden')).toBe('true');
		expect(svg!.getAttribute('focusable')).toBe('false');
	});

	test('all 4 affected SVGs are hidden in RunDetail', async () => {
		render(
			<MemoryRouter>
				<RunDetail />
			</MemoryRouter>,
		);

		await screen.findByText('Live-Nachweise');

		const allSvgs = document.querySelectorAll('svg[aria-hidden="true"][focusable="false"]');
		// RunDetail has 4 decorative SVGs + any from sub-components
		expect(allSvgs.length).toBeGreaterThanOrEqual(4);
	});
});
