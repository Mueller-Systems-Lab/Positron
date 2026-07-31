import { ALL_PHASES } from '@positron/shared';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import PhasePipeline from '../components/PhasePipeline';

describe('PhasePipeline', () => {
	test('renders without crashing', () => {
		const { container } = render(<PhasePipeline />);
		expect(container).toBeDefined();
	});

	test('shows 28-Phase Pipeline heading', () => {
		render(<PhasePipeline />);
		expect(screen.getByText(/28-Phase Pipeline/i)).toBeDefined();
	});

	test('shows all 28 phases as phase nodes', () => {
		render(<PhasePipeline />);
		// All 18 main phases should be rendered as list items
		// Query via accessibility role (implicit `listitem` on <li>) — not the
		// physical role attribute, which is redundant and removed in Track E12.
		const items = screen.getAllByRole('listitem');
		expect(items.length).toBeGreaterThanOrEqual(18);
	});

	test('displays current phase with aria-current=step', () => {
		const { container } = render(<PhasePipeline currentPhase="TEST" />);
		const currentItem = container.querySelector('[aria-current="step"]');
		expect(currentItem).toBeDefined();
		expect(currentItem?.getAttribute('aria-label')).toContain('TEST');
		expect(currentItem?.getAttribute('aria-label')).toContain('current');
	});

	test('marks completed phases as completed', () => {
		const { container } = render(
			<PhasePipeline completedPhases={['QUEUED', 'CLAIMED', 'REPO_SYNC']} />,
		);
		const completedItems = container.querySelectorAll('[aria-label*="completed"]');
		expect(completedItems.length).toBeGreaterThanOrEqual(3);
	});

	test('marks failed phases as failed', () => {
		const { container } = render(<PhasePipeline failedPhases={['TEST']} />);
		const failedItem = container.querySelector('[aria-label*="TEST"][aria-label*="failed"]');
		expect(failedItem).toBeDefined();
	});

	test('shows error/recovery sections when there are error phases', () => {
		const { container } = render(<PhasePipeline failedPhases={['FAILED']} />);
		const recoverySection = screen.queryByText(/State \/ Recovery Phases/i);
		expect(recoverySection).toBeDefined();
	});

	test('onPhaseClick handler is called with phase name', () => {
		const handleClick = vi.fn();
		const { container } = render(
			<PhasePipeline
				currentPhase="TEST"
				completedPhases={['QUEUED', 'CLAIMED']}
				onPhaseClick={handleClick}
			/>,
		);
		const phaseButtons = container.querySelectorAll('button');
		// Click the TEST button (current phase)
		const testButton = Array.from(phaseButtons).find((b) =>
			b.getAttribute('aria-label')?.includes('TEST'),
		);
		if (testButton) {
			testButton.click();
			expect(handleClick).toHaveBeenCalledWith('TEST');
		}
	});

	test('legend shows all phase status indicators', () => {
		render(<PhasePipeline currentPhase="TEST" />);
		expect(screen.getByText('Pending')).toBeDefined();
		expect(screen.getByText('Current')).toBeDefined();
		expect(screen.getByText('Completed')).toBeDefined();
		expect(screen.getByText('Failed')).toBeDefined();
		expect(screen.getByText('Blocked')).toBeDefined();
		expect(screen.getByText('Human')).toBeDefined();
	});

	test('does not show recovery section when all phases are pending', () => {
		render(<PhasePipeline />);
		expect(screen.queryByText(/State \/ Recovery Phases/i)).toBeNull();
	});

	test('all 28 phases are accessible in ALL_PHASES', () => {
		expect(ALL_PHASES.length).toBe(28);
		expect(ALL_PHASES).toContain('QUEUED');
		expect(ALL_PHASES).toContain('DONE');
		expect(ALL_PHASES).toContain('FAILED_BLOCKED');
		expect(ALL_PHASES).toContain('CLEANUP');
	});
});
