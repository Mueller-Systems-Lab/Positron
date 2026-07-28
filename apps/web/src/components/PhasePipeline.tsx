import { ALL_PHASES } from '@positron/shared';
import React from 'react';
import type { Phase } from '../types.js';

interface PhasePipelineProps {
	currentPhase?: Phase;
	completedPhases?: Phase[];
	failedPhases?: Phase[];
	blockedPhases?: Phase[];
	humanPhases?: Phase[];
	onPhaseClick?: (phase: Phase) => void;
}

type PhaseStatus = 'pending' | 'current' | 'completed' | 'failed' | 'blocked' | 'human';

const phaseStatusColors: Record<
	PhaseStatus,
	{ bg: string; border: string; text: string; icon: string }
> = {
	pending: { bg: 'bg-slate-800', border: 'border-slate-700', text: 'text-slate-600', icon: '○' },
	current: { bg: 'bg-sky-500/10', border: 'border-sky-400', text: 'text-sky-400', icon: '◉' },
	completed: {
		bg: 'bg-green-500/10',
		border: 'border-green-700',
		text: 'text-green-400',
		icon: '✓',
	},
	failed: { bg: 'bg-red-500/10', border: 'border-red-800', text: 'text-red-400', icon: '✗' },
	blocked: { bg: 'bg-amber-500/10', border: 'border-amber-800', text: 'text-amber-400', icon: '⚠' },
	human: {
		bg: 'bg-purple-500/10',
		border: 'border-purple-800',
		text: 'text-purple-400',
		icon: '👤',
	},
};

/** Kürzel für Phasen-Namen (28 Phasen) */
const PHASE_SHORT: Record<Phase, string> = {
	QUEUED: 'Q',
	CLAIMED: 'C',
	REPO_SYNC: 'RS',
	ISSUE_CONTEXT: 'IC',
	WEB_RESEARCH: 'WR',
	SPECIFY: 'SP',
	CLARIFY_OPTIONAL: 'CO',
	PLAN: 'PL',
	TASKS: 'TK',
	ANALYZE: 'AN',
	REVIEW: 'RV',
	IMPLEMENT: 'IM',
	TEST: 'TE',
	VERIFY: 'VE',
	COMMIT: 'CM',
	PR_CREATE: 'PR',
	MERGE: 'MG',
	DONE: 'OK',
	FAILED: 'FL',
	FAILED_TRANSIENT: 'FT',
	FAILED_BLOCKED: 'FB',
	FAILED_UNSAFE: 'FU',
	BLOCKED_PUSH: 'BP',
	BLOCKED_MERGE: 'BM',
	GATE_APPROVE: 'GA',
	GATE_REVISE: 'GR',
	RESUME_PENDING: 'RP',
	CLEANUP: 'CL',
};

function PhaseNode({
	phase,
	status,
	onClick,
}: { phase: Phase; status: PhaseStatus; onClick?: (p: Phase) => void }) {
	const colors = phaseStatusColors[status];
	const short = PHASE_SHORT[phase] ?? phase.slice(0, 2);

	return (
		<button
			type="button"
			onClick={() => onClick?.(phase)}
			title={phase}
			className={`
        flex flex-col items-center justify-center w-16 h-14 rounded-lg border
        ${colors.bg} ${colors.border} ${colors.text}
        transition-all duration-200 ease-out cursor-pointer
        hover:scale-105 hover:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-400
        ${status === 'current' ? 'ring-1 ring-sky-400/50' : ''}
      `}
			aria-label={`Phase ${phase}: ${status}`}
			aria-current={status === 'current' ? 'step' : undefined}
		>
			<span className="text-xs font-mono font-bold leading-none">{short}</span>
			<span className="text-[10px] font-medium mt-0.5 leading-none opacity-70">{status}</span>
		</button>
	);
}

export default function PhasePipeline({
	currentPhase,
	completedPhases = [],
	failedPhases = [],
	blockedPhases = [],
	humanPhases = [],
	onPhaseClick,
}: PhasePipelineProps): React.ReactElement {
	const terminalPhases: Phase[] = ['DONE', 'FAILED', 'FAILED_BLOCKED', 'FAILED_UNSAFE', 'CLEANUP'];

	function getStatus(phase: Phase): PhaseStatus {
		if (phase === currentPhase) return 'current';
		if (failedPhases.includes(phase)) return 'failed';
		if (blockedPhases.includes(phase)) return 'blocked';
		if (humanPhases.includes(phase)) return 'human';
		if (completedPhases.includes(phase)) return 'completed';
		if (terminalPhases.includes(phase)) return 'pending';
		return 'pending';
	}

	const isCurrentPhaseIndex = currentPhase ? ALL_PHASES.indexOf(currentPhase) : -1;
	const hasRunStarted = currentPhase !== undefined || completedPhases.length > 0;

	// Zeige alle Phasen + Terminal-Phasen (semantisch, nicht hartcodiert)
	const terminalMainIndex = ALL_PHASES.indexOf('DONE');
	const mainPhases =
		terminalMainIndex >= 0 ? ALL_PHASES.slice(0, terminalMainIndex + 1) : ALL_PHASES;
	const errorPhases = terminalMainIndex >= 0 ? ALL_PHASES.slice(terminalMainIndex + 1) : [];
	const hasErrorActivity =
		failedPhases.length > 0 || blockedPhases.length > 0 || humanPhases.length > 0;

	return (
		<div className="card panel-stagger">
			<h3 className="text-sm font-medium text-slate-300 mb-4 font-['Space_Grotesk']">
				28-Phase Pipeline
				<span className="text-xs text-slate-500 font-['IBM_Plex_Sans'] ml-2">
					{currentPhase ? `Current: ${currentPhase}` : hasRunStarted ? 'Completed' : 'Not started'}
				</span>
			</h3>

			{/* Main Pipeline */}
			<div className="overflow-x-auto pb-2 -mx-2 px-2">
				<ol className="flex items-start gap-1 min-w-max" role="list" aria-label="Pipeline phases">
					{mainPhases.map((phase, i) => (
						<React.Fragment key={phase}>
							<li role="listitem" aria-label={`Phase ${phase}: ${getStatus(phase)}`}>
								<PhaseNode phase={phase} status={getStatus(phase)} onClick={onPhaseClick} />
							</li>
							{/* Connector zwischen Phasen */}
							{i < mainPhases.length - 1 && (
								<div
									className={`w-2 h-px mt-7 shrink-0 ${completedPhases.includes(phase) ? 'bg-green-400' : 'bg-slate-700'}`}
								/>
							)}
						</React.Fragment>
					))}
				</ol>
			</div>

			{/* Error/Blockade/Recovery Phasen */}
			{hasErrorActivity && (
				<div className="mt-4 pt-4 border-t border-slate-800">
					<h4 className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2 font-['IBM_Plex_Sans']">
						State / Recovery Phases
					</h4>
					<div className="flex items-start gap-1 flex-wrap">
						{errorPhases.map((phase) => {
							const status = getStatus(phase);
							if (status === 'pending') return null;
							return <PhaseNode key={phase} phase={phase} status={status} onClick={onPhaseClick} />;
						})}
					</div>
				</div>
			)}

			{/* Phase Status Legend */}
			<div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-slate-500 font-['IBM_Plex_Sans']">
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-slate-600" /> Pending
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-sky-400" /> Current
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-green-400" /> Completed
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-red-400" /> Failed
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-amber-400" /> Blocked
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-purple-400" /> Human
				</span>
			</div>
		</div>
	);
}
