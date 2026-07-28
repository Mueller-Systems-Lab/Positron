import type React from 'react';

interface ErrorBannerProps {
	message: string;
	onRetry?: () => void;
	onDismiss?: () => void;
}

export default function ErrorBanner({
	message,
	onRetry,
	onDismiss,
}: ErrorBannerProps): React.ReactElement {
	return (
		<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
			<div className="flex items-start gap-3">
				<span className="text-red-400 text-lg mt-0.5">⚠️</span>
				<div className="flex-1">
					<p className="text-sm font-medium text-red-700 dark:text-red-400">Error</p>
					<p className="text-xs text-red-600 dark:text-red-300 mt-1">{message}</p>
				</div>
				<div className="flex items-center gap-2">
					{onRetry && (
						<button
							type="button"
							onClick={onRetry}
							className="text-xs px-3 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-700 dark:text-red-300 transition-colors"
						>
							Retry
						</button>
					)}
					{onDismiss && (
						<button
							type="button"
							onClick={onDismiss}
							className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
						>
							✕
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
