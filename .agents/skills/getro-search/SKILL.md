---
name: getro-search
version: 1.0.0
description: >
  Use this skill to search live job listings on a Getro-platform VC-portfolio job board —
  the "jobs at our portfolio companies" boards many venture firms and communities run at
  their own jobs.<org>.com subdomain (e.g. jobs.menlovc.com for Menlo Ventures, jobs.accel.com
  for Accel, jobs.alleycorp.com for AlleyCorp). NOTE: jobs.a16z.com (including its Bio +
  Health portfolio) is NOT covered by this skill despite the similar naming — it runs a
  different, custom platform, not Getro; see the "Verified boards" section below before
  reaching for this skill on a16z. Works for any genuine Getro board via --board, so one
  skill covers many VC firms' portfolio hiring out of the box. Trigger phrases: VC portfolio
  jobs, jobs at <VC firm>'s portfolio companies, Getro job board, "find jobs at
  <firm>'s portfolio", startup jobs from <VC>, life sciences / Bio + Health portfolio jobs
  (when the board in question is a verified Getro board, not a16z), look up this Getro job
  posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/getro-search/cli/src/cli.ts *)
---

# Getro Search Skill

Search live job listings on any **Getro-platform** VC-portfolio job board — Getro is a
white-label SaaS that powers many VC firms' and communities' "jobs at our portfolio
companies" boards, each hosted at the org's own `jobs.<org>.com` subdomain. No
authentication, no API key, and **zero runtime dependencies** — it runs with just `bun`. The
board is chosen per query via the required `--board` flag, so the same skill works for any
genuine Getro-hosted board.

> This is a country/market-agnostic worked example of the repo's job-portal-skill pattern,
> like `freehire-search`. Unlike the HTML-card-scraping portals, it reads a structured JSON
> snapshot each Getro board's own server embeds in its page (`__NEXT_DATA__`) rather than
> parsing rendered markup — see `url-reference.md` for exactly how.

## ⚠️ Not every "jobs.<vc>.com" board is Getro — read this first

This skill was built to also cover `jobs.a16z.com` and `jobs.psychedelicalpha.com`, per the
similar-looking pattern of many VC portfolio-jobs boards. **Investigation found neither of
those two actually runs the Getro platform** — they only share a superficially similar
`robots.txt` shape and URL convention with real Getro boards. Pointing `--board` at a
non-Getro host fails loudly (`SEARCH_FAILED` — "could not find the `__NEXT_DATA__`
payload") rather than silently returning wrong data, but it's worth knowing up front:

### Verified Getro boards (this skill works on these)

| Board | Firm | How verified |
|-------|------|---------------|
| `jobs.menlovc.com` | Menlo Ventures | `x-powered-by: Getro` header, "Powered by Getro" footer link, live search + detail tested end-to-end |
| `jobs.accel.com` | Accel | Same platform markers; live search + detail tested end-to-end |
| `jobs.alleycorp.com` | AlleyCorp | `x-powered-by: Getro` header confirmed (not deep-tested beyond that) |
| `jobs.technyc.org` | Tech:NYC | `x-powered-by: Getro` header confirmed (not deep-tested beyond that) |
| `jobs.dukecapitalpartners.duke.edu` | Duke Capital Partners | `x-powered-by: Getro` header confirmed (not deep-tested beyond that) |

### NOT Getro — do not point `--board` at these

| Board | What it actually is |
|-------|----------------------|
| `jobs.a16z.com` (Andreessen Horowitz, incl. its Bio + Health portfolio) | A custom-built Next.js app (internal cache tag `frontier-jobs-a16z`), not the Getro SaaS. Different markup, no `__NEXT_DATA__`, and its search page ignores query-string filters entirely (always renders the same generic list). Would need its own dedicated portal skill. |
| `jobs.psychedelicalpha.com` | Runs **Niceboard**, an entirely different job-board product (category-based, not portfolio-company-based; `/employer/login`, `/seeker/login`, `cdn.niceboard.co`). `jobs.psychedelicalpha.com/jobs` doesn't even resolve. |
| `jobs.lsvp.com` (Lightspeed) | A third, distinct custom app (session-cookie/AWS-ALB based), also not Getro. |

If you want boards outside the "Verified" table, check first with `curl -sI
https://jobs.<org>.com/jobs \| grep -i x-powered-by` (expect `Getro`) before trusting this
skill's results there — see `url-reference.md`'s "headline finding" section for the full
story of how this was discovered.

## ⚠️ Personal use only

`robots.txt` on every verified board is fully open, but **Getro's own Terms of Service**
(`getro.com/terms`) explicitly prohibit "crawling," "scraping," or "spidering" any page or
data of the Services (which covers every client board it hosts), through manual or automated
means. This mirrors `linkedin-search`'s situation exactly: **keep volume low, don't use this
commercially or for bulk data collection, and run it on your own responsibility.**

## When to use this skill

- Search a specific VC firm's or community's Getro-hosted portfolio-jobs board by keyword,
  location, seniority, or remote/on-site — after confirming it's a verified (or
  independently confirmed) Getro board, not a16z or Psychedelic Alpha
- Look up the full description of one posting by its numeric id

## Commands

### Search job listings

```bash
bun run .agents/skills/getro-search/cli/src/cli.ts search --board <hostname> [-q "<keywords>"] [flags]
```

Query syntax: passed verbatim as `q` to Getro's own server-side search (confirmed to filter server-side for plain keywords); phrase quoting, OR, and exclusion syntax not tested.

