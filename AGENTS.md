# AGENTS.md — Deployment & Contribution Guide for openagents.nexus

This file exists to keep future agents (and humans) from shipping stale
builds. Read it before you edit anything under this repo.

The pain this document is designed to prevent:
> I edited `public/index.html`, committed it, pushed to main, refreshed
> the site, and none of my changes showed up. I thought git push was
> broken or Cloudflare was caching. It wasn't — I edited the wrong file.

If that's happening to you, jump to [§1 The Stale-Build Trap](#1-the-stale-build-trap) right now.

---

## 0. 30-Second Summary

| What you want to do | What to run |
|---|---|
| Edit frontend HTML/CSS/JS | Edit `public/index.html` (never `worker/html.ts`) |
| Ship the frontend | `npm run sync-html && git add -A && git commit && git push` |
| Ship the worker code | `git add worker/index.ts && git commit && git push` |
| Verify what's live | Hard-refresh https://openagents.nexus (`Ctrl+Shift+R`) |
| Run a local smoke test | `python3 -m http.server --directory public 8765` |

**Cloudflare auto-deploys on every push to `main`.** There is no GitHub
Actions workflow in this repo — the git↔Workers integration is
configured on the Cloudflare dashboard. Your commit IS the deploy.

---

## 1. The Stale-Build Trap

### What's deployed

The Cloudflare Worker entry point is `worker/index.ts`. On every HTTP
request that isn't an API route, the worker returns this:

```ts
// worker/index.ts
import { INDEX_HTML } from './html.js';
// ...
return new Response(INDEX_HTML, {
  headers: { 'Content-Type': 'text/html; charset=utf-8', /* … */ },
});
```

`INDEX_HTML` comes from `worker/html.ts`, which is a **generated**
TypeScript file that wraps `public/index.html` in a template literal:

