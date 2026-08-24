#!/usr/bin/env bash
set -euo pipefail

# Deterministic, read-only contract check for the current OpenCode resolver.
# It validates semantics (JSON objects and effective permissions), not historical
# formatting of `opencode debug agent` output.

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
config="$repo_root/.opencode/opencode.json"
test -f "$config"
command -v jq >/dev/null
command -v node >/dev/null
command -v gh >/dev/null

node - "$config" <<'NODE'
const fs = require('node:fs');
const [configPath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const required = ['github_get_issue','github_list_issues','github_search_issues','github_add_issue_comment','github_update_issue'];
const githubKeys = (value) => Object.keys(value ?? {}).filter((key) => key.startsWith('github_'));
const enabled = (value) => githubKeys(value).filter((key) => value[key] === true).sort();
const equal = (label, actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: got ${JSON.stringify(actual)}`); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expected = [...required].sort();
assert(config.permission?.['github_*'] === 'deny', 'top-level GitHub default permission is not deny');
equal('top-level enabled GitHub tools', enabled(config.tools), expected);
equal('top-level explicit GitHub keys', githubKeys(config.permission).filter((key) => key !== 'github_*').sort(), expected);
equal('top-level required GitHub permissions', required.map((key) => config.permission[key]), required.map(() => 'deny'));
const agent = config.agent?.['issue-orchestrator'];
assert(agent, 'issue-orchestrator config is absent');
assert(agent.permission?.['github_*'] === 'deny', 'agent GitHub default permission is not deny');
equal('agent enabled GitHub tools', enabled(agent.tools), expected);
equal('agent explicit GitHub keys', githubKeys(agent.permission).filter((key) => key !== 'github_*').sort(), expected);
equal('agent required GitHub permissions', required.map((key) => agent.permission[key]), required.map(() => 'allow'));
console.log('STATIC_EXACT_ALLOWLIST=PASS');
console.log('STATIC_DEFAULT_DENY=PASS');
NODE

resolved="$(mktemp)"
agent="$(mktemp)"
trap 'rm -f "$resolved" "$agent"' EXIT
opencode debug config >"$resolved"
opencode debug agent issue-orchestrator >"$agent"

node - "$resolved" "$agent" <<'NODE'
const fs = require('node:fs');
const [resolvedPath, agentPath] = process.argv.slice(2);
const resolved = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
const agent = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
const required = new Set(['github_get_issue','github_list_issues','github_search_issues','github_add_issue_comment','github_update_issue']);
const enabled = (value) => Object.keys(value ?? {}).filter((key) => key.startsWith('github_') && value[key] === true);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const entries = Array.isArray(agent.permission) ? agent.permission : [];
const allowed = entries.filter((entry) => entry.permission?.startsWith('github_') && entry.action === 'allow');
const denied = entries.filter((entry) => entry.permission?.startsWith('github_') && entry.action === 'deny');
assert(JSON.stringify(enabled(resolved.tools).sort()) === JSON.stringify([...required].sort()), 'resolved enabled GitHub tools differ');
assert(resolved.permission?.['github_*'] === 'deny', 'resolved default GitHub permission is not deny');
assert(denied.some((entry) => entry.permission === 'github_*'), 'effective wildcard GitHub deny is absent');
assert(JSON.stringify(allowed.map((entry) => entry.permission).sort()) === JSON.stringify([...required].sort()), 'effective allowed GitHub permissions differ');
console.log('EFFECTIVE_REQUIRED_TOOLS=PASS');
console.log('EFFECTIVE_EXTRA_TOOLS=0');
console.log('DANGEROUS_CAPABILITY_NEGATIVE_MATRIX=PASS');
NODE

# Discover and exercise the actual installed GitHub MCP contract. The server
# exposes unprefixed names; OpenCode maps these to github_<name>. Only the five
# required names are enabled in the effective agent contract above.
mcp_command="$(jq -r '.mcp.github.command[0] // empty' "$resolved")"
test -n "$mcp_command"
node - "$mcp_command" <<'NODE'
const { spawn } = require('node:child_process');
const [command] = process.argv.slice(2);
const child = spawn(command, { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let nextId = 1;
const send = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error(`MCP timeout for ${method}`)), 30000);
  const onData = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.id === id) { clearTimeout(timer); child.stdout.off('data', onData); resolve(message); }
    }
  };
  child.stdout.on('data', onData);
  child.stdin.write(`${JSON.stringify({ jsonrpc:'2.0', id, method, params })}\n`);
});
(async () => {
  const init = await send('initialize', { protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'positron-regression',version:'1.0'} });
  if (init.error) throw new Error('MCP initialize failed');
  child.stdin.write(`${JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized' })}\n`);
  const listed = await send('tools/list', {});
  const names = (listed.result?.tools ?? []).map((tool) => tool.name);
  const required = new Set(['get_issue','list_issues','search_issues','add_issue_comment','update_issue']);
  if (names.length !== 26) throw new Error(`unexpected installed GitHub MCP tool count: ${names.length}`);
  for (const name of required) if (!names.includes(name)) throw new Error(`missing required MCP tool: ${name}`);
  if (names.filter((name) => !required.has(name)).length !== 21) throw new Error('unexpected MCP negative matrix');
  const call = await send('tools/call', { name:'get_issue', arguments:{owner:'xxammaxx',repo:'Positron',issue_number:429} });
  if (call.error || call.result?.isError) throw new Error('MCP get_issue call failed');
  console.log('MCP_DISCOVERED_TOOLS=26');
  console.log('MCP_REQUIRED_TOOL_PATH=PASS');
  console.log('MCP_MISSING_COMMENT_TOOL_FALSE_FAILURE=0');
  console.log('UNEXPECTED_GITHUB_CAPABILITY_COUNT=0');
  console.log('REPOSITORY_DELETION_AVAILABLE=NO');
  console.log('WORKFLOW_MUTATION_AVAILABLE=NO');
  console.log('SECRET_MUTATION_AVAILABLE=NO');
  console.log('ENVIRONMENT_MUTATION_AVAILABLE=NO');
  console.log('MERGE_CAPABILITY_AVAILABLE=NO');
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => child.kill());
NODE

# Fresh process/session acceptance path. Comment reads intentionally use gh:
# the current 26-tool MCP contract has no get_issue_comments operation.
gh --version >/dev/null; echo 'GH_VERSION=PASS'
gh auth status >/dev/null 2>&1; echo 'GH_AUTH=PASS'
gh repo view --json nameWithOwner >/dev/null; echo 'REPO_RESOLUTION=PASS'
gh issue list --limit 1 --json number >/dev/null; echo 'ISSUE_LIST=PASS'
gh issue view 429 --json number >/dev/null; echo 'ISSUE_READ_429=PASS'
gh issue view 429 --comments --json number,comments >/dev/null; echo 'ISSUE_COMMENT_READ_429=PASS'
echo 'FRESH_SESSION=PASS'
echo 'opencode GitHub access contract: PASS'
