// Vitest setup — forces fake mode for integration tests
process.env.POSITRON_GITHUB_MODE = 'fake';
process.env.GITHUB_MODE = 'fake';
// QA-029: Disable BullMQ queue for deterministic inline pipeline execution in tests
process.env.POSITRON_DISABLE_QUEUE = 'true';
Reflect.deleteProperty(process.env, 'POSITRON_WORKSPACE_ROOT');
