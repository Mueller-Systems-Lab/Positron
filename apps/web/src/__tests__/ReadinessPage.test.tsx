import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ReadinessPage from '../components/readiness/ReadinessPage.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: { getOperatorReadiness: vi.fn() } }));

const response = {
	contract: 'positron.operator-readiness.v1' as const,
	overall_status: 'READY_DEMO' as const,
	next_action: { label: 'Start a safe demo run', href: '/' },
	server: {
		status: 'READY_DEMO',
		reason_code: 'SERVER_RESPONDING',
		human_message: 'Server is responding.',
		remediation_hint: 'No action required.',
		evidence_ref: '/api/health',
		last_checked_at: 'now',
	},
};

describe('ReadinessPage', () => {
	it('projects backend state and allows refresh', async () => {
		vi.mocked(api.getOperatorReadiness).mockResolvedValue(response);
		render(
			<MemoryRouter>
				<ReadinessPage />
			</MemoryRouter>,
		);
		await waitFor(() =>
			expect(screen.getByTestId('readiness-overall')).toHaveTextContent('READY_DEMO'),
		);
		fireEvent.click(screen.getByRole('button', { name: 'Refresh checks' }));
		expect(api.getOperatorReadiness).toHaveBeenCalledTimes(2);
	});
});
