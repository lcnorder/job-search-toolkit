---
name: consider-search
version: 1.0.0
description: >
  Use this skill to search live job listings on a Consider-platform VC-portfolio job board —
  the "jobs at our portfolio companies" boards many venture firms run at their own
  careers.<org>.com subdomain (e.g. careers.foresitecapital.com for Foresite Capital). Consider
  is a white-label SaaS (product.consider.com) similar in purpose to Getro but a completely
  different platform under the hood — other confirmed users include Costanoa Ventures,
  OneRagtime, Radian Capital, and SET Ventures (jobs.airtree.vc/AirTree Ventures was checked
  and found to run Getro instead, NOT Consider — see the "NOT Consider" table below; use
  getro-search for it). Works for any genuine Consider board via --board. Trigger phrases: VC
  portfolio jobs, jobs at <VC firm>'s portfolio companies, Consider job board, "find jobs at
  <firm>'s portfolio", startup jobs from <VC>, biotech / life-sciences portfolio jobs (when
  the board is a verified Consider board), look up this Consider job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/consider-search/cli/src/cli.ts *)
---

# Consider Search Skill

Search live job listings on any **Consider-platform** VC-portfolio job board — Consider is a
white-label SaaS that powers many VC firms' "jobs at our portfolio companies" boards, each
hosted at the firm's own `careers.<org>.com` subdomain. No authentication, no API key, and
**zero runtime dependencies** — it runs with just `bun`. The board is chosen per query via the
required `--board` flag, so the same skill works for any genuine Consider-hosted board.

> This is a country/market-agnostic worked example of the repo's job-portal-skill pattern,
> like `getro-search`. Unlike Getro, a Consider board's SSR page carries **no** job data at
> all in its HTML (just a loading spinner) — the real data comes from a same-origin JSON API
> the page's own client-side JS calls after load. This skill reproduces that same handshake:
> fetch the page once to mint a session (CSRF token + cookies), then POST the search. See
> `url-reference.md` for the full mechanics.

## ⚠️ Verify the platform before trusting `--board` on a new host

This skill was built after `jobs.a16z.com`, `jobs.psychedelicalpha.com`, and `jobs.lsvp.com`
all turned out **not** to be Getro despite a similar `jobs.<vc>.com` naming pattern (see
`getro-search/SKILL.md`) — the same caution applies here. A `careers.<org>.com` or
`jobs.<org>.com` VC portfolio board could be running Consider, Getro, a bespoke app, or
something else entirely. **Never assume from the hostname or `robots.txt` shape alone.**
Before pointing `--board` at a new host, confirm it is genuinely Consider:

```bash
curl -s -A "Mozilla/5.0 (compatible; check/1.0)" https://<host>/jobs | grep -o 'window.serverInitialData' 
curl -s -A "Mozilla/5.0 (compatible; check/1.0)" https://<host>/jobs | grep -io 'Powered by Consider'
```

Expect to see both. If neither appears, this skill does not support that board — pointing
`--board` at it fails loudly (`SEARCH_FAILED` — "could not find window.serverInitialData")
rather than silently returning wrong data, but it's worth checking first.

### Verified Consider boards (this skill works on these)

| Board | Firm | How verified |
|-------|------|---------------|
| `careers.foresitecapital.com` | Foresite Capital | `window.serverInitialData` present, "Powered by Consider" footer link to `product.consider.com`, live search + detail tested end-to-end (793 jobs / 71 companies on the board at verification time) |
| `jobs.costanoavc.com` | Costanoa Ventures | `window.serverInitialData` present, "Powered by Consider" footer link confirmed live 2026-09-10; live search + detail tested end-to-end (725 jobs on the board at verification time) — this is the board this skill's multi-tenant `--board` parametrization was regression-tested against, alongside Foresite |
| `careers.oneragtime.com` | OneRagtime | `window.serverInitialData` + "Powered by Consider" footer confirmed live 2026-09-10; live `search` returned real results (not deep-tested beyond that) |
| `careers.setventures.com` | SET Ventures | Same signature confirmed live 2026-09-10; live `search` returned real results (not deep-tested beyond that) |
| `careers.radiancapital.com` | Radian Capital | Same signature confirmed live 2026-09-10; live `search` returned real results (not deep-tested beyond that) |

Of the five candidate boards this skill was asked to check (a web-search-only list, not
independently verified until now), four turned out to genuinely be Consider. The one that
did not:

### NOT Consider — do not point `--board` at this

