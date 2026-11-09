# jobleads-cli

CLI for searching **www.jobleads.com/us** — an international freemium job-search
aggregator's US region.

**Data source**: server-rendered (Vue/Nuxt SSR) HTML at `/us/jobs`, `/us/jobs/q/<query>`,
`/us/jobs/l/<location>`, and `/us/jobs/q/<query>/l/<location>` for search; `/us/job/<slug>--<id>`
for individual postings.
**Authentication**: None required for search or individual postings.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev
type defs.

> **Personal use only.** JobLeads' own Terms of Use prohibit using "mechanisms, software or
> scripts" on the platform and copying content "through the use of robot/crawler search
> engine technologies." Keep volume low, don't use this commercially or for bulk data
> collection, and run it on your own responsibility. See `../SKILL.md` for the full quote.

## A note on `detail` and Cloudflare

Individual job pages sit behind Cloudflare bot-management. During investigation, `curl`
requests to `/us/job/<slug>--<id>` were consistently blocked with a Turnstile JS challenge
(HTTP 403), regardless of `User-Agent` string. Bun's own `fetch`, using the exact same
honest, self-identifying UA and nothing else, was **not** challenged — verified across many
distinct live postings. This tool does nothing to engineer that (no browser automation, no
challenge-solving, no UA spoofing beyond the one honest string below) — it is Cloudflare's
own scoring of the requesting client. Because that scoring is Cloudflare's and could change,
`detail` still detects and cleanly reports a 403 challenge (`DETAIL_BLOCKED`) instead of
assuming success. See `../url-reference.md` for the full investigation trail.

The description `detail` returns is whatever the server renders inline for the "Job
description" panel — on every posting seen during development this was a preview
(~1500 characters, ending mid-sentence) behind a client-side "Show more" control. It's real
text lifted straight from the page, just not guaranteed to be the complete posting.

## Installation

```bash
cd .agents/skills/jobleads-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search live US postings by keyword and/or location |
| `detail` | Fetch a single posting's fields (may be a preview description — see above) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Business development roles near Austin, TX (radius-matched, not exact-city)
bun run src/cli.ts search -q "business development" -l "Austin TX" --format table

# VP-level roles, remote
bun run src/cli.ts search -q "VP business development" -l "Remote" --format table

# Posted within the last 7 days
bun run src/cli.ts search -q "director" -l "Denver CO" --jobage 7 --format table

# Browse the whole US region, no keyword
bun run src/cli.ts search -l "Austin TX" --format table

# Full detail for one posting (prefer the full url from a search result)
bun run src/cli.ts detail "https://www.jobleads.com/us/job/business-development-director--denver--e40c098bc5f9d671b4c65b64530d9c0ba" --format plain
```

See `../SKILL.md` for the full flag reference and the Terms-of-Use note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (job title, skill). Maps to JobLeads' `/q/<query>` path segment. Omit to browse everything. |
| `--location` | `-l` | City/state or "Remote". Maps to JobLeads' `/l/<location>` path segment — a geo-radius match, not exact-string. |
| `--jobage` | | Posted within N days (client-side — see Notes in SKILL.md; precision capped at 14 days). |
| `--page` | | 1-indexed page over JobLeads' own server-side pagination. |
| `--limit` | `-n` | Cap results returned (client-side, max 25 — JobLeads' own page size). |
| `--format` | | `json` \| `table` \| `plain`. |
