import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { t } from '../../i18n/index.js';
import HealthIndicator from '../HealthIndicator.js';
import ThemeToggle from '../ThemeToggle.js';

interface TopBarProps {
	onToggleSidebar?: () => void;
}

export default function TopBar({ onToggleSidebar }: TopBarProps): ReactElement {
	return (
		<header className="sticky top-0 z-30 h-16 shrink-0 border-b border-slate-200/80 bg-white/75 px-4 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/70">
			{/* Left: Toggle + Logo */}
			<div className="flex h-full items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					{onToggleSidebar && (
						<button
							type="button"
							onClick={onToggleSidebar}
							className="btn-ghost p-1.5 lg:hidden"
							aria-label={t('Toggle sidebar')}
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
									d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
					)}
					<NavLink
						to="/"
						aria-label={t('Positron home')}
						className="flex items-center gap-2 no-underline sm:gap-3"
					>
						<span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-400 to-blue-500 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20 sm:h-9 sm:w-9">
							P
						</span>
						<span className="flex flex-col leading-tight">
							<span className="font-heading text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
								Positron
							</span>
							<span className="hidden text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 sm:block">
								Nachweisgesteuerte Bedienoberfläche
							</span>
						</span>
					</NavLink>
				</div>

				{/* Right: Theme Toggle + Health */}
				<div className="flex items-center gap-2">
					<ThemeToggle />
					<HealthIndicator />
				</div>
			</div>
		</header>
	);
}
