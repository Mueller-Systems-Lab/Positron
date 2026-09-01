import type { ReactElement, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface SidebarProps {
	open: boolean;
	onClose: () => void;
}

interface NavItem {
	to: string;
	label: string;
	icon: ReactNode;
	end?: boolean;
}

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
	{
		label: 'Overview',
		items: [
			{ to: '/readiness', label: 'Readiness', icon: <span aria-hidden="true">✓</span> },
			{
				to: '/',
				label: 'Dashboard',
				end: true,
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<rect x="3" y="3" width="7" height="7" rx="1" />
						<rect x="14" y="3" width="7" height="7" rx="1" />
						<rect x="3" y="14" width="7" height="7" rx="1" />
						<rect x="14" y="14" width="7" height="7" rx="1" />
					</svg>
				),
			},
			{
				to: '/runs',
				label: 'Runs',
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<polyline points="9 18 15 12 9 6" />
					</svg>
				),
			},
			{
				to: '/evidence',
				label: 'Evidence',
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
						<polyline points="14 2 14 8 20 8" />
						<line x1="16" y1="13" x2="8" y2="13" />
						<line x1="16" y1="17" x2="8" y2="17" />
						<polyline points="10 9 9 9 8 9" />
					</svg>
				),
			},
			{
				to: '/evolution',
				label: 'Evolution',
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<path d="M16 8L8 16" />
						<path d="M8 8h8v8" />
						<path d="M12 3v2" />
						<path d="M12 19v2" />
						<path d="M3 12h2" />
						<path d="M19 12h2" />
					</svg>
				),
			},
		],
	},
	{
		label: 'Workspace',
		items: [
			{
				to: '/repos',
				label: 'Repositories',
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
				),
			},
			{
				to: '/projects',
				label: 'Projects',
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
						<line x1="8" y1="21" x2="16" y2="21" />
						<line x1="12" y1="17" x2="12" y2="21" />
					</svg>
				),
			},
		],
	},
	{
		label: 'Safety',
		items: [
			{
				to: '/settings',
				label: 'Settings',
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
				),
			},
			{
				to: '/admin',
				label: 'Admin',
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
				),
			},
		],
	},
];

export default function Sidebar({ open, onClose }: SidebarProps): ReactElement {
	const linkClass = ({ isActive }: { isActive: boolean }): string =>
		`group flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
			isActive
				? 'border-cyan-400/30 bg-slate-950 text-white shadow-lg shadow-sky-500/10 dark:bg-white/10 dark:text-slate-50'
				: 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-900/80 dark:hover:text-slate-100'
		}`;

	const sidebarContent = (
		<nav
			aria-label="Main navigation"
			className="flex h-full w-[19rem] shrink-0 flex-col border-r border-slate-200/80 bg-white/85 p-4 text-slate-900 shadow-2xl shadow-slate-950/5 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/80 dark:text-slate-100"
		>
			{/* Mobile close button */}
			<div className="lg:hidden flex items-center justify-end px-3 pt-3 pb-1">
				<button
					type="button"
					onClick={onClose}
					className="btn-ghost p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
					aria-label="Close sidebar"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
						focusable="false"
					>
						<path
							fillRule="evenodd"
							d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
							clipRule="evenodd"
						/>
					</svg>
				</button>
			</div>

			<div className="border-b border-slate-200/80 px-2 pb-4 dark:border-slate-800/70">
				<div className="flex items-center gap-3">
					<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-400 to-blue-500 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20">
						P
					</div>
					<div>
						<div className="font-heading text-lg font-semibold tracking-tight">Positron</div>
						<div className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
							Evidence-gated cockpit
						</div>
					</div>
				</div>

				<div className="mt-4 flex flex-wrap gap-2">
					<span className="badge border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
						Local-only
					</span>
					<span className="badge border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
						Controlled
					</span>
				</div>
			</div>

			{/* Nav Items */}
			<div className="flex-1 space-y-5 overflow-y-auto py-4 px-1">
				{NAV_SECTIONS.map((section) => (
					<div key={section.label} className="space-y-2">
						<p className="px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
							{section.label}
						</p>
						<div className="space-y-1">
							{section.items.map((item) => (
								<NavLink
									key={item.to}
									to={item.to}
									end={item.end}
									className={linkClass}
									onClick={onClose}
								>
									<span className="shrink-0 opacity-80 transition-transform duration-150 group-hover:scale-105">
										{item.icon}
									</span>
									<span>{item.label}</span>
								</NavLink>
							))}
						</div>
					</div>
				))}
			</div>

			{/* Status Footer */}
			<div className="border-t border-slate-200/80 px-2 pt-4 dark:border-slate-800/70">
				<div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-3 text-xs text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-300">
					<div className="flex items-center gap-2 font-medium">
						<span className="h-2 w-2 rounded-full bg-emerald-500" />
						<span>System connected</span>
					</div>
					<p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
						Safety gates, evidence trails, and local execution are active by default.
					</p>
				</div>
			</div>
		</nav>
	);

	return (
		<>
			{/* Mobile overlay + backdrop */}
			{open && (
				<div className="fixed inset-0 z-40 lg:hidden">
					{/* Backdrop */}
					<button
						type="button"
						onClick={onClose}
						aria-label="Close sidebar"
						className="absolute inset-0 z-0 bg-black/40"
					/>
					{/* Sidebar panel */}
					<div className="absolute bottom-0 left-0 top-0 z-10">{sidebarContent}</div>
				</div>
			)}

			{/* Desktop sidebar (always visible) */}
			<div className="hidden lg:flex lg:pr-2">{sidebarContent}</div>
		</>
	);
}
