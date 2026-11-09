---
name: greenhouse-search
version: 1.0.0
description: >
  Use this skill to search live job listings on any company's Greenhouse
  applicant-tracking-system (ATS) job board, or to look up a specific posting,
  via Greenhouse's public boards-api.greenhouse.io Job Board API. Greenhouse
  hosts thousands of companies' career sites (job-boards.greenhouse.io/<slug>),
  so this is a company career-page search, not one portal — every call names
  the company. Trigger phrases: Anthropic jobs, Greenhouse job board, search a
  company's Greenhouse postings, company career page search, "are there any
  <role> jobs at <company>", look up this Greenhouse job posting, find openings
  at <company> (when <company> uses Greenhouse).
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/greenhouse-search/cli/src/cli.ts *)
---

# Greenhouse Search Skill

Search live job listings on **any company's Greenhouse job board**, via
Greenhouse's public Job Board API (`boards-api.greenhouse.io`). No
authentication, no API key, and **zero runtime dependencies** — it runs with
just `bun`.

> This is a worked example of the repo's job-portal-skill pattern, closest in
> shape to `freehire-search` (a genuine public JSON API, not HTML scraping).
> It differs from every other shipped portal skill in one respect:
> **Greenhouse is multi-tenant.** Freehire is one aggregator and LinkedIn is
> one site; Greenhouse hosts thousands of independent companies' boards behind
> one API, so `--company <slug>` (or `-c`) is **required** on every command —
> there is no default board, and the skill works for any company on
> Greenhouse, not just one.

## Finding a company's slug

The slug is the path segment in the company's public careers URL:
`https://job-boards.greenhouse.io/<slug>`. If you have a company name but not
the URL, a web search for `"<company> careers greenhouse"` or `site:job-boards.greenhouse.io <company>`
usually finds it. Not every company uses Greenhouse — an unknown/misspelled
slug returns a clear `UNKNOWN_COMPANY` error, never a silent empty result.

## When to use this skill

- Search a specific company's open roles by keyword (title-based; see the
  Notes below on why this is client-side)
- Filter a company's board by posting recency (`--jobage`)
- Get the full description, departments, and offices for one posting

## ℹ️ Public API, no restrictions found

`robots.txt` on `boards-api.greenhouse.io` only disallows `/embed/` — the
`/v1/boards/*` paths this skill uses are unrestricted, and no login or API key
is required. This is a genuine public API, not scraping, so (unlike
`linkedin-search`) there is no personal-use-only warning here. The one caveat:
**per-company data availability and completeness is Greenhouse's own
choice** — some companies gate parts of their board differently, set custom
`metadata` fields with no shared vocabulary, or leave fields like
`location_type` unset. See `url-reference.md` for what was verified live
across 11 companies.

## Commands

### Search a company's job listings

```bash
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --company <slug> [-q "<keywords>"] [flags]
```

Query syntax: plain case-insensitive substring match against the title (and description when `--with-description` is set), applied **client-side** — Greenhouse's own `q=` parameter has no server-side effect (confirmed live). No quoting, OR, or exclusion syntax; the whole query string must appear as a contiguous substring.

Key flags:
- `--company <slug>` / `-c <slug>` — **required.** The Greenhouse board slug, e.g. `anthropic`, `stripe`.
- `--query <text>` / `-q <text>` — keyword filter on job **title** (and description when `--with-description` is set). **Client-side**: Greenhouse's API has no documented server-side keyword search, and live testing confirmed an undocumented `q=` param is silently ignored (the full board comes back regardless) — see `url-reference.md`.
- `--jobage <days>` — posted within N days, filtered **client-side** on `first_published` (not `updated_at` — see url-reference.md for why: `updated_at` bumps on any edit, not just a new posting). No server-side equivalent exists.
- `--page <n>` — 1-indexed page over the filtered result list. **Client-side**: live testing confirmed a `page=` param is silently ignored — Greenhouse always returns a company's entire open-job list in one response, so `--page` slices what this CLI already fetched, rather than requesting a page from the API.
- `--limit <n>` / `-n <n>` — results per page (client-side cap). Default 25.
- `--format json|table|plain` — default `json`.
- `--with-description` — fetch every job's full posting text in the same list request (`content=true`) and let `--query` also match it. Off by default — for a large board (Stripe has 615 open postings) the full text of every one is a heavy payload for a discovery pass. Prefer `detail` to read one posting's full text.

There is no `--location` flag: Greenhouse's `location.name` is free text (and
sometimes several locations joined with `;` or `|` — see url-reference.md), not
a filterable parameter, and this skill's `--query` intentionally only matches
title/description per its contract, not location. Scan the `location` column
in `--format table` output, or `--format json` and filter downstream.

### Fetch full job detail

```bash
bun run .agents/skills/greenhouse-search/cli/src/cli.ts detail <id> --company <slug> [--format json|plain]
```

`<id>` is the numeric Greenhouse job id from a search result's `id` field (or
a full `.../jobs/<id>` URL). `--company` is required here too — Greenhouse job
ids are unique only *within* a company's board, and the request URL is scoped
by company. Returns the full (HTML-stripped, entity-decoded) description,
departments, offices, and the raw per-company `metadata` map.

## Usage examples

```bash
# Anthropic postings mentioning "partnerships", table view
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --company anthropic -q "partnerships" --limit 5 --format table

# Stripe roles posted in the last 14 days
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --company stripe --jobage 14 --format table

# Figma design roles (title match), plain view
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --company figma -q "design" --format plain

# Full detail for a specific job
bun run .agents/skills/greenhouse-search/cli/src/cli.ts detail 4461450008 --company anthropic --format plain

# Discovery pass with full description text included, for a small board
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --company airtable --with-description -q "engineer" --format json
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use; `--with-description` puts the description here |
| `table` | Quick human-readable scanning (id, title, location, location type, posted date) |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total" }, "results": [...] }`;
each result carries at least `id`, `title`, `company`, `location`, `date`,
`url`, plus `updated_at`, `location_type`, `requisition_id`, and `description`
(missing values are `null`, never omitted; `description` is `null` unless
`--with-description` was passed). `table` and `plain` omit the description —
it would swamp a scannable list. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from Greenhouse's public Job Board API — no credentials required.
- `id` in search results is the numeric Greenhouse job id — pass it as-is to `detail`.
- `date` is `first_published` (the posting's original publish date); it is
  `null` for the rare job missing it. `updated_at` is also carried on each
  result for callers who want edit-recency instead.
- `location_type` (On-Site/Remote/Hybrid) comes from a company-set `metadata`
  field named `Location Type` and is `null` whenever a company doesn't set it
  — most of the 11 companies checked during development didn't. Don't treat a
  `null` as "not remote"; treat it as "not disclosed here."
- `--query`, `--jobage`, and `--page` are all client-side filters/slicing over
  one fetched board (see `url-reference.md` for the live tests confirming
  Greenhouse has no server-side equivalents) — none of these flags are faked
  or silently dropped, they just don't reach the network as a parameter.
- The API retries 429/5xx with exponential backoff; an unreachable API exits
  non-zero with a clear message.
- An unknown company slug is reported as `UNKNOWN_COMPANY`, never as an empty
  result set, and a job id that doesn't exist under the given company is
  `NOT_FOUND` (including an id that's valid under a *different* company).
