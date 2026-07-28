import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { LogLevel, RunEvent } from '../types.js';

interface LogViewerProps {
	events: RunEvent[];
	maxHeight?: string;
}

const MAX_VISIBLE_EVENTS = 500;

const levelColors: Record<LogLevel, string> = {
	INFO: 'text-slate-300',
	WARN: 'text-yellow-400',
	ERROR: 'text-red-400',
	DEBUG: 'text-slate-500',
};

const levelBadgeColors: Record<LogLevel, string> = {
	INFO: 'bg-slate-600 text-slate-200',
	WARN: 'bg-yellow-600 text-white',
	ERROR: 'bg-red-600 text-white',
	DEBUG: 'bg-slate-700 text-slate-400',
};

function formatTime(dateStr: string): string {
	const d = new Date(dateStr);
	return d.toLocaleTimeString('de-DE', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3,
	});
}

export default function LogViewer({
	events,
	maxHeight = '600px',
}: LogViewerProps): React.ReactElement {
	const [autoScroll, setAutoScroll] = useState(true);
	const [filter, setFilter] = useState<LogLevel | 'ALL'>('ALL');
	const [searchTerm, setSearchTerm] = useState('');
	const scrollRef = useRef<HTMLDivElement>(null);
	const isUserScrollingRef = useRef(false);

	const filteredEvents = events
		.filter((e) => filter === 'ALL' || e.level === filter)
		.filter((e) => !searchTerm || e.message.toLowerCase().includes(searchTerm.toLowerCase()))
		.slice(-MAX_VISIBLE_EVENTS);

	// Auto-scroll logic
	useEffect(() => {
		if (autoScroll && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [filteredEvents.length, autoScroll]);

	function handleScroll(): void {
		if (!scrollRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
		setAutoScroll(isAtBottom);
	}

	return (
		<div className="card p-0 overflow-hidden">
			{/* Filters */}
			<div className="flex items-center gap-2 p-3 border-b border-slate-700 flex-wrap">
				<div className="flex gap-1">
					{(['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'] as const).map((l) => (
						<button
							type="button"
							key={l}
							onClick={() => setFilter(l)}
							className={`px-2 py-1 text-xs rounded-md transition-colors ${
								filter === l
									? 'bg-blue-600 text-white'
									: 'bg-slate-700 text-slate-400 hover:bg-slate-600'
							}`}
						>
							{l}
						</button>
					))}
				</div>
				<input
					type="text"
					placeholder="🔍 Suchen..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
					className="input flex-1 min-w-[120px] text-xs py-1"
				/>
				<label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
					<input
						type="checkbox"
						checked={autoScroll}
						onChange={(e) => setAutoScroll(e.target.checked)}
						className="rounded bg-slate-600 border-slate-500"
					/>
					Auto-scroll
				</label>
			</div>

			{/* Log List */}
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="overflow-y-auto font-mono text-xs"
				style={{ maxHeight }}
			>
				{filteredEvents.length === 0 ? (
					<div className="flex items-center justify-center py-12 text-slate-500">
						{events.length === 0 ? (
							<div className="text-center">
								<div className="animate-spin-slow inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mb-2" />
								<p>Warte auf Events...</p>
							</div>
						) : (
							<p>Keine Events gefunden (Filter: {filter})</p>
						)}
					</div>
				) : (
					<div className="divide-y divide-slate-800">
						{filteredEvents.map((event) => (
							<div
								key={event.id}
								className="flex items-start gap-2 px-3 py-1.5 hover:bg-slate-800/50"
							>
								<span className="text-slate-500 shrink-0 w-[90px]">
									{formatTime(event.createdAt)}
								</span>
								<span
									className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
										levelBadgeColors[event.level]
									}`}
								>
									{event.level}
								</span>
								<span className="text-slate-500 shrink-0 w-[80px]">{event.phase}</span>
								<span className={`break-words ${levelColors[event.level] ?? 'text-slate-300'}`}>
									{event.message}
								</span>
							</div>
						))}
					</div>
				)}
			</div>

			{/* New events indicator */}
			{!autoScroll && events.length > 0 && (
				<button
					type="button"
					onClick={() => {
						setAutoScroll(true);
						if (scrollRef.current) {
							scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
						}
					}}
					className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-blue-600 text-white text-xs rounded-full shadow-lg hover:bg-blue-700 transition-colors"
				>
					↓ Neu ({events.length})
				</button>
			)}
		</div>
	);
}
