import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => fs.readFileSync(new URL(relative, `file://${root}`), 'utf8');
const catalog = read('apps/web/src/i18n/de-DE.ts');
const helper = read('apps/web/src/i18n/index.ts');
const entry = read('apps/web/src/main.tsx');
const html = read('apps/web/index.html');

assert.match(catalog, /DEFAULT_LOCALE = 'de-DE'/);
assert.match(catalog, /UI_LANGUAGE = 'German'/);
assert.match(helper, /messages\[key as TranslationKey\]/);
assert.match(entry, /document\.documentElement\.lang = DEFAULT_LOCALE/);
assert.match(html, /Positron — Nachweisgesteuerte Agentenausführung/);

// Product localization must be React presentation code, not test/browser DOM surgery.
for (const [file, source] of [
	['apps/web/src/i18n/index.ts', helper],
	['apps/web/src/i18n/de-DE.ts', catalog],
	['apps/web/src/main.tsx', entry],
]) {
	assert.doesNotMatch(
		source,
		/MutationObserver|innerHTML\s*=|textContent\s*=|querySelectorAll\(/,
		`${file} contains DOM post-processing`,
	);
}

const specs = fs.readdirSync(new URL('e2e/', `file://${root}`), { recursive: true });
for (const relative of specs.filter((value) => String(value).endsWith('.ts'))) {
	const file = String(relative);
	const source = read(`e2e/${file}`);
	assert.doesNotMatch(
		source,
		/page\.evaluate\([^)]*(translate|Deutsch|German|replace)/is,
		`${file} injects localization into the browser`,
	);
}

console.log('LOCALIZATION_IMPLEMENTED_IN_PRODUCT_CODE=YES');
console.log('TEST_INJECTED_LOCALIZATION=NO');
