// Positron Worker Pipeline — kanonische Execution Boundary
//
// Die Pipeline-Logik lebt in diesem Package, damit Worker (BullMQ) und
// Server-Inline-Fallback dieselbe kanonische Runtime nutzen — keine zweite
// Positron-Runtime (P3: One control plane. One canonical execution lifecycle.)

export {
	runPipeline,
	isRunInWorkerScope,
	isFaultTargetedToRun,
	isTerminalRunRecord,
} from './pipeline-runner.js';
export type { PipelineDeps } from './pipeline-runner.js';
