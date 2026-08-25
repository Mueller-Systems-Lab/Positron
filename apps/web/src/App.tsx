import type React from 'react';
import { Route, Routes } from 'react-router-dom';
import AdminPage from './components/admin/AdminPage.jsx';
import DashboardPage from './components/dashboard/DashboardPage.jsx';
import EvidencePage from './components/evidence/EvidencePage.jsx';
import EvolutionPanel from './components/evolution/EvolutionPanel.jsx';
import AppShell from './components/layout/AppShell.jsx';
import NotFound from './components/NotFound.jsx';
import ProjectsPage from './components/projects/ProjectsPage.jsx';
import Repositories from './components/Repositories.jsx';
import RunDetail from './components/RunDetail.jsx';
import RunsPage from './components/runs/RunsPage.jsx';
import SettingsPage from './components/settings/SettingsPage.jsx';

export default function App(): React.ReactElement {
	return (
		<Routes>
			<Route element={<AppShell />}>
				<Route path="/" element={<DashboardPage />} />
				<Route path="/runs" element={<RunsPage />} />
				<Route path="/runs/:id" element={<RunDetail />} />
				<Route path="/evidence" element={<EvidencePage />} />
				<Route path="/projects" element={<ProjectsPage />} />
				<Route path="/repos" element={<Repositories />} />
				<Route path="/evolution" element={<EvolutionPanel />} />
				<Route path="/settings" element={<SettingsPage />} />
				<Route path="/admin" element={<AdminPage />} />
				<Route path="*" element={<NotFound />} />
			</Route>
		</Routes>
	);
}
