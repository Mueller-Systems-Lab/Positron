import type React from 'react';
import type { Phase } from '../types.js';
import { ALL_PHASES, PHASE_LABELS } from '../types.js';
import { t } from '../i18n/index.js';

interface PhaseTimelineProps {
	currentPhase: Phase;
	completedPhases?: Phase[];
}

function getPhaseIndex(phase: Phase): number {
	return ALL_PHASES.indexOf(phase);
}

export default function PhaseTimeline({
	currentPhase,
	completedPhases,
}: PhaseTimelineProps): React.ReactElement {
	const currentIdx = getPhaseIndex(currentPhase);
	const completed = new Set(completedPhases ?? ALL_PHASES.slice(0, currentIdx));

	return (
		<div className="card">
			<h3 className="text-sm font-medium text-slate-300 mb-3">{t('Phasen-Timeline')}</h3>
			<div className="space-y-1">
				{ALL_PHASES.map((phase, idx) => {
					const isCompleted = completed.has(phase) || idx < currentIdx;
					const isCurrent = phase === currentPhase;
					const isFuture = idx > currentIdx;

					let icon: string;
					let iconColor: string;
					let textColor: string;

					if (isCurrent) {
						icon = '⟳';
						iconColor = 'text-blue-400';
						textColor = 'text-blue-300';
					} else if (isCompleted) {
						icon = '✓';
						iconColor = 'text-green-500';
						textColor = 'text-slate-300';
					} else {
						icon = '○';
						iconColor = 'text-slate-600';
						textColor = 'text-slate-600';
					}

					return (
						<div
							key={phase}
							className={`flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors ${
								isCurrent ? 'bg-blue-900/20' : ''
							}`}
						>
							<span
								className={`w-5 text-center text-sm ${iconColor} ${
									isCurrent ? 'animate-spin-slow' : ''
								}`}
							>
								{icon}
							</span>
							<span className={`text-xs ${textColor}`}>{PHASE_LABELS[phase] ?? phase}</span>
							{isCurrent && (
								<span className="ml-auto text-[10px] text-blue-400 font-medium">{t('aktuell')}</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