```ts
// worker/html.ts  (AUTO-GENERATED — DO NOT EDIT)
export const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
…the entire public/index.html content with every backtick / ${ / \
properly escaped for the template literal…
`;
```

### The trap

`public/index.html` is the **single source of truth**. It's the file
you want to edit. BUT `worker/html.ts` is what actually gets bundled
into the worker and served to users. If you edit `public/index.html`
and forget to regenerate `worker/html.ts`, your changes look committed
in git but **are not deployed**. The live site keeps showing whatever
was in the last synced `worker/html.ts`, and you'll think git is
broken or the CDN is caching.

This already burned us once — 1,569 lines of frontend work sat in
`public/` unseen by production for multiple commits before we noticed.

### The fix

**Always run the sync before committing any change to `public/index.html`:**

```bash
npm run sync-html          # regenerates worker/html.ts from public/index.html
git add public/index.html worker/html.ts
git commit -m "feat(frontend): ..."
git push                   # Cloudflare auto-deploys
```

Or use the convenience script that does all three:

```bash
npm run deploy             # runs sync-html as a predeploy hook, then wrangler deploy
```

If you just run `wrangler deploy` directly, the `predeploy` npm hook
fires and runs sync-html automatically. Same goes for `npm run build`
— `prebuild` is wired to the sync.

### How the sync works

`scripts/sync-html.mjs` reads `public/index.html`, escapes backticks,
`${`, and backslashes so the JavaScript template literal parses
correctly, and writes the result to `worker/html.ts` with an
`AUTO-GENERATED` header. Byte-level round-trip is verified (decoded
`INDEX_HTML` equals the source HTML exactly — 209,666 bytes).

**Do not edit `worker/html.ts` directly.** Your changes will be blown
away the next time anyone runs the sync. If you need to edit it, edit
`public/index.html` and run the sync.

---

## 2. File Layout

```
openagents.nexus/
├── public/
│   └── index.html          ← SOURCE OF TRUTH for the frontend
├── worker/
│   ├── index.ts            ← Cloudflare Worker entry (API + HTML response)
│   └── html.ts             ← AUTO-GENERATED wrapper for INDEX_HTML
├── scripts/
│   └── sync-html.mjs       ← public/index.html → worker/html.ts
├── src/                    ← open-agents-nexus npm library (separate concern)
├── dist/                   ← compiled npm library output (not the worker)
├── wrangler.toml           ← Cloudflare Workers config
└── package.json            ← scripts: sync-html, prebuild, predeploy, deploy
```

Note the dual-purpose nature of this repo:

- **Frontend** (`public/` + `worker/`) → deployed to Cloudflare as the
  `openagentsnexus` worker, serving https://openagents.nexus.
- **npm library** (`src/` → `dist/`) → published to npm as
  `open-agents-nexus` (the P2P client agents embed).

The sync script only touches the frontend. The npm library has its own
`build` / `publish` flow (`npm run build && npm publish`) — don't mix
them up.

---

## 3. Editing Rules

### DO

- Edit `public/index.html` for any frontend change.
- Edit `worker/index.ts` for API routes, headers, CORS, CSP.
- Edit `src/**` for the npm library.
- Run `npm run sync-html` after every frontend change.
- Commit both `public/index.html` AND the regenerated `worker/html.ts`
  in the same commit. Never commit one without the other.
- Hard-refresh (`Ctrl+Shift+R`) after pushing — Cloudflare's edge
  cache is normally ~5 seconds but the browser's own cache is longer.

### DON'T

- **Don't edit `worker/html.ts` directly.** It's auto-generated. Your
  changes will vanish on the next sync.
- **Don't commit `public/index.html` without running sync-html.** If
  you do, production won't see your changes — you'll think deploys
  are broken.
- **Don't commit `dist/` or `*.tsbuildinfo`.** These are build
  artefacts for the npm library and don't belong in git.
- **Don't bypass `wrangler deploy` if you have Cloudflare auth.** Use
  `npm run deploy` so the predeploy sync hook fires.
- **Don't assume `git push` alone is enough.** It is, IF the worker/html.ts
  has already been synced. If not, git push is a no-op for the user.

---

## 4. Verification Checklist

Before pushing any frontend change, run through this list:

```bash
# 1. Sync is current — worker/html.ts bytes match public/index.html
node scripts/sync-html.mjs

# 2. TypeScript still compiles (worker + npm library)
npx tsc --noEmit

# 3. Inline JS in the HTML is valid (parses without error)
python3 -c "
import re
with open('public/index.html') as f: html = f.read()
m = re.search(r'<script type=\"module\">(.*?)</script>', html, re.DOTALL)
open('/tmp/check.mjs','w').write(m.group(1))
" && node --check /tmp/check.mjs

# 4. HTML tag balance (no unclosed <div>s etc.)
python3 -c "
from html.parser import HTMLParser
class Ck(HTMLParser):
  def __init__(s):super().__init__();s.stk=[];s.v={'br','hr','img','input','link','meta','area','base','col','embed','source','track','wbr'}
  def handle_starttag(s,t,a):
    if t not in s.v:s.stk.append(t)
  def handle_endtag(s,t):
    while s.stk and s.stk[-1]!=t:s.stk.pop()
    if s.stk:s.stk.pop()
p=Ck();p.feed(open('public/index.html').read())
print('balanced' if not p.stk else 'UNBALANCED: '+str(p.stk))
"

# 5. Grep for your new symbol inside the worker bundle
grep -c "YourNewFunctionName" worker/html.ts   # should be >= 1

# 6. Commit and push — Cloudflare auto-deploys from main
git add public/index.html worker/html.ts
git commit -m "feat(frontend): ..."
git push
```

All six steps should be green before you walk away.

---

## 5. Local Development

There's no Cloudflare emulator running by default. For rapid iteration
on `public/index.html`:

```bash
python3 -m http.server --directory public 8765
# Open http://127.0.0.1:8765/index.html
```

This serves the file directly — no worker. Good enough for Three.js,
layout, and inline JS iteration. NATS subscriptions and the
`/api/v1/*` endpoints won't work because the worker isn't running.

For full-fidelity local testing (worker + API routes):

```bash
npx wrangler dev
# Runs at http://127.0.0.1:8787 with the real worker behavior
```

`wrangler dev` will still read from `worker/html.ts` so remember to
sync first if you just edited `public/index.html`.

---

## 6. Deploy Flow

Cloudflare's git integration is configured on the Workers dashboard.
Every push to `main` triggers a rebuild and deploy:

```
local machine                     GitHub main           Cloudflare Workers
     │                                 │                        │
     │  npm run sync-html              │                        │
     │──── worker/html.ts updated ─────│                        │
     │                                 │                        │
     │  git commit + git push ─────────▶                        │
     │                                 │  webhook                │
     │                                 │────────────────────────▶│
     │                                 │                        │ build & deploy
     │                                 │                        │
     │                            live at openagents.nexus within ~30s
```

The Cloudflare build step runs:
1. `npm ci`
2. `npm run build` (which triggers `prebuild` → `sync-html.mjs`)
3. `wrangler deploy` (which triggers `predeploy` → `sync-html.mjs` again, belt and suspenders)

So even if a human forgets to run the sync locally, Cloudflare's build
environment will run it before deploying. BUT your committed diff will
still look wrong in PRs / code review because `worker/html.ts` won't
match `public/index.html` in the git tree. **Run the sync locally and
commit both files together.**

---

## 7. Troubleshooting

### "I pushed but the site hasn't updated"

1. Did you run `npm run sync-html`? Check with:
   ```bash
   node scripts/sync-html.mjs
   git diff worker/html.ts
   ```
   If there's a diff, the previous sync was stale. Commit the update.

2. Is Cloudflare's build healthy? Check the deployments tab on the
   Workers dashboard. Build failures can silently keep the previous
   version live.

3. Browser cache. Force reload: `Ctrl+Shift+R` (Windows/Linux),
   `Cmd+Shift+R` (macOS).

4. Edge cache. Usually ~5s. If it's been longer, issue a cache purge
   from the Cloudflare dashboard.

### "npm run sync-html fails"

The script uses only Node built-ins (`node:fs`, `node:path`,
`node:url`). If it fails, the likely cause is:
- Node version too old (`node --version` should be >= 20)
- `public/index.html` missing or empty
- Filesystem permissions on `worker/html.ts`

### "worker/html.ts has merge conflicts"

Because `worker/html.ts` is generated, just regenerate it:

```bash
git checkout --theirs public/index.html   # pick one side
# ... resolve conflicts in public/index.html manually ...
npm run sync-html
git add public/index.html worker/html.ts
```

Never try to resolve conflicts directly inside `worker/html.ts`.

### "I want to add a new feature that needs a new file, not index.html"

Right now the worker only serves `INDEX_HTML` at all non-API routes.
Cloudflare Workers don't have a filesystem, so you can't just drop a
new file into `public/`. Options:

- Inline the asset into `public/index.html` as a data: URL
- Add a new route handler in `worker/index.ts` that returns the
  asset as a `Response` with the right content-type
- Move to Cloudflare Pages and use the static file serving

Talk to the maintainer before choosing one — this repo is
deliberately single-file for now.

---

## 8. Commit & PR Conventions

- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`,
  `docs:`) scoped by area (`feat(frontend): ...`, `fix(worker): ...`).
- Don't add co-author attribution trailers.
- Every frontend-touching commit must include BOTH `public/index.html`
  and `worker/html.ts` (from the sync). If a reviewer sees a diff on
  one without the other, block the PR.
- Don't amend already-pushed commits — create new ones.

---

## 9. Related Files

- `wrangler.toml` — worker name, main entry, KV bindings
- `worker/index.ts` — API routes, CORS, CSP headers, HTML response
- `worker/html.ts` — **auto-generated, do not edit**
- `scripts/sync-html.mjs` — the sync tool
- `package.json` — npm scripts (`sync-html`, `prebuild`, `predeploy`, `deploy`)

---

## 10. Last Updated

This document captures the deploy model as of April 2026. If the
deploy flow changes (e.g. moving to Pages, introducing a real build
step, switching off git integration), update this file in the same
commit as the change.
