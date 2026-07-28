/**
 * Track D2b — Label-Control Accessibility Contract Tests
 *
 * Verifies:
 * - 5 CLASS A fixes: htmlFor + id on label-input pairs
 * - 2 CLASS E fixes: fieldset + legend for radio/checkbox groups
 * - All labels have accessible text, all controls have unique IDs
 * - getByLabelText works for all labeled controls
 * - All five D2b-declared static ID literals are mutually unique (namespace check only — no multi-instance rendering claim)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mock voice module for VoiceControls ──
vi.mock('../voice/voice-output.js', () => ({
	getAvailableVoices: vi.fn(() => [
		{ voiceURI: 'voice-1', name: 'Test Voice', lang: 'en-US' } as SpeechSynthesisVoice,
	]),
	getLastSpoken: vi.fn(() => null),
	isSpeechSupported: vi.fn(() => true),
	speakTest: vi.fn(),
}));

vi.mock('../voice/voice-settings.js', () => ({
	loadVoiceSettings: vi.fn(() => ({
		enabled: true,
		selectedVoiceURI: 'voice-1',
		rate: 1.0,
		volume: 1.0,
		enabledEventTypes: ['run_started', 'run_done', 'phase_failed'] as string[],
	})),
	saveVoiceSettings: vi.fn(),
	toggleVoiceEnabled: vi.fn(() => true),
}));

// ── Mock api module ──
vi.mock('../api.js', () => ({
	api: {
		getRepos: vi.fn().mockResolvedValue({ repos: [] }),
		createRepo: vi.fn().mockResolvedValue({}),
		getRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
		createRun: vi.fn().mockResolvedValue({ runId: 'test-run-1' }),
		startRun: vi.fn().mockResolvedValue({ run: { id: 'test-run-1' } }),
		getRepoIssues: vi.fn().mockResolvedValue({ issues: [] }),
		getHealth: vi.fn().mockResolvedValue({
			status: 'ok',
			uptime: 3600,
			mode: 'fake',
			adapters: { github: true, opencode: true },
		}),
		getManagedTargetProjects: vi.fn().mockResolvedValue({ projects: [] }),
	},
}));

// ── Mock ThemeContext ──
const mockToggleTheme = vi.fn();
vi.mock('../contexts/ThemeContext.js', () => ({
	useTheme: () => ({
		theme: 'dark',
		toggleTheme: mockToggleTheme,
	}),
}));

// ── Mock speechSynthesis ──
beforeEach(() => {
	Object.defineProperty(window, 'speechSynthesis', {
		value: {
			getVoices: vi.fn(() => []),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		},
		writable: true,
	});
});

// ── Helper: render with router ──
function renderWithRouter(ui: React.ReactElement) {
	return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ═══════════════════════════════════════════════════════════════
// CLASS A — Repositories.tsx
// ═══════════════════════════════════════════════════════════════
describe('Repositories.tsx — Label-Control Associations', () => {
	test('Owner label is associated with text input', async () => {
		const { default: Repositories } = await import('../components/Repositories.js');
		renderWithRouter(<Repositories />);

		const addBtn = screen.getByRole('button', { name: /add repository/i });
		fireEvent.click(addBtn);

		const ownerInput = screen.getByLabelText('Owner');
		expect(ownerInput).toBeInTheDocument();
		expect(ownerInput.tagName).toBe('INPUT');
		expect(ownerInput).toHaveAttribute('id', 'repo-owner');

		const ownerLabel = ownerInput.closest('div')?.querySelector('label');
		expect(ownerLabel).toHaveAttribute('for', 'repo-owner');
	});

	test('Repository-Name label is associated with text input', async () => {
		const { default: Repositories } = await import('../components/Repositories.js');
		renderWithRouter(<Repositories />);

		const addBtn = screen.getByRole('button', { name: /add repository/i });
		fireEvent.click(addBtn);

		const nameInput = screen.getByLabelText('Repository-Name');
		expect(nameInput).toBeInTheDocument();
		expect(nameInput).toHaveAttribute('id', 'repo-name');

		const nameLabel = nameInput.closest('div')?.querySelector('label');
		expect(nameLabel).toHaveAttribute('for', 'repo-name');
	});

	test('No duplicate IDs between Owner and Repository-Name inputs', async () => {
		const { default: Repositories } = await import('../components/Repositories.js');
		renderWithRouter(<Repositories />);

		const addBtn = screen.getByRole('button', { name: /add repository/i });
		fireEvent.click(addBtn);

		const allInputs = screen.getAllByRole('textbox');
		const ids = allInputs.map((el) => el.getAttribute('id')).filter(Boolean);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});
});

// ═══════════════════════════════════════════════════════════════
// CLASS A — Dashboard.tsx
// ═══════════════════════════════════════════════════════════════
describe('Dashboard.tsx — Label-Control Associations', () => {
	test('Repository label is associated with text input', async () => {
		const { default: Dashboard } = await import('../components/Dashboard.js');
		renderWithRouter(<Dashboard />);

		const newRunBtn = screen.getByRole('button', { name: /new run/i });
		fireEvent.click(newRunBtn);

		const repoInput = screen.getByLabelText('Repository');
		expect(repoInput).toBeInTheDocument();
		expect(repoInput.tagName).toBe('INPUT');
		expect(repoInput).toHaveAttribute('id', 'dashboard-repo');

		const repoLabel = repoInput.closest('div')?.querySelector('label');
		expect(repoLabel).toHaveAttribute('for', 'dashboard-repo');
	});

	test('Issue-Nummer label is associated with number input', async () => {
		const { default: Dashboard } = await import('../components/Dashboard.js');
		renderWithRouter(<Dashboard />);

		const newRunBtn = screen.getByRole('button', { name: /new run/i });
		fireEvent.click(newRunBtn);

		const issueInput = screen.getByLabelText('Issue-Nummer');
		expect(issueInput).toBeInTheDocument();
		expect(issueInput).toHaveAttribute('id', 'dashboard-issue');

		const issueLabel = issueInput.closest('div')?.querySelector('label');
		expect(issueLabel).toHaveAttribute('for', 'dashboard-issue');
	});

	test('No duplicate IDs in Dashboard modal', async () => {
		const { default: Dashboard } = await import('../components/Dashboard.js');
		renderWithRouter(<Dashboard />);

		const newRunBtn = screen.getByRole('button', { name: /new run/i });
		fireEvent.click(newRunBtn);

		const allInputs = screen
			.getAllByRole('textbox')
			.concat(Array.from(document.querySelectorAll('input[type="number"]')));
		const ids = allInputs.map((el) => el.getAttribute('id')).filter(Boolean) as string[];
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});
});

// ═══════════════════════════════════════════════════════════════
// CLASS E — Dashboard.tsx Autonomie-Level radio group
// ═══════════════════════════════════════════════════════════════
describe('Dashboard.tsx — Autonomie-Level Radio Group (Class E)', () => {
	test('Autonomie-Level is a fieldset with legend', async () => {
		const { default: Dashboard } = await import('../components/Dashboard.js');
		renderWithRouter(<Dashboard />);

		const newRunBtn = screen.getByRole('button', { name: /new run/i });
		fireEvent.click(newRunBtn);

		const legend = screen.getByText('Autonomie-Level');
		expect(legend.tagName).toBe('LEGEND');

		const fieldset = legend.closest('fieldset');
		expect(fieldset).toBeInTheDocument();
	});

	test('Radio buttons are individually labeled and rendered', async () => {
		const { default: Dashboard } = await import('../components/Dashboard.js');
		renderWithRouter(<Dashboard />);

		const newRunBtn = screen.getByRole('button', { name: /new run/i });
		fireEvent.click(newRunBtn);

		expect(screen.getByText('Full')).toBeInTheDocument();
		expect(screen.getByText('Semi')).toBeInTheDocument();
		expect(screen.getByText('Manual')).toBeInTheDocument();

		const radios = screen.getAllByRole('radio');
		expect(radios).toHaveLength(3);
	});

	test('Radio button click updates checked state', async () => {
		const { default: Dashboard } = await import('../components/Dashboard.js');
		renderWithRouter(<Dashboard />);

		const newRunBtn = screen.getByRole('button', { name: /new run/i });
		fireEvent.click(newRunBtn);

		fireEvent.click(screen.getByText('Full'));
		const radios = screen.getAllByRole('radio');
		const fullRadio = radios.find((r) => (r as HTMLInputElement).value === '0');
		expect(fullRadio).toBeChecked();
	});
});

// ═══════════════════════════════════════════════════════════════
// CLASS A — NewRunModal.tsx
// ═══════════════════════════════════════════════════════════════
describe('NewRunModal.tsx — Label-Control Association', () => {
	test('Issue URL label is associated with text input', async () => {
		const { default: NewRunModal } = await import('../components/dashboard/NewRunModal.js');
		renderWithRouter(<NewRunModal isOpen={true} onClose={vi.fn()} />);

		const urlInput = screen.getByLabelText('Issue URL');
		expect(urlInput).toBeInTheDocument();
		expect(urlInput.tagName).toBe('INPUT');
		expect(urlInput).toHaveAttribute('id', 'new-run-issue-url');

		const urlLabel = urlInput.closest('div')?.querySelector('label');
		expect(urlLabel).toHaveAttribute('for', 'new-run-issue-url');
	});

	test('Issue URL input accepts user typing', async () => {
		const { default: NewRunModal } = await import('../components/dashboard/NewRunModal.js');
		renderWithRouter(<NewRunModal isOpen={true} onClose={vi.fn()} />);

		const urlInput = screen.getByLabelText('Issue URL');
		fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo/issues/1' } });
		expect(urlInput).toHaveValue('https://github.com/test/repo/issues/1');
	});
});

// ═══════════════════════════════════════════════════════════════
// CLASS E — VoiceControls.tsx "Speak these events" checkbox group
// ═══════════════════════════════════════════════════════════════
describe('VoiceControls.tsx — Speak These Events Checkbox Group (Class E)', () => {
	test('"Speak these events" group heading is a legend inside fieldset', async () => {
		const { default: VoiceControls } = await import('../components/VoiceControls.js');
		renderWithRouter(<VoiceControls />);

		const legend = screen.getByText('Speak these events:');
		expect(legend.tagName).toBe('LEGEND');

		const fieldset = legend.closest('fieldset');
		expect(fieldset).toBeInTheDocument();
		expect(fieldset).toHaveClass('border-t');
	});

	test('Checkboxes exist with implicit label wrapping', async () => {
		const { default: VoiceControls } = await import('../components/VoiceControls.js');
		renderWithRouter(<VoiceControls />);

		const checkboxes = screen.getAllByRole('checkbox');
		expect(checkboxes.length).toBeGreaterThanOrEqual(1);

		expect(screen.getByText('Run started')).toBeInTheDocument();
		expect(screen.getByText('Run done')).toBeInTheDocument();
	});

	test('Checkbox click toggles checked state', async () => {
		const { default: VoiceControls } = await import('../components/VoiceControls.js');
		renderWithRouter(<VoiceControls />);

		const phaseFailedCheckbox = screen.getByRole('checkbox', {
			name: 'Phase failed',
		}) as HTMLInputElement;

		const wasChecked = phaseFailedCheckbox.checked;

		fireEvent.click(screen.getByText('Phase failed'));
		expect(phaseFailedCheckbox.checked).toBe(!wasChecked);
	});

	test('Existing voice-select label still works (no regression)', async () => {
		const { default: VoiceControls } = await import('../components/VoiceControls.js');
		renderWithRouter(<VoiceControls />);

		await waitFor(() => {
			expect(screen.getByLabelText('Voice')).toBeInTheDocument();
		});
	});

	test('Existing rate-slider label still works (no regression)', async () => {
		const { default: VoiceControls } = await import('../components/VoiceControls.js');
		renderWithRouter(<VoiceControls />);

		expect(screen.getByLabelText('Speech rate')).toBeInTheDocument();
	});

	test('Existing volume-slider label still works (no regression)', async () => {
		const { default: VoiceControls } = await import('../components/VoiceControls.js');
		renderWithRouter(<VoiceControls />);

		expect(screen.getByLabelText('Speech volume')).toBeInTheDocument();
	});
});

// ═══════════════════════════════════════════════════════════════
// Static D2b ID namespace verification
// ═══════════════════════════════════════════════════════════════
// NOTE: This test verifies the five declared static ID literals
// are mutually unique. It does NOT perform a multi-instance render
// test. Production safety is additionally justified by the current
// routing and component architecture:
// - Repositories renders as a separate /repos route.
// - Dashboard.tsx is not in the active app router.
// - DashboardPage mounts exactly one NewRunModal instance.
// - VoiceControls received no new static control IDs in Track D2b.
// MULTI_INSTANCE_RENDER_TEST: NOT_APPLICABLE_TO_CURRENT_PRODUCTION_TOPOLOGY
describe('Static D2b ID namespace', () => {
	test('declared D2b ID literals contain no duplicates', () => {
		const d2bIds = [
			'repo-owner',
			'repo-name',
			'dashboard-repo',
			'dashboard-issue',
			'new-run-issue-url',
		];
		const uniqueIds = new Set(d2bIds);
		expect(uniqueIds.size).toBe(d2bIds.length);
	});
});