| Board | What it actually is |
|-------|----------------------|
| `jobs.airtree.vc` (AirTree Ventures) | Runs **Getro** (`x-powered-by: Getro` response header, confirmed live 2026-09-10) — a different white-label VC-portfolio job board SaaS. This is the exact same "same naming pattern, different platform" trap documented in `getro-search/SKILL.md` for `jobs.a16z.com`, just in the opposite direction: a `jobs.<org>.vc` host that looks like it could be either platform and turns out to be the *other* one. Use `getro-search --board jobs.airtree.vc` instead. |

**Takeaway:** never trust a web-search report, or a `careers.<vc>.com`/`jobs.<vc>.com` naming
pattern, as proof of platform — confirm independently every time with the check below before
pointing `--board` at a new host.

## ⚠️ Personal use only

`robots.txt` is identical (`Allow: /` for every user agent except `LinkedInBot`, which gets
`Disallow: /` — presumably to keep LinkedIn from re-indexing/scraping the board directly) on
every verified board checked so far (`careers.foresitecapital.com`, `jobs.costanoavc.com`,
`careers.oneragtime.com`, `careers.setventures.com`, `careers.radiancapital.com`) — expected,
since Consider's own infrastructure serves this file identically to every client board it
hosts. It does **not** disallow the `/api-boards/` paths this skill uses, on any of them.
However, Consider's own Terms of Service (`https://consider.com/legal/terms`, fetched and read
in full) explicitly prohibit, under Acceptable Use:

> use any robot, spider, scraper, or other automated means to access the Service for any
> purpose without our express written permission

This is **one ToS covering every Consider-hosted board**, not a per-board policy — so
parametrizing `--board` widens how many boards this restriction applies to, it doesn't change
the restriction itself. This mirrors `getro-search`'s and `linkedin-search`'s situation exactly:
**robots.txt permits
automated fetches, but the Terms of Service prohibit them outright. Keep volume low, don't use
this commercially or for bulk data collection, and run it on your own responsibility.**

## When to use this skill

- Search a specific VC firm's Consider-hosted portfolio-jobs board by keyword, location,
  department, or remote — after confirming it's a verified (or independently confirmed)
  Consider board
