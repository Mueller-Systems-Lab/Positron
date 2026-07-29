import type React from 'react';

interface SkeletonSlot {
	key: string;
	position: number;
}

export function createSkeletonSlots(prefix: string, rows: number): SkeletonSlot[] {
	return Array.from({ length: rows }, (_, position) => ({
		key: `${prefix}-${position + 1}`,
		position,
	}));
}

interface LoadingSkeletonProps {
	variant?: 'table' | 'card' | 'text';
	rows?: number;
}

export default function LoadingSkeleton({
	variant = 'text',
	rows = 3,
}: LoadingSkeletonProps): React.ReactElement {
	if (variant === 'table') {
		return (
			<div className="space-y-2">
				{createSkeletonSlots('loading-skeleton-table-row', rows).map((slot) => (
					<div key={slot.key} className="flex gap-4 animate-pulse">
						<div className="skeleton h-4 w-24 rounded" />
						<div className="skeleton h-4 w-16 rounded" />
						<div className="skeleton h-4 flex-1 rounded" />
						<div className="skeleton h-4 w-20 rounded" />
						<div className="skeleton h-4 w-32 rounded" />
					</div>
				))}
			</div>
		);
	}

	if (variant === 'card') {
		return (
			<div className="card animate-pulse space-y-3 p-4">
				<div className="skeleton h-5 w-1/3 rounded" />
				<div className="skeleton h-3 w-2/3 rounded" />
				<div className="flex gap-4 mt-4">
					<div className="skeleton h-12 w-12 rounded-full" />
					<div className="space-y-2 flex-1">
						<div className="skeleton h-3 w-full rounded" />
						<div className="skeleton h-3 w-3/4 rounded" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2 animate-pulse">
			{createSkeletonSlots('loading-skeleton-text-row', rows).map((slot) => (
				<div
					key={slot.key}
					className="skeleton h-3 rounded"
					style={{ width: `${Math.max(40, 100 - slot.position * 12)}%` }}
				/>
			))}
		</div>
	);
}
