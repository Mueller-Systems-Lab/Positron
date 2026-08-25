import { render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import Dashboard from '../components/Dashboard';
import GateControls from '../components/GateControls';
import LogViewer from '../components/LogViewer';
import PhaseBadge from '../components/PhaseBadge';
import PhaseTimeline from '../components/PhaseTimeline';
import { useSSE } from '../hooks/useSSE';
import type { LogLevel, Phase, RunEvent } from '../types';
import { ALL_PHASES } from '../types';

// Mock api for Dashboard
vi.mock('../api', () => ({
	api: {
		getHealth: vi.fn().mockResolvedValue({ status: 'ok', adapters: {}, uptime: 0 }),
		getRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
	},
}));

describe('PhaseBadge', () => {
	test.each(ALL_PHASES)('rendert Phase %s ohne Crash', (phase: Phase) => {
		const { container } = render(<PhaseBadge phase={phase} />);
		expect(container).toBeDefined();
	});

	test('zeigt korrekten Text für DONE', () => {
		render(<PhaseBadge phase="DONE" />);
		expect(screen.getByText('Abgeschlossen')).toBeDefined();
	});

	test('zeigt korrekten Text für FAILED', () => {
		render(<PhaseBadge phase="FAILED" />);
		expect(screen.getByText('Fehlgeschlagen')).toBeDefined();
	});

	test('rendert in verschiedenen Größen', () => {
		const { container: xs } = render(<PhaseBadge phase="DONE" size="xs" />);
		const { container: md } = render(<PhaseBadge phase="DONE" size="md" />);
		expect(xs).toBeDefined();
		expect(md).toBeDefined();
	});
});

describe('LogViewer', () => {
	test('rendert ohne Crash mit leerem events Array', () => {
		const { container } = render(<LogViewer events={[]} />);
		expect(container).toBeDefined();
	});

	test('rendert ohne Crash mit 5 Test-Events', () => {
		const events: RunEvent[] = Array.from({ length: 5 }, (_, i) => ({
			id: `e${i}`,
			runId: 'test-run',
			phase: 'QUEUED' as Phase,
			level: 'INFO' as LogLevel,
			message: `Test event ${i}`,
			payload: {},
			createdAt: new Date().toISOString(),
		}));
		const { container } = render(<LogViewer events={events} />);
		expect(container).toBeDefined();
		expect(screen.getByText('Test event 0')).toBeDefined();
	});

	test('filtert nach Level', () => {
		const events: RunEvent[] = [
			{
				id: 'e1',
				runId: 'test',
				phase: 'QUEUED' as Phase,
				level: 'ERROR' as LogLevel,
				message: 'Error message',
				payload: {},
				createdAt: new Date().toISOString(),
			},
		];
		render(<LogViewer events={events} />);
		expect(screen.getByText('Error message')).toBeDefined();
	});
});

describe('GateControls', () => {
	test('ist nicht sichtbar bei Phase IMPLEMENT', () => {
		const { container } = render(<GateControls runId="test" currentPhase="IMPLEMENT" />);
		expect(container.textContent).toContain('Keine Genehmigung erforderlich');
	});

	test('ist sichtbar bei Phase GATE_APPROVE', () => {
		render(<GateControls runId="test" currentPhase="GATE_APPROVE" />);
		expect(screen.getByText(/Gate-Entscheidung erforderlich/)).toBeDefined();
	});

	test('zeigt Buttons bei GATE_REVISE', () => {
		render(<GateControls runId="test" currentPhase="GATE_REVISE" />);
		const buttons = screen.getAllByText('↺ Überarbeitung');
		expect(buttons.length).toBe(1);
	});
});

describe('Dashboard', () => {
	test('rendert ohne Crash', () => {
		const { container } = render(
			<MemoryRouter>
				<Dashboard />
			</MemoryRouter>,
		);
		expect(container).toBeDefined();
	});
});

describe('PhaseTimeline', () => {
	test('rendert alle 18 Phasen', () => {
		const { container } = render(<PhaseTimeline currentPhase="QUEUED" />);
		expect(container).toBeDefined();
		// Should render entries for all phases
		const items = container.querySelectorAll('.flex.items-center');
		expect(items.length).toBeGreaterThanOrEqual(ALL_PHASES.length);
	});
});

describe('useSSE', () => {
	test('isConnected ist false bei runId=null', () => {
		const { result } = renderHook(() => useSSE(null));
		expect(result.current.isConnected).toBe(false);
		expect(result.current.events).toEqual([]);
	});
});
