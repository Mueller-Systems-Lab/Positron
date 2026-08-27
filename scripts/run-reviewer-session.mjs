#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const readOption = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};

const agent = readOption('--agent');
const model = readOption('--model');
const contextFile = readOption('--context-file');
const backend = (readOption('--backend', 'AUTO') ?? 'AUTO').toUpperCase();
const timeoutMs = Number(readOption('--timeout-ms', '90000'));

if (!agent || !model || !contextFile || !['AUTO', 'CHILD', 'ISOLATED'].includes(backend)) {
	console.error(
		'usage: run-reviewer-session --agent <id> --model <provider/model> --context-file <path> [--backend AUTO|CHILD|ISOLATED] [--timeout-ms <ms>]',
	);
	process.exit(2);
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('timeout must be at least 1000ms');

const context = readFileSync(contextFile, 'utf8');
const provider = model.split('/', 1)[0];

const run = (commandArgs) => {
	const started = new Date().toISOString();
	const result = spawnSync('opencode', commandArgs, {
		cwd: process.cwd(),
		encoding: 'utf8',
		timeout: timeoutMs,
		maxBuffer: 16 * 1024 * 1024,
	});
	const ended = new Date().toISOString();
	const stdout = result.stdout ?? '';
	const stderr = result.stderr ?? '';
	const events = stdout
		.split('\n')
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
	const sessionIds = [...new Set(events.map((event) => event.sessionID).filter(Boolean))];
	const text = events
		.filter((event) => event.type === 'text' && typeof event.part?.text === 'string')
		.map((event) => event.part.text)
		.join('\n');
	const completed = events.some(
		(event) => event.type === 'step_finish' && event.part?.reason && event.part.reason !== 'tool-calls',
	);
	return {
		started,
		ended,
		exit: result.status ?? (result.error?.code === 'ETIMEDOUT' ? 124 : 1),
		timed_out: result.error?.code === 'ETIMEDOUT',
		events,
		sessionIds,
		text,
		completed,
		stderr: stderr.trim().slice(-2000),
	};
};

const structured = (text) => {
	const field = (name) => text.match(new RegExp(`^${name}:\\s*(.*)$`, 'mi'))?.[1]?.trim() ?? '';
	const count = (name) => {
		const value = field(name);
		const number = Number(value);
		return Number.isFinite(number) ? number : value === '' || /^(none|zero|n\/a)$/i.test(value) ? 0 : null;
	};
	return {
		verdict: field('VERDICT') || field('READY') || field('MERGE_READY') || field('CLOSE_READY'),
		critical: count('CRITICAL'),
		major: count('MAJOR'),
	};
};

const childArgs = [
	'run',
	'--pure',
	'--auto',
	'--format',
	'json',
	'--agent',
	'issue-orchestrator',
	'--model',
	model,
	'--command',
	agent,
	context,
];
const isolatedArgs = [
	'run',
	'--pure',
	'--auto',
	'--format',
	'json',
	'--agent',
	agent,
	'--model',
	model,
	`${context}\n\nOUTPUT CONTRACT (do not infer a desired outcome):\nReturn exactly these labeled fields in your final response: AGENT, ROLE, PROVIDER, MODEL, SESSION_ID, PURPOSE, FINDINGS, CRITICAL (integer), MAJOR (integer), MINOR, LIMITATIONS, and the applicable readiness field (VERDICT, READY, MERGE_READY, or CLOSE_READY). Decide every value independently from the supplied evidence.`,
];

const isSuccessfulChild = (result) => {
	const taskEvents = result.events.filter((event) => event.type === 'tool_use' && event.part?.tool === 'task');
	const task = taskEvents.at(-1);
	const metadata = task?.metadata ?? task?.part?.metadata ?? {};
	const taskOutput = task?.part?.state?.output ?? '';
	const childSessionId = metadata.sessionId ?? metadata.sessionID;
	return Boolean(
		result.completed &&
		task?.part?.state?.status === 'completed' &&
		childSessionId &&
		new RegExp(`AGENT:\\s*${agent.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`, 'i').test(taskOutput),
	);
};

let childAttempt = null;
let result;
let selectedBackend = backend;
if (backend !== 'ISOLATED') {
	childAttempt = run(childArgs);
	if (isSuccessfulChild(childAttempt)) {
		const task = childAttempt.events
			.filter((event) => event.type === 'tool_use' && event.part?.tool === 'task')
			.at(-1);
		const metadata = task.metadata ?? task.part.metadata ?? {};
		const childSessionId = metadata.sessionId ?? metadata.sessionID;
		const parsed = structured(task.part.state.output ?? '');
		result = {
			AGENT: agent,
			BACKEND: 'CHILD',
			SESSION_ID: childSessionId,
			PARENT_SESSION_ID: task.sessionID,
			MODEL: model,
			PROVIDER: metadata.model?.providerID ?? provider,
			START: childAttempt.started,
			END: childAttempt.ended,
			VERDICT: parsed.verdict,
			CRITICAL: parsed.critical,
			MAJOR: parsed.major,
			COMPLETED: true,
			LIMITATIONS: '',
			CHILD_ATTEMPT: 'PASS',
			RESPONSE_TEXT: (task.part.state.output ?? '').slice(-6000),
		};
	} else if (backend === 'CHILD') {
		console.log(
			JSON.stringify({
				AGENT: agent,
				BACKEND: 'CHILD',
				COMPLETED: false,
				CHILD_ATTEMPT: 'FAIL',
				LIMITATIONS: childAttempt.timed_out ? 'CHILD_TIMEOUT' : 'CHILD_NO_STRUCTURED_RESULT',
			}),
		);
		process.exit(1);
	}
}

if (!result) {
	selectedBackend = 'ISOLATED';
	const isolated = run(isolatedArgs);
	const sessionId = isolated.sessionIds.at(-1);
	const parsed = structured(isolated.text);
	result = {
		AGENT: agent,
		BACKEND: 'ISOLATED',
		SESSION_ID: sessionId ?? null,
		PARENT_SESSION_ID: null,
		MODEL: model,
		PROVIDER: provider,
		START: isolated.started,
		END: isolated.ended,
		VERDICT: parsed.verdict,
		CRITICAL: parsed.critical,
		MAJOR: parsed.major,
		COMPLETED: Boolean(sessionId && isolated.completed),
		LIMITATIONS: isolated.timed_out
			? 'ISOLATED_TIMEOUT'
			: isolated.completed
				? ''
				: 'ISOLATED_NO_STRUCTURED_RESULT',
		CHILD_ATTEMPT: childAttempt
			? childAttempt.timed_out
				? 'TIMEOUT'
				: childAttempt.sessionIds.length === 0
					? 'NO_EVENT'
					: 'NO_STRUCTURED_CHILD_RESULT'
			: 'NOT_REQUESTED',
		RESPONSE_TEXT: isolated.text.slice(-6000),
	};
}

if (selectedBackend === 'ISOLATED' && !result.COMPLETED) process.exitCode = 1;
process.stdout.write(`${JSON.stringify(result)}\n`);
