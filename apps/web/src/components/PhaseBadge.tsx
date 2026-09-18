import type React from 'react';
import type { Phase } from '../types.js';
import { PHASE_LABELS } from '../types.js';
import { t } from '../i18n/index.js';

interface PhaseBadgeProps {
	phase: Phase;
	size?: 'xs' | 'sm' | 'md';
}

const phaseColors: Record<Phase, string> = {
	QUEUED: 'bg-slate-600 text-slate-200',
	CLAIMED: 'bg-blue-600 text-white',
	REPO_SYNC: 'bg-indigo-600 text-white',
	ISSUE_CONTEXT: 'bg-indigo-500 text-white',
	WEB_RESEARCH: 'bg-violet-500 text-white',
	SPECIFY: 'bg-violet-600 text-white',
	CLARIFY_OPTIONAL: 'bg-violet-400 text-white',
	PLAN: 'bg-purple-600 text-white',
	TASKS: 'bg-purple-500 text-white',
	ANALYZE: 'bg-purple-400 text-white',
	REVIEW: 'bg-orange-600 text-white',
	IMPLEMENT: 'bg-cyan-600 text-white',
	TEST: 'bg-amber-600 text-white',
	VERIFY: 'bg-amber-500 text-white',
	COMMIT: 'bg-teal-500 text-white',
	PR_CREATE: 'bg-teal-600 text-white',
	MERGE: 'bg-teal-600 text-white',
	DONE: 'bg-green-600 text-white',
	FAILED: 'bg-red-600 text-white',
	FAILED_TRANSIENT: 'bg-red-500 text-white',
	FAILED_BLOCKED: 'bg-red-700 text-white',
	FAILED_UNSAFE: 'bg-red-800 text-white',
	BLOCKED_PUSH: 'bg-yellow-600 text-white',
	BLOCKED_MERGE: 'bg-yellow-600 text-white',
	GATE_APPROVE: 'bg-lime-600 text-white',
	GATE_REVISE: 'bg-orange-600 text-white',
	RESUME_PENDING: 'bg-sky-600 text-white',
	CLEANUP: 'bg-slate-500 text-slate-200',
};

const phaseIcons: Partial<Record<Phase, string>> = {
	IMPLEMENT: '⟳',
	TEST: '⚗',
	DONE: '✓',
	FAILED: '✗',
	FAILED_TRANSIENT: '⟳',
	FAILED_BLOCKED: '✗',
	FAILED_UNSAFE: '☠',
	BLOCKED_PUSH: '⚠',
	BLOCKED_MERGE: '⚠',
	GATE_APPROVE: '⚡',
	GATE_REVISE: '↺',
	RESUME_PENDING: '⏸',
	CLEANUP: '🧹',
};

const sizeClasses: Record<string, string> = {
	xs: 'px-1.5 py-0.5 text-[10px]',
	sm: 'px-2 py-0.5 text-xs',
	md: 'px-2.5 py-1 text-sm',
};

export default function PhaseBadge({ phase, size = 'sm' }: PhaseBadgeProps): React.ReactElement {
	const colorClass = phaseColors[phase] ?? 'bg-slate-600 text-slate-200';
	const icon = phaseIcons[phase];
	const label = PHASE_LABELS[phase] ?? phase;
	const sizeClass = sizeClasses[size] ?? sizeClasses.sm;

	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full font-medium ${colorClass} ${sizeClass}`}
		>
			{icon && <span>{icon}</span>}
			{t(label)}
		</span>
	);
}