- Look up whatever additional detail Consider itself can provide for one posting (see the
  limitation below — usually the search result's own `url` field is the real destination)

## Commands

### Search job listings

```bash
bun run .agents/skills/consider-search/cli/src/cli.ts search --board <hostname> [-q "<keywords>"] [flags]
```

Query syntax: passed verbatim as `keywords` to Consider's own server-side relevance ranking (see below — it re-ranks, not filters); phrase quoting, OR, and exclusion syntax not tested.

Key flags:
- `--board <hostname>` / `-b` — **required.** The Consider board's hostname, e.g.
  `careers.foresitecapital.com`.
- `--query <text>` / `-q <text>` — keyword search. **Re-ranks rather than filters**: adding
  `-q` does not reduce the board's total job count (confirmed live — see
  `url-reference.md`'s "Keyword search is ranking, not filtering" section) — it re-orders the
  full result set by relevance. Still useful (the top results genuinely are the best keyword
  matches), just don't read `meta.totalOnBoard` as a match count when `-q` is set.
- `--location <text>` / `-l <text>` — free-text location as it appears in a job's own
  `locations` field, e.g. `"San Francisco, California"`. Loose/fuzzy match, confirmed working
  server-side — but a bare city name alone (`"San Francisco"` without the state) matched
  **zero** jobs in testing, so use the fuller normalized string. Separate multiple places with
  `;`, not `,`.
- `--department <text>` — comma-separated department name(s) as Consider labels them, e.g.
  `Finance,Engineering`. Confirmed working server-side (exact label match).
- `--remote` — boolean flag; only remote-eligible postings. Confirmed working server-side.
  There's no separate on-site/hybrid value to request — omit the flag to see everything.
- `--jobage <days>` — posted within N days, maps to Consider's own `postedSince` facet.
  Confirmed working **server-side** (unlike Getro's client-side-only equivalent).
- `--page <n>` — 1-indexed. Consider paginates with an opaque cursor
  (`meta.sequence`), not a numeric offset — reaching page N costs N-1 extra round trips
  within one CLI invocation. Keep N small to respect the personal-use-only posture above.
- `--limit <n>` / `-n <n>` — client-side cap on results emitted.
- `--format json|table|plain` — default `json`.
- `--facet <key=value>` — escape hatch merging arbitrary key/value(s) into the query body.
  **Seniority filtering was tried and NOT found to work** under several guessed key names
  (`seniority`, `jobSeniorities`, `seniorityIds`, `jobSeniorityIds` all left the result set
  unfiltered) — see `url-reference.md`'s "Facet keys tried and found NOT to work" before
  re-guessing. A wrong key/value is silently ignored, not rejected.

### Fetch job detail

```bash
bun run .agents/skills/consider-search/cli/src/cli.ts detail <id> --board <hostname> [--format json|plain]
```

`<id>` must be the `id` field **exactly as returned by a search result** — it's an opaque
compound value (`<companySlug>::<jobId>`), because Consider's own detail lookup needs both
pieces and there is no single natural job id in the wire format (see `url-reference.md`).

#### Why `detail` often can't fetch a description

Consider's `/api-boards/jobs/<id>` endpoint only returns data for jobs Consider hosts
**directly** (`considerHosted: true`). On `careers.foresitecapital.com`, **0 of the first 50
sampled jobs were Consider-hosted** — every one routed straight to the company's own external
ATS (Lever, Greenhouse, CareerPuck, and others were observed). For those (the large majority),
`detail` returns a clean `NOT_HOSTED_BY_CONSIDER` error rather than a fabricated or empty
description — the real posting text lives at the job's own application page, which `search`
already returns as the result's `url` field. This is a genuine platform limitation, not a bug
in this CLI or a sign the board isn't really Consider.

## Usage examples

```bash
# Business development roles at Foresite's portfolio companies
bun run .agents/skills/consider-search/cli/src/cli.ts search --board careers.foresitecapital.com -q "business development" --limit 5 --format table

# Finance department openings
bun run .agents/skills/consider-search/cli/src/cli.ts search --board careers.foresitecapital.com --department Finance --format table

# Remote roles posted in the last week
bun run .agents/skills/consider-search/cli/src/cli.ts search --board careers.foresitecapital.com --remote --jobage 7 --format table

# Full detail for a specific posting (works only if Consider hosts it directly - see above)
bun run .agents/skills/consider-search/cli/src/cli.ts detail "delfi-diagnostics::dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e" --board careers.foresitecapital.com --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "totalOnBoard" }, "results": [...] }`; each result
carries at least `id`, `title`, `company`, `location`, `date`, `url` (missing values are
`null`, never omitted), plus a permitted superset (`company_slug`, `work_mode`, `seniority`,
`skills`, `salary` — Consider's search results are noticeably richer than Getro's here,
routinely including real salary ranges). `description` is always `null` on search results —
see the `detail` limitation above. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Consider's SSR page embeds **no job data at all** — just `window.serverInitialData` (a CSRF
  token and the board's internal id) plus a loading spinner. Every `search`/`detail` call
  fetches the page once to mint a fresh session, then POSTs/GETs the actual API — see
  `url-reference.md` for the full handshake and why it's necessary (a stale or mismatched
  CSRF token/cookie pair is rejected with `INVALID_CSRF`).
- **The session/CSRF handshake was tested cross-board and found to be platform-wide, not
  board-specific**: a session (cookies + CSRF token) minted against one board's `/jobs` page
  is accepted by every other board's `/api-boards/search-jobs` endpoint — which board's data
  comes back is selected entirely by the `board.id` value in the POST body, not by which
  session you present or which board's hostname you send the request to (confirmed live by
  deliberately mixing a Foresite-minted session with Costanoa's `board.id` and vice versa —
  see `url-reference.md`'s "Session handshake is shared, not per-board" section). This doesn't
  change correctness here — `fetchSession(board)` always fetches a fresh session **and** that
  same board's own `board.id` together, per invocation, so `search`/`detail` always query the
  board they were asked for — but it means the CSRF token is best understood as a general
  anti-automation gate for the whole Consider platform, not proof of which board a request is
  scoped to.
- `date` on search results is Consider's own `timeStamp` field, already ISO 8601.
- `work_mode` is derived client-side from the job's own `remote`/`hybrid` booleans (`"remote"`,
  `"hybrid"`, or `"on_site"`); Consider does not expose a separate facet value distinguishing
  hybrid from on-site in search filtering (only `remoteOnly` is confirmed to filter).
- Fetch retries 429/5xx with exponential backoff (max 6 retries) and a 15s timeout per request;
  a 404 on the board's `/jobs` page maps to `BOARD_NOT_FOUND` rather than a crash.
