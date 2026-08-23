// Positron P5.4 — Evolution Panel (Mission Control, backend truth only)
import { useEffect, useState } from 'react';

interface Candidate {
	candidate_id: string;
	parent_profile_id: string;
	candidate_version: string;
	candidate_fingerprint: string;
	status: string;
	created_at: string;
}

interface EvolutionKpis {
	candidate_count: number;
	candidate_rejection_rate: number | null;
	candidate_promotion_rate: number | null;
	insufficient_evidence_rate: number | null;
	compute_advantage_not_harness_rate: number | null;
	shadow_failure_rate: number | null;
	canary_failure_rate: number | null;
	rollback_rate: number | null;
}

export default function EvolutionPanel(): React.ReactElement {
	const [candidates, setCandidates] = useState<Candidate[]>([]);
	const [kpis, setKpis] = useState<EvolutionKpis | null>(null);
	const [current, setCurrent] = useState<Record<string, unknown> | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function fetchData(): Promise<void> {
			try {
				const [candRes, kpiRes, currRes] = await Promise.all([
					fetch('/api/evolution/candidates').then((r) => r.json()),
					fetch('/api/evolution/kpis').then((r) => r.json()),
					fetch('/api/evolution/current').then((r) => r.json()),
				]);
				setCandidates(candRes.candidates ?? []);
				setKpis(kpiRes);
				setCurrent(currRes.pointer ?? null);
			} catch {
				// ignore
			} finally {
				setLoading(false);
			}
		}
		void fetchData();
	}, []);

	if (loading) return <div>Loading evolution...</div>;

	return (
		<div className="evolution-panel p-4">
			<h2 className="text-xl font-bold mb-4">Harness Evolution (P5.4)</h2>

			<div className="mb-6">
				<h3 className="font-semibold">Current Production Profile</h3>
				{current ? (
					<div className="text-sm font-mono bg-gray-100 p-2 rounded">
						<div>ID: {String(current.profile_id)}</div>
						<div>Version: {String(current.profile_version)}</div>
						<div>Fingerprint: {String(current.profile_fingerprint).slice(0, 16)}...</div>
					</div>
				) : (
					<div className="text-sm text-gray-500">No current pointer</div>
				)}
			</div>

			<div className="mb-6">
				<h3 className="font-semibold">KPIs</h3>
				{kpis ? (
					<div className="grid grid-cols-2 gap-2 text-sm">
						<div>Candidates: {kpis.candidate_count}</div>
						<div>Rejection Rate: {kpis.candidate_rejection_rate ?? 'N/A'}</div>
						<div>Promotion Rate: {kpis.candidate_promotion_rate ?? 'N/A'}</div>
						<div>Insufficient Evidence: {kpis.insufficient_evidence_rate ?? 'N/A'}</div>
						<div>Compute Advantage: {kpis.compute_advantage_not_harness_rate ?? 'N/A'}</div>
						<div>Rollback Rate: {kpis.rollback_rate ?? 'N/A'}</div>
					</div>
				) : (
					<div className="text-sm text-gray-500">No KPIs</div>
				)}
			</div>

			<div>
				<h3 className="font-semibold">Candidates</h3>
				<div className="space-y-2">
					{candidates.map((c) => (
						<div key={c.candidate_id} className="border p-2 rounded text-sm">
							<div className="font-mono">{c.candidate_id}</div>
							<div>
								Status: <span className="font-semibold">{c.status}</span>
							</div>
							<div>Fingerprint: {c.candidate_fingerprint.slice(0, 16)}...</div>
							<div>Version: {c.candidate_version}</div>
						</div>
					))}
					{candidates.length === 0 && <div className="text-sm text-gray-500">No candidates</div>}
				</div>
			</div>

			<div className="mt-6 text-xs text-gray-500">
				Backend truth only. No raw prompts/secrets. Statuses: PROPOSED, VALIDATING, REJECTED,
				SHADOW, CANARY, PROMOTED, ROLLED_BACK
			</div>
		</div>
	);
}
