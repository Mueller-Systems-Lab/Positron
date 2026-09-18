import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import BlueprintPanel from '../components/dashboard/BlueprintPanel';

// Mock the api module
vi.mock('../api', () => ({
	api: {
		startDemoRun: vi.fn().mockResolvedValue({
			run: { id: 'demo-run-123' },
			message: 'Demo run started',
			blueprint: '# Test Blueprint',
		}),
		getBlueprint: vi.fn().mockResolvedValue({
			blueprint: '# Fetched Blueprint\n\nFrom real issue.',
			repoId: 'owner/repo',
			issueNumber: 123,
			generatedAt: '2025-01-01T00:00:00.000Z',
		}),
	},
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual('react-router-dom');
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

describe('BlueprintPanel', () => {
	test('renders without crashing', () => {
		const { container } = render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(container).toBeDefined();
	});

	test('shows Demo-Blueprint heading', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(screen.getByText('Demo-Blueprint')).toBeDefined();
	});

	test('shows description text', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(screen.getByText(/Demo-Lauf starten/)).toBeDefined();
	});

	test('has a textarea for blueprint input', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		const textarea = screen.getByRole('textbox', { name: /blueprint/i });
		expect(textarea).toBeDefined();
		expect(textarea).toHaveProperty('placeholder');
	});

	test('shows demo mode warning', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(screen.getByText(/Demo-Läufe pushen/i)).toBeDefined();
	});

	test('has Blueprint erzeugen button', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(screen.getByRole('button', { name: /Blueprint erzeugen/i })).toBeDefined();
	});

	test('has Demo-Lauf starten button', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(screen.getByRole('button', { name: /Demo-Lauf starten/i })).toBeDefined();
	});

	test('shows helpful message when no issue is selected', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(screen.getByText(/Wähle einen Lauf/)).toBeDefined();
	});

	test('has repository and issue number inputs', () => {
		render(
			<MemoryRouter>
				<BlueprintPanel />
			</MemoryRouter>,
		);
		expect(screen.getByPlaceholderText('owner/repo')).toBeDefined();
		expect(screen.getByPlaceholderText('Issue #')).toBeDefined();
	});
});
