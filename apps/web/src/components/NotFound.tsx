import type React from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n/index.js';

export default function NotFound(): React.ReactElement {
	return (
		<div className="card text-center py-16">
			<p className="text-6xl font-bold text-slate-600 mb-4">404</p>
			<h1 className="text-2xl font-bold text-white mb-2">{t('Page not found')}</h1>
			<p className="text-slate-400 mb-6">{t('The requested page does not exist.')}</p>
			<Link to="/" className="btn-primary inline-block">
				← Zurück zum Dashboard
			</Link>
		</div>
	);
}
