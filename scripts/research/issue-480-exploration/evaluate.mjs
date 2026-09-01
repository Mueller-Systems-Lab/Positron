import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: node evaluate.mjs <runtime-root>');
const result = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')),
	a = result.arms.A,
	b = result.arms.B,
	c = result.arms.C;
const sufficient = [a, b, c].every((x) => x.valid >= 5);
const quality =
	sufficient &&
	b.verified_success_rate >= Math.min(a.verified_success_rate, c.verified_success_rate) - 0.1;
const beats = (control) =>
	b.median_tool_calls <= control.median_tool_calls - 1 &&
	b.median_tool_calls <= control.median_tool_calls * 0.9;
const efficiency = beats(a) && beats(c);
result.quality_non_inferior = quality;
result.b_beats_a = { absolute: beats(a), relative: efficiency };
result.b_beats_c = { absolute: beats(c), relative: efficiency };
result.decision = !sufficient
	? 'AMBER_POSITRON_EXPLORATION_REPLICATION_INSUFFICIENT_VALID_RUNTIME'
	: !quality
		? 'GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_QUALITY_REGRESSION'
		: !efficiency
			? 'GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_NO_MARGINAL_VALUE'
			: 'GREEN_POSITRON_EXPLORATION_EFFICIENCY_VALUE_PROVEN';
writeFileSync(join(root, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
	JSON.stringify(
		{
			decision: result.decision,
			quality_non_inferior: quality,
			efficiency,
			valid: { A: a.valid, B: b.valid, C: c.valid },
		},
		null,
		2,
	) + '\n',
);
