// Positron — Command Runner für Sandbox-Operationen

import { spawn } from 'node:child_process';
import { EOL } from 'node:os';

/** Ergebnis eines ausgeführten Kommandos */
export interface CommandResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	command: string;
	/** true, wenn der Prozess durch Timeout/Cancellation beendet wurde */
	terminated: boolean;
}

/** Optionen für command-runner */
export interface RunCommandOptions {
	/** Working Directory */
	cwd: string;
	/** Timeout in Millisekunden (default: 120000 = 2 Minuten) */
	timeout?: number;
	/** Umgebungsvariablen */
	env?: Record<string, string | undefined>;
	/** Stdin-Input (optional). Wenn nicht gesetzt, wird stdin geschlossen. */
	stdin?: string;
	/**
	 * P3.5 (Phase B): AbortSignal für aktive Cancellation.
	 * Bei abort: graceful (SIGTERM) → Grace-Periode → forced (SIGKILL).
	 * Der Timeout-Pfad nutzt dieselbe Termination-Semantik.
	 */
	signal?: AbortSignal;
	/** Grace-Periode zwischen SIGTERM und SIGKILL (default 2000ms) */
	killGraceMs?: number;
	/** Tötet die gesamte Prozessgruppe (Enkel-Prozesse). Nur explizit setzen. */
	killProcessGroup?: boolean;
}

/**
 * Führt ein Kommando in einem Child Process aus.
 * Nutzt spawn (nicht exec) für streaming output.
 *
 * P3.5 (Phase B): Timeout UND externes AbortSignal beenden den Prozess
 * WIRKLICH (graceful → forced), statt nur den Promise zu beenden. Kein
 * Zombie-Prozess, kein late stdout-Eintrag nach Termination.
 */
export async function runCommand(
	command: string,
	args: string[],
	options: RunCommandOptions,
): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const startTime = Date.now();
		const timeoutMs = options.timeout ?? 120_000;
		const graceMs = options.killGraceMs ?? 2000;

		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: options.killProcessGroup ?? false,
		});

		// Close stdin by default — prevents hangs with CLI tools that wait for input
		if (options.stdin) {
			child.stdin?.write(options.stdin);
			child.stdin?.end();
		} else {
			child.stdin?.end();
		}

		let stdout = '';
		let stderr = '';
		let exitCode: number | null = null;
		let terminated = false;
		let timedOut = false;
		let settled = false;
		let timeoutTimer: ReturnType<typeof setTimeout>;
		let forceTimer: ReturnType<typeof setTimeout> | undefined;
		let settleTimer: ReturnType<typeof setTimeout> | undefined;

		const settle = (err: Error | null, result?: CommandResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			clearTimeout(forceTimer);
			clearTimeout(settleTimer);
			if (err) {
				reject(err);
			} else if (result) {
				resolve(result);
			}
		};

		const killGroup = (signal: NodeJS.Signals): void => {
			// Security-Review m1: Nur signalisieren, solange der Child live ist
			// (exitCode/signalCode null) — verhindert PID-Reuse-Kill nach Exit.
			if (child.exitCode !== null || child.signalCode !== null) return;
			if (options.killProcessGroup && child.pid) {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch {
					// Fallback: direkter kill
				}
			}
			child.kill(signal);
		};

		// Graceful → (Grace-Periode) → forced. Terminiert den Prozessbaum
		// nur, wenn `killProcessGroup` explizit gesetzt ist.
		const escalate = (): void => {
			if (terminated) return;
			terminated = true;
			killGroup('SIGTERM');
			forceTimer = setTimeout(() => {
				killGroup('SIGKILL');
				// SIGKILL ist nicht blockierbar; der Close-Listener finalisiert.
				settleTimer = setTimeout(() => {
					settle(
						timedOut
							? new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`)
							: new Error(`Command cancelled: ${command} ${args.join(' ')}`),
					);
				}, 100);
			}, graceMs);
		};

		const onExit = (code: number | null): void => {
			exitCode = code;
			if (settled) return;
			clearTimeout(timeoutTimer);
			const durationMs = Date.now() - startTime;
			if (terminated) {
				settle(
					timedOut
						? new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`)
						: new Error(`Command cancelled: ${command} ${args.join(' ')}`),
				);
				return;
			}
			// Review-Fix: erst auf 'close' finalisieren (alle stdio-Streams
			// geleert), damit stdout/stderr vollständig erfasst werden.
			// onExit merkt nur den Code; onClose settled.
			exitCode = code;
		};

		const onError = (err: Error): void => {
			settle(new Error(`Failed to spawn command: ${err.message}`));
		};

		// 'close' feuert nach 'exit' UND nach dem Schließen aller Streams —
		// vollständige stdout/stderr-Garantie (Review-Fix R1-MINOR).
		const onClose = (code: number | null): void => {
			exitCode = code;
			if (settled) return;
			clearTimeout(timeoutTimer);
			const durationMs = Date.now() - startTime;
			if (terminated) {
				settle(
					timedOut
						? new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`)
						: new Error(`Command cancelled: ${command} ${args.join(' ')}`),
				);
				return;
			}
			settle(null, {
				exitCode: code,
				stdout,
				stderr,
				durationMs,
				command: `${command} ${args.join(' ')}`,
				terminated: false,
			});
		};

		child.on('exit', onExit);
		child.on('close', onClose);
		child.on('error', onError);

		timeoutTimer = setTimeout(() => {
			timedOut = true;
			escalate();
		}, timeoutMs);

		if (options.signal) {
			if (options.signal.aborted) {
				escalate();
			} else {
				options.signal.addEventListener(
					'abort',
					() => {
						timedOut = false;
						escalate();
					},
					{ once: true },
				);
			}
		}

		child.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});
	});
}
/**
 * Führt ein Kommando mit Timeout aus.
 */
export async function runCommandWithTimeout(
	command: string,
	args: string[],
	options: RunCommandOptions,
	timeoutMs: number,
): Promise<CommandResult> {
	return runCommand(command, args, { ...options, timeout: timeoutMs });
}

/** Fehler bei Git-Kommandos */
export class GitCommandError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GitCommandError';
	}
}

export class GitCommandFailedError extends GitCommandError {
	constructor(command: string, exitCode: number, stderr: string) {
		super(`Git command failed: ${command} (exit ${exitCode}): ${stderr.slice(0, 200)}`);
		this.name = 'GitCommandFailedError';
	}
}

export class GitCommandPolicyError extends GitCommandError {
	constructor(message: string) {
		super(message);
		this.name = 'GitCommandPolicyError';
	}
}
