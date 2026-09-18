import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import type { Run } from '../types.js';
import { t } from '../i18n/index.js';

const POLL_INTERVAL_MS = 3000;
const TERMINAL_PHASES = new Set(['DONE', 'FAILED', 'FAILED_BLOCKED', 'FAILED_UNSAFE', 'CLEANUP']);

interface UseRunResult {
	run: Run | null;
	isLoading: boolean;
	error: string | null;
	refetch: () => void;
}

export function useRun(runId: string): UseRunResult {
	const [run, setRun] = useState<Run | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchRun = useCallback(async () => {
		try {
			const { run: runData } = await api.getRunById(runId);
			setRun(runData);
			setError(null);

			// Stop polling if terminal phase reached
			if (runData.status !== 'active' || TERMINAL_PHASES.has(runData.phase)) {
				if (intervalRef.current) {
					clearInterval(intervalRef.current);
					intervalRef.current = null;
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t('Failed to fetch run'));
		} finally {
			setIsLoading(false);
		}
	}, [runId]);

	const refetch = useCallback(() => {
		setIsLoading(true);
		fetchRun();
	}, [fetchRun]);

	useEffect(() => {
		// Initial fetch
		setIsLoading(true);
		fetchRun();

		// Polling while running
		intervalRef.current = setInterval(fetchRun, POLL_INTERVAL_MS);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [fetchRun]);

	return { run, isLoading, error, refetch };
}
