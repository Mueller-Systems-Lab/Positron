import type React from 'react';
import { useState } from 'react';
import { api } from '../api.js';
import type { Phase } from '../types.js';

interface GateControlsProps {
	runId: string;
	currentPhase: Phase;
}

const GATE_PHASES = new Set<Phase>(['GATE_APPROVE', 'GATE_REVISE']);

export default function GateControls({
	runId,
	currentPhase,
}: GateControlsProps): React.ReactElement {
	const [showApproveConfirm, setShowApproveConfirm] = useState(false);
	const [showReviseForm, setShowReviseForm] = useState(false);
	const [reviseReason, setReviseReason] = useState('');
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!GATE_PHASES.has(currentPhase)) {
		return (
			<div className="card text-center text-slate-500 text-sm py-6">
				Keine Genehmigung erforderlich
			</div>
		);
	}

	async function handleApprove(): Promise<void> {
		setLoading(true);
		setError(null);
		try {
			await api.approveGate(runId);
			setSuccess(true);
			setShowApproveConfirm(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Fehler bei Genehmigung');
		} finally {
			setLoading(false);
		}
	}

	async function handleRevise(): Promise<void> {
		if (reviseReason.trim().length < 20) {
			setError('Bitte mindestens 20 Zeichen eingeben');
			return;
		}
		setLoading(true);
		setError(null);
		try {
			await api.reviseGate(runId, reviseReason);
			setSuccess(true);
			setShowReviseForm(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Fehler bei Überarbeitung');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="card">
			<h3 className="text-sm font-medium text-amber-400 mb-2">⚡ Gate-Entscheidung erforderlich</h3>
			<p className="text-xs text-slate-400 mb-4">
				Der Run wartet auf deine Entscheidung, bevor er fortgesetzt wird.
			</p>

			{error && (
				<div className="mb-3 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-200">
					{error}
				</div>
			)}

			{success ? (
				<div className="p-3 bg-green-900/50 border border-green-700 rounded-lg text-center">
					<p className="text-green-300 text-sm font-medium">✓ Entscheidung gespeichert</p>
				</div>
			) : (
				<div className="space-y-3">
					{/* Approve Button */}
					{!showApproveConfirm && !showReviseForm && (
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setShowApproveConfirm(true)}
								className="btn-success flex-1 text-sm"
							>
								✓ Genehmigen
							</button>
							<button
								type="button"
								onClick={() => setShowReviseForm(true)}
								className="btn-secondary flex-1 text-sm"
							>
								↺ Überarbeitung
							</button>
						</div>
					)}

					{/* Approve Confirmation */}
					{showApproveConfirm && (
						<div className="p-3 bg-slate-700 rounded-lg space-y-3">
							<p className="text-xs text-slate-300">
								Bist du sicher? Der Run wird mit Merge-Rechten fortgesetzt.
							</p>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setShowApproveConfirm(false)}
									className="btn-secondary flex-1 text-xs"
									disabled={loading}
								>
									Abbrechen
								</button>
								<button
									type="button"
									onClick={handleApprove}
									className="btn-success flex-1 text-xs"
									disabled={loading}
								>
									{loading ? 'Wird gesendet...' : 'Ja, genehmigen'}
								</button>
							</div>
						</div>
					)}

					{/* Revise Form */}
					{showReviseForm && (
						<div className="space-y-3">
							<textarea
								placeholder="Beschreibe, was überarbeitet werden soll (mind. 20 Zeichen)..."
								value={reviseReason}
								onChange={(e) => setReviseReason(e.target.value)}
								minLength={20}
								rows={3}
								className="input text-sm resize-none"
							/>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => {
										setShowReviseForm(false);
										setReviseReason('');
									}}
									className="btn-secondary flex-1 text-xs"
									disabled={loading}
								>
									Abbrechen
								</button>
								<button
									type="button"
									onClick={handleRevise}
									className="btn-danger flex-1 text-xs"
									disabled={loading || reviseReason.trim().length < 20}
								>
									{loading ? 'Wird gesendet...' : 'Überarbeitung anfordern'}
								</button>
							</div>
							<p className="text-[10px] text-slate-500">{reviseReason.trim().length}/20 Zeichen</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
