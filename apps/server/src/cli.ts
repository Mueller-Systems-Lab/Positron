#!/usr/bin/env node
// Positron CLI — Command-line interface for Positron
//
// Usage:
//   positron run --issueNumber 42 --repoId repo-1 --autonomyLevel 2
//   positron run --help
//
// The CLI calls the Positron REST API to start runs.
// Requires the server to be running (start with `npm run dev` or `npm start`).

import process from 'node:process';

interface RunCommandArgs {
	issueNumber: number;
	repoId?: string;
	autonomyLevel?: number;
	serverUrl?: string;
}

function printHelp(): void {
	console.log(`
Positron CLI — Evidence-Gated GitHub Issue Execution

Usage:
  positron run --issueNumber <number> [options]

Options:
  --issueNumber <n>    GitHub Issue number (required)
  --repoId <id>        Repository ID (default: config from server env)
  --autonomyLevel <n>  Autonomy level 0-2 (default: 2)
  --serverUrl <url>    Server URL (default: http://localhost:3000)
  --help               Show this help

Examples:
  positron run --issueNumber 42
  positron run --issueNumber 42 --autonomyLevel 1
  positron run --issueNumber 42 --serverUrl http://localhost:3000
`);
}

type ParseResult =
	| { kind: 'ok'; args: RunCommandArgs }
	| { kind: 'help' }
	| { kind: 'error'; message: string };

export function parseArgs(argv: string[]): ParseResult {
	const args: RunCommandArgs = {
		issueNumber: 0,
		repoId: undefined,
		autonomyLevel: 2,
		serverUrl: 'http://localhost:3000',
	};

	let i = 2; // Skip "node" and script path
	const cmd = argv[i];
	if (!cmd) {
		return {
			kind: 'error',
			message: 'Kein Befehl angegeben. Verwende "positron run --help" für Hilfe.',
		};
	}
	if (cmd !== 'run') {
		if (cmd === '--help' || cmd === '-h') {
			return { kind: 'help' };
		}
		return {
			kind: 'error',
			message: `Unbekannter Befehl: "${cmd}". Verwende "positron run --help" für Hilfe.`,
		};
	}
	i++;

	while (i < argv.length) {
		const key = argv[i];
		const val = argv[i + 1];

		switch (key) {
			case '--issueNumber':
				if (val) {
					args.issueNumber = Number.parseInt(val, 10);
					if (Number.isNaN(args.issueNumber) || args.issueNumber < 1) {
						return { kind: 'error', message: '--issueNumber muss eine positive Zahl sein' };
					}
					i += 2;
				} else {
					return { kind: 'error', message: '--issueNumber benötigt einen Wert' };
				}
				break;
			case '--repoId':
				if (val) {
					args.repoId = val;
					i += 2;
				} else {
					i++;
				}
				break;
			case '--autonomyLevel':
				if (val) {
					args.autonomyLevel = Number.parseInt(val, 10);
					if (
						Number.isNaN(args.autonomyLevel!) ||
						args.autonomyLevel! < 0 ||
						args.autonomyLevel! > 2
					) {
						return { kind: 'error', message: '--autonomyLevel muss 0, 1 oder 2 sein' };
					}
					i += 2;
				} else {
					i++;
				}
				break;
			case '--serverUrl':
				if (val) {
					args.serverUrl = val;
					i += 2;
				} else {
					i++;
				}
				break;
			case '--help':
			case '-h':
				return { kind: 'help' };
			default:
				return { kind: 'error', message: `Unbekannte Option: ${key}` };
		}
	}

	if (!args.issueNumber) {
		return { kind: 'error', message: '--issueNumber ist erforderlich' };
	}

	return { kind: 'ok', args };
}

/** Prints an error and returns false (for use with process.exit) */
function printError(message: string): void {
	console.error(`Fehler: ${message}`);
	console.error('Verwende "positron run --help" für Hilfe.');
}

export async function runCommand(args: RunCommandArgs): Promise<void> {
	const serverUrl = args.serverUrl ?? 'http://localhost:3000';
	const repoId = args.repoId ?? 'repo-1';

	console.log(
		`▶ Starte Run für Issue #${args.issueNumber} (Repo: ${repoId}, Autonomie: ${args.autonomyLevel ?? 2})`,
	);

	try {
		const response = await fetch(`${serverUrl}/api/repos/${repoId}/runs`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				issueNumber: args.issueNumber,
				autonomyLevel: args.autonomyLevel ?? 2,
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => 'Unbekannter Fehler');
			console.error(`❌ Server-Fehler (${response.status}): ${errorBody}`);
			process.exit(1);
		}

		// Prüfe Content-Type auf JSON — verhindert Crash bei non-JSON 2xx
		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.includes('json')) {
			const body = await response.text().catch(() => '');
			console.error(`❌ Server antwortete mit ${contentType} statt JSON`);
			console.error(`   Body: ${body.slice(0, 500)}`);
			process.exit(1);
		}

		const data = (await response.json()) as {
			run: { id: string; phase: string; status: string };
			eventCount: number;
		};

		console.log('✅ Run erfolgreich gestartet:');
		console.log(`   ID:     ${data.run.id}`);
		console.log(`   Phase:  ${data.run.phase}`);
		console.log(`   Status: ${data.run.status}`);
		console.log(`   Events: ${data.eventCount}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`❌ Verbindungsfehler: ${message}`);
		console.error(`   Stelle sicher, dass der Server unter ${serverUrl} läuft.`);
		process.exit(1);
	}
}

// Main entry when called as CLI
async function main(): Promise<void> {
	const result = parseArgs(process.argv);
	switch (result.kind) {
		case 'help':
			printHelp();
			process.exit(0);
			return;
		case 'error':
			printError(result.message);
			process.exit(1);
			return;
		case 'ok':
			await runCommand(result.args);
			return;
	}
}

// Auto-execute when run directly (via `positron` bin or `node dist/cli.js`)
const isDirectRun =
	process.argv[1] &&
	(process.argv[1].endsWith('/cli.js') ||
		process.argv[1].endsWith('/cli.ts') ||
		process.argv[1].endsWith('/positron') ||
		process.argv[1].includes('/bin/positron') ||
		process.argv[1].includes('\\bin\\positron'));
if (isDirectRun) {
	main().catch((err) => {
		console.error('❌ CLI-Fehler:', err);
		process.exit(1);
	});
}

export type { RunCommandArgs };