Key flags:
- `--board <hostname>` / `-b` — **required.** The Getro board's hostname, e.g.
  `jobs.menlovc.com` — see the verified-boards table above.
- `--query <text>` / `-q <text>` — keyword search (title, company, skill). Optional but
  recommended; confirmed to filter server-side.
- `--location <text>` / `-l <text>` — free-text location, e.g. `"San Francisco, CA, USA"`.
  **This is one place string, not a comma-separated list** — the comma is part of the place
  name. Separate multiple places with `;` instead of `,`. Confirmed working server-side.
- `--seniority <levels>` — comma-separated, e.g. `senior,mid_senior`. Observed values:
  `entry_level`, `associate`, `mid_senior`, `senior`, `internship` (not confirmed exhaustive).
  Confirmed working server-side.
- `--remote <mode>` — `remote` or `onsite` (confirmed working); `hybrid` is accepted but
  matched zero live postings in testing — may just mean none exist right now.
- `--jobage <days>` — posted within N days. **Client-side only**: Getro's board pages have
  no date facet in the URL, and (see below) only the first ~20 matches for a query are
  reachable at all without hitting a disallowed endpoint, so this filters within that
  already-fetched batch rather than doing a full re-query. Still useful for "what's new
  today" on a narrow `--query`.
- `--page <n>` — must be `1` (the default). See "Why there's no real pagination" below.
- `--limit <n>` / `-n <n>` — client-side cap on results emitted.
- `--format json|table|plain` — default `json`.
- `--facet <key=value>` — escape hatch merging arbitrary key/value(s) into Getro's filter
  param (repeatable, comma-splits the value into an array). **Unverified** beyond
  `--location`/`--seniority`/`--remote` above — an unrecognized key or value returns zero
  results rather than an error, so a typo fails silently at the data level. See
  `url-reference.md`'s "Facet keys tried and found NOT to work" before guessing new ones.

### Why there's no real pagination (`--page` only accepts `1`)

Every genuine Getro board's own client-side search box calls a shared, cross-origin API at
`api.getro.com` to fetch more than the first page and to do full-text ranking. That host's
`robots.txt` is `Disallow: /` for every user agent — a full disallow, on the whole host. This
skill never requests it, on any board, regardless of what that board's *own* `robots.txt`
permits. The practical effect: `search` sees only the same first ~20 matches the board's own
SSR page renders for a given query+filter, and `--page 2` and beyond errors out
(`PAGE_UNSUPPORTED`) instead of silently returning duplicates under a misleading page label.
Narrow the `--query`/`--location`/`--seniority`/`--remote` combination to get a useful ~20
rather than expecting to page through thousands.

### Fetch full job detail

```bash
bun run .agents/skills/getro-search/cli/src/cli.ts detail <id|url> --board <hostname> [--format json|plain]
```

`id` is the numeric `id` from a `search` result (e.g. `92787641`). You may also pass a full
`https://<board>/companies/<slug>/jobs/<id>-<slug>` URL, in which case `--board` is inferred
from it. Returns the full (HTML-stripped) description, status (active/closed), job
function(s), employment type(s), and compensation when public.

## Usage examples

```bash
# Business development roles at Menlo's portfolio companies
bun run .agents/skills/getro-search/cli/src/cli.ts search --board jobs.menlovc.com -q "business development" --limit 5 --format table

# Senior remote engineering roles at Accel's portfolio companies
bun run .agents/skills/getro-search/cli/src/cli.ts search --board jobs.accel.com -q "engineer" --seniority senior --remote remote --format table

# Product roles in a specific city
bun run .agents/skills/getro-search/cli/src/cli.ts search --board jobs.menlovc.com -q "product manager" -l "San Francisco, CA, USA" --format table

# What's new today, narrowly scoped
bun run .agents/skills/getro-search/cli/src/cli.ts search --board jobs.menlovc.com -q "clinical" --jobage 1 --format table

# Full details for a specific posting
bun run .agents/skills/getro-search/cli/src/cli.ts detail 92787641 --board jobs.menlovc.com --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "totalOnBoard" }, "results": [...] }`; each
result carries at least `id`, `title`, `company`, `location`, `date`, `url` (missing values
are `null`, never omitted), plus a permitted superset (`company_slug`, `work_mode`,
`seniority`, `skills`, `salary`). `description` is always `null` on search results — Getro's
search page doesn't include it; fetch `detail` for the full text. All errors are written to
**stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Bio + Health / life-sciences filtering:** no board-wide industry facet was found to work
  server-side (see `url-reference.md`). Each result's `skills` array and the company's own
  domain are the practical signal today — scan `--format json` output, or narrow `--query`
  to biotech/life-sciences terms. This is a real limitation, not an oversight; a future
  maintainer with more time may find the real facet key.
- `id` in search results is the Getro numeric job id — pass it as-is to `detail`. The
  company/title slug segments in a Getro detail URL are purely decorative (verified live: a
  wrong company slug still resolves the right job by id), so `detail` builds its own
  placeholder-slug URL and needs only the id.
- `date` on search results is the posting's `createdAt` (epoch seconds, converted to ISO
  8601); `date` on `detail` is `postedAt` (already ISO 8601 on that page — a real, if minor,
  shape difference between the two pages, not a bug).
- Fetch retries 429/5xx with exponential backoff (max 6 retries) and a 15s timeout; a 404
  maps to a clear `NOT_FOUND`/`BOARD_NOT_FOUND` error rather than a crash.
