import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { negativeCanary } from './harness.mjs';

const root = process.argv[2];
if (!root) throw new Error('usage: node negative-canary.mjs /tmp/positron-issue-476-runtime-*');
const result = negativeCanary();
writeFileSync(join(root, 'negative-canary.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!result.rejected || result.workspace_mutated) process.exitCode = 1;
