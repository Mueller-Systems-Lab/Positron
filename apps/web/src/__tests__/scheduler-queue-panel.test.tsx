// P4 — Scheduler Queue Panel: Backend-Truth-Projektion (§59)
//
// Beweist:
// - rendert Queue-Items (Queued/Waiting/Running) aus Backend-Truth
// - zeigt Kapazität active/max
// - zeigt Priority + Reason Code
// - Fehlerzustand rendert ohne Absturz (Backend down)

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import SchedulerQueuePanel from '../components/mission/SchedulerQueuePanel';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('SchedulerQueuePanel — Backend Truth Projection', () => {
	it('rendert Queue-Items mit State, Priority, Reason und Kapazität', async () => {
		vi.spyOn(api, 'getSchedulerQueue').mockResolvedValue({
			queue: [
				{
					queue_item_id: 'q-1',
					source_type: 'issue',
					source_ref: 'issue/A',
					repository_ref: 'repo/A',
					run_id: 'run-A',
					priority: 'HIGH',
					queue_state: 'RUNNING',
					dependency_refs: [],
					enqueued_at: '2026-08-20T00:00:00.000Z',
					admitted_at: null,
					started_at: null,
					finished_at: null,
					reason_code: 'READY',
				},
				{
					queue_item_id: 'q-2',
					source_type: 'issue',
					source_ref: 'issue/B',
					repository_ref: 'repo/B',
					run_id: null,
					priority: 'NORMAL',
					queue_state: 'WAITING_RESOURCE',
					dependency_refs: [],
					enqueued_at: '2026-08-20T00:01:00.000Z',
					admitted_at: null,
					started_at: null,
					finished_at: null,
					reason_code: 'GLOBAL_RUN_LIMIT',
				},
			],
			capacity: { maxActiveRuns: 2, activeRuns: 1, queueDepth: 1, waitingDependency: 0, waitingResource: 1 },
		});
		vi.spyOn(api, 'getSchedulerCapacity').mockResolvedValue({
			maxActiveRuns: 2,
			activeRuns: 1,
			queueDepth: 1,
			waitingDependency: 0,
			waitingResource: 1,
		});

		render(<SchedulerQueuePanel />);
		await waitFor(() => expect(screen.getByText(/repo\/A/)).toBeTruthy());

		// Items mit Repository + Source-Ref
		expect(screen.getByText(/repo\/A/)).toBeTruthy();
		expect(screen.getByText(/repo\/B/)).toBeTruthy();
		// States (Backend-Label)
		expect(screen.getByText('Running')).toBeTruthy();
		expect(screen.getByText('Waiting Resource')).toBeTruthy();
		// Priority
		expect(screen.getByText('HIGH')).toBeTruthy();
		expect(screen.getByText('NORMAL')).toBeTruthy();
		// Reason Code (Backend-Fakt)
		expect(screen.getByText('GLOBAL_RUN_LIMIT')).toBeTruthy();
		// Kapazität
		expect(screen.getByText('1 / 2 active runs')).toBeTruthy();
	});

	it('leere Queue: Hinweis ohne Absturz', async () => {
		vi.spyOn(api, 'getSchedulerQueue').mockResolvedValue({
			queue: [],
			capacity: { maxActiveRuns: 2, activeRuns: 0, queueDepth: 0, waitingDependency: 0, waitingResource: 0 },
		});
		vi.spyOn(api, 'getSchedulerCapacity').mockResolvedValue({
			maxActiveRuns: 2,
			activeRuns: 0,
			queueDepth: 0,
			waitingDependency: 0,
			waitingResource: 0,
		});
		render(<SchedulerQueuePanel />);
		await waitFor(() =>
			expect(screen.getByText(/Keine Runs in der Intake-Queue/)).toBeTruthy(),
		);
	});

	it('Backend-Fehler: Fehlerzustand statt Absturz', async () => {
		vi.spyOn(api, 'getSchedulerQueue').mockRejectedValue(new Error('backend down'));
		vi.spyOn(api, 'getSchedulerCapacity').mockRejectedValue(new Error('backend down'));
		render(<SchedulerQueuePanel />);
		await waitFor(() => expect(screen.getByText(/nicht verfügbar/)).toBeTruthy());
	});
});
