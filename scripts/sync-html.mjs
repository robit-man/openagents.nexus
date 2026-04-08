#!/usr/bin/env node
/**
 * sync-html.mjs — the SINGLE SOURCE OF TRUTH for what the Cloudflare
 * Worker serves is `public/index.html`.
 *
 * `worker/html.ts` wraps that HTML in a template literal so the worker
 * can inline it at deploy time (`new Response(INDEX_HTML)`). The two
 * files DRIFT whenever anyone edits `public/index.html` without
 * re-running this script, because the worker is what Cloudflare
 * actually deploys, not the /public directory.
 *
 * Run this before `wrangler deploy` (or wire into `prebuild` in
 * package.json) to guarantee the worker always ships the latest HTML.
 *
 * Escapes: inside a JavaScript template literal we must escape:
 *   `  →  \`
 *   ${ →  \${
 *   \  →  \\     (but ONLY for standalone backslashes — leave existing
 *                 escape sequences like \x1B, \n intact. Since the
 *                 source HTML is a mix of JS module code + CSS + HTML,
 *                 every backslash in the source already means "escape",
 *                 so the cleanest approach is to double them all. This
 *                 preserves \x1B, \n, etc. when the template literal
 *                 is parsed — `\\x1B` in the source evaluates to
 *                 `\x1B` in the resulting string.)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT   = resolve(__dirname, '..');
const SRC    = join(ROOT, 'public', 'index.html');
const DST    = join(ROOT, 'worker', 'html.ts');

const html = readFileSync(SRC, 'utf8');

// Escape for template literal: the order matters — backslash first so
// the subsequent escapes don't get double-escaped.
const escaped = html
  .replace(/\\/g, '\\\\')
  .replace(/`/g,  '\\`')
  .replace(/\$\{/g, '\\${');

const out = `/**
 * worker/html.ts — AUTO-GENERATED from public/index.html by
 * scripts/sync-html.mjs. DO NOT EDIT DIRECTLY.
 *
 * Re-run \`node scripts/sync-html.mjs\` after changing public/index.html
 * so the Cloudflare Worker picks up the latest frontend on the next
 * \`wrangler deploy\`.
 *
 * Lines: ${html.split('\n').length}
 * Bytes: ${html.length}
 * Generated: ${new Date().toISOString()}
 */
export const INDEX_HTML = \`${escaped}\`;
`;

writeFileSync(DST, out, 'utf8');

console.log(`sync-html: ${SRC}`);
console.log(`       →  ${DST}`);
console.log(`       ${html.split('\n').length} lines, ${html.length} bytes`);
