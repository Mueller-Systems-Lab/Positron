import { type ReactElement, useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { t } from '../../i18n/index.js';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';

export default function AppShell(): ReactElement {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const toggleSidebar = useCallback(() => {
		setSidebarOpen((prev) => !prev);
	}, []);

	const closeSidebar = useCallback(() => {
		setSidebarOpen(false);
	}, []);

	return (
		<div className="relative flex min-h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
			<div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute -left-32 top-[-7rem] h-80 w-80 rounded-full bg-sky-500/10 blur-3xl dark:bg-sky-400/10" />
				<div className="absolute right-[-8rem] top-40 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-500/10" />
				<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/30 to-transparent" />
			</div>

			{/* Skip to content */}
			<a href="#main-content" className="skip-to-content">
				{t('Skip to content')}
			</a>

			{/* Top Bar */}
			<TopBar onToggleSidebar={toggleSidebar} />

			{/* Body: Sidebar + Main */}
			<div className="relative z-10 flex flex-1 overflow-hidden">
				{/* Sidebar — handles mobile overlay + desktop sidebar internally */}
				<Sidebar open={sidebarOpen} onClose={closeSidebar} />

				{/* Main Content */}
				<main id="main-content" className="flex-1 min-w-0 overflow-y-auto">
					<div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	);
}
