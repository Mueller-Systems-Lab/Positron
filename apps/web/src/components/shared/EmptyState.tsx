import type React from 'react';

interface EmptyStateProps {
	icon?: string;
	title: string;
	description: string;
	action?: { label: string; onClick: () => void };
	secondaryAction?: { label: string; onClick: () => void };
}

export default function EmptyState({
	icon = '📭',
	title,
	description,
	action,
	secondaryAction,
}: EmptyStateProps): React.ReactElement {
	return (
		<div className="card text-center py-12 px-6">
			<div className="text-5xl mb-4">{icon}</div>
			<h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">{title}</h3>
			<p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
				{description}
			</p>
			<div className="flex items-center justify-center gap-3">
				{action && (
					<button type="button" onClick={action.onClick} className="btn-primary">
						{action.label}
					</button>
				)}
				{secondaryAction && (
					<button type="button" onClick={secondaryAction.onClick} className="btn-secondary">
						{secondaryAction.label}
					</button>
				)}
			</div>
		</div>
	);
}
