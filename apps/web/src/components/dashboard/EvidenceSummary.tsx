import type React from 'react';
import { t } from '../../i18n/index.js';

interface EvidenceSummaryProps {
	isLoading: boolean;
	testPassed: number;
	testFailed: number;
	testSkipped: number;
	artifactCount: number;
	screenshotCount: number;
}

export default function EvidenceSummary({
	isLoading,
	testPassed,
	testFailed,
	testSkipped,
	artifactCount,
	screenshotCount,
}: EvidenceSummaryProps): React.ReactElement {
	if (isLoading) {
		return (
			<div className="card animate-pulse">
				<div className="skeleton h-5 w-32 mb-3 rounded" />
				<div className="skeleton h-3 w-full mb-2 rounded" />
				<div className="skeleton h-3 w-3/4 rounded" />
			</div>
		);
	}

	return (
		<div className="card">
			<h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
				Evidence Summary
			</h3>
			<div className="space-y-2 text-xs">
				<div className="flex items-center justify-between">
					<span className="text-slate-500 dark:text-slate-400">{t('Artifacts')}</span>
					<span className="font-medium text-slate-700 dark:text-slate-300">{artifactCount}</span>
				</div>
				{screenshotCount > 0 && (
					<div className="flex items-center justify-between">
						<span className="text-slate-500 dark:text-slate-400">{t('Screenshots')}</span>
						<span className="font-medium text-slate-700 dark:text-slate-300">
							{screenshotCount}
						</span>
					</div>
				)}
				<div className="flex items-center justify-between">
						<span className="text-slate-500 dark:text-slate-400">{t('Tests Passed')}</span>
					<span className="font-medium text-green-600 dark:text-green-400">{testPassed}</span>
				</div>
				<div className="flex items-center justify-between">
						<span className="text-slate-500 dark:text-slate-400">{t('Tests Failed')}</span>
					<span className="font-medium text-red-600 dark:text-red-400">{testFailed}</span>
				</div>
				<div className="flex items-center justify-between">
						<span className="text-slate-500 dark:text-slate-400">{t('Tests Skipped')}</span>
					<span className="font-medium text-amber-600 dark:text-amber-400">{testSkipped}</span>
				</div>
			</div>
		</div>
	);
}
