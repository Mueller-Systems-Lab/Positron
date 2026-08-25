// Positron — Rudolph Beacon Benchmark Package
//
// Deterministic benchmark system for Positron capability verification.
// Integrates with DeterministicFixtureAgent, OpenCodeDryRunAgent, and
// existing EvidenceReport / ExecutionMode types.

// Domain model
export type { BeaconStatus, ReindeerBeacon } from './beacon-domain.js';
export {
	BATTERY_GREEN_THRESHOLD,
	BATTERY_YELLOW_LOWER,
	classifyBeacon,
	createBeacon,
	isStale,
	RSSI_GREEN_THRESHOLD,
	RSSI_YELLOW_LOWER,
	STALE_MINUTES,
} from './beacon-domain.js';

// Fixtures / Scan Simulator
export type { BeaconScanEntry, BeaconScanResult } from './beacon-fixtures.js';
export { KNOWN_BEACONS, simulateBeaconScan } from './beacon-fixtures.js';
export type { RudolphBenchmarkConfig } from './benchmark-runner.js';
// Benchmark Runner
export { BenchmarkRunner } from './benchmark-runner.js';
// Controlled Real-Mode Probe
export type {
	CommitReadinessCheck,
	ControlledRealProbeResult,
	ProbeGateCheck,
} from './controlled-real-probe.js';
export {
	checkCommitReadiness,
	isCommitReady,
	isRedHoldAction,
	runControlledRealModeProbe,
} from './controlled-real-probe.js';
// Evidence Contract
export type {
	BenchmarkCommandResult,
	BenchmarkConclusion,
	BenchmarkIssueResult,
	BlockedAction,
	CapabilityDelta,
	RudolphBenchmarkRunSummary,
} from './evidence-contract.js';
export {
	containsSecrets,
	createCommandResult,
	createIssueResult,
	determineConclusionStatus,
	redactSecrets,
	VALID_EXECUTION_MODES,
	validateRunSummary,
} from './evidence-contract.js';
// Traceability
export type { IssueTraceEntry, TraceabilityMap } from './traceability.js';
export {
	buildTraceabilityMap,
	validateIssueIndependence,
	validateTraceabilityMap,
} from './traceability.js';
