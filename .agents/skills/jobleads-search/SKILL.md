---
name: jobleads-search
version: 1.0.0
description: >
  Use this skill to search live US job listings on www.jobleads.com/us, a general
  job-search aggregator covering roles across every sector and level (business development,
  CMC/manufacturing/pharma, executive, technical, and everything between). No authentication,
  no API key, zero runtime dependencies — it runs with just bun. Trigger phrases: JobLeads,
  jobleads.com, US job search, general job aggregator, find a job, job search, search for
  jobs, job openings, vacancies, hiring, positions open, remote jobs, "are there any X jobs
  in <US city>", look up this JobLeads job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobleads-search/cli/src/cli.ts *)
---

# JobLeads (US) Search Skill

Search live job listings on **www.jobleads.com/us**, the US region of JobLeads — an
international freemium job-search aggregator. No authentication, no API key, and **zero
runtime dependencies** — it runs with just `bun`.

> This is a single-portal, single-region skill (like `linkedin-search`/`jobindex-search`,
> not `getro-search`'s multi-board `--board` pattern) — `/us` is the only region this skill
> covers, per the task that generated it. JobLeads has 25+ other country roots off the same
> domain if a future skill wants to cover one.

## ⚠️ Terms of Use — read before running this at any real volume

JobLeads' own Terms of Use (`/terms-of-use`, read in full during investigation) contain an
explicit, broad restriction on automated access:

> "The User is not permitted to use mechanisms, software or scripts in connection with the
> use of the JobLeads platform, as well as blocking, overwriting, modification, copying,
> especially copying through the use of robot/crawler search engine technologies."

This is a broad "no scripts, no robot/crawler tools" clause — comparable to `linkedin-search`'s
and `getro-search`'s ToS restrictions in this same repo. **Keep volume low, use this for your
own personal job search only — never commercially or for bulk data collection — and run it
at your own responsibility.** `robots.txt` itself does not disallow the search or detail
paths this skill uses (only account/campaign pages and `/api/` are blocked, and this CLI
never touches those), but that does not override the Terms of Use restriction above — see
`url-reference.md` for the full investigation.

## ⚠️ `detail`'s description may be a preview, not the full posting

Every posting fetched during development rendered its description as a ~1500-character
preview ending mid-sentence, behind a client-side "Show more" control this CLI does not
execute. `detail`'s `description` field is real, honest text lifted directly from the
page — never fabricated — just not guaranteed to be the complete text. See
`url-reference.md` for what was actually observed.

## When to use this skill

- Search JobLeads' US listings by keyword and/or location — any sector, any level
- Filter by posting age (approximate — see Notes)
- Get a posting's fields — title, company, location, work setting, salary, employment
  type, and a description (see the preview warning above)

## Commands

### Search job listings

```bash
bun run .agents/skills/jobleads-search/cli/src/cli.ts search [-q "<keywords>"] [-l "<location>"] [flags]
```

Query syntax: passed verbatim as the `/q/<query>` path segment to JobLeads' own server-side search; phrase quoting, OR, and exclusion syntax not tested.

Key flags:
- `--query <text>` / `-q <text>` — keywords (job title, skill). Maps to JobLeads' own
  `/q/<query>` search path. Omit to browse the whole US region.
- `--location <text>` / `-l <text>` — city/state (e.g. `"Austin TX"`, `"Denver CO"`) or
  `"Remote"`. Maps to JobLeads' own `/l/<location>` search path — this is a **geo-radius
  match**, not an exact-string filter, so nearby towns legitimately appear too (e.g.
  `-l "Austin TX"` returns real Cedar Park/New Braunfels/Round Rock postings — see Notes).
- `--jobage <days>` — posted within N days. Client-side only (JobLeads exposes no
  server-side age parameter this CLI could find), and precision is capped at 14 days — see
  Notes.
- `--page <n>` — 1-indexed page over JobLeads' own server-side pagination. Default 1.
- `--limit <n>` / `-n <n>` — cap results returned (client-side, max 25 — JobLeads' own page
  size).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/jobleads-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the trailing hex id from a `search` result (e.g. `e40c098bc5f9d671b4c65b64530d9c0ba`).
You may also pass the full `url` field from a `search` result — preferred, since it's always
the real one (the slug segment before the id is decorative, confirmed live).

## Usage examples

```bash
# Business development roles near Austin, TX (example market)
bun run .agents/skills/jobleads-search/cli/src/cli.ts search -q "business development" -l "Austin TX" --format table

# VP/director-level roles, remote
bun run .agents/skills/jobleads-search/cli/src/cli.ts search -q "VP business development" -l "Remote" --format table

# Pharma/CMC roles posted in the last 14 days
bun run .agents/skills/jobleads-search/cli/src/cli.ts search -q "CMC manufacturing" --jobage 14 --format table

# Browse the whole US region for a given metro, no keyword
bun run .agents/skills/jobleads-search/cli/src/cli.ts search -l "Denver CO" --format table

# Full detail for a specific posting (URL from a search result)
bun run .agents/skills/jobleads-search/cli/src/cli.ts detail "https://www.jobleads.com/us/job/business-development-director--denver--e40c098bc5f9d671b4c65b64530d9c0ba" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing URLs/ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page" }, "results": [...] }`; each result carries at
least `id`, `title`, `company`, `location`, `date`, `url` (missing values are `null`, never
omitted), plus `workSetting` and `salary` when JobLeads renders those chips. `detail` adds
`description`, `employmentType`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Location is a real geo-radius match, not a filter to second-guess.** `-l "Austin TX"`
  returning Cedar Park/New Braunfels/Round Rock postings is correct JobLeads behavior, not noise —
  this CLI does not re-filter results by a location substring, since doing so would
  incorrectly drop real, relevant matches (an earlier draft of this CLI did exactly that
  during development — see `url-reference.md`).
- **`--jobage` precision is capped at 14 days.** JobLeads' own UI renders posting age as
  relative text ("Today", "3 days ago", ...) capped at `"14 days+"` for anything older; a
  posting in that capped bucket is excluded from any `--jobage` window narrower than 14 days
  (it can't possibly qualify) and included in windows at or above 14 days (it might qualify
  — the exact age is unknown, and this CLI does not silently drop ambiguous results, matching
  `psychedelic-alpha-search`'s precedent).
- **Pagination is a "later window," not a strict partition.** `--page 2` on a broad query
  returns genuinely different results than page 1, but once a query+location combination
  narrows the match set down, later pages can overlap with earlier ones rather than being
  fully disjoint — see `url-reference.md`.
- **`detail` works via Bun's own `fetch`, even though `curl`-based investigation found every
  detail page blocked by a Cloudflare Turnstile challenge.** This CLI does nothing to
  engineer that difference — same honest UA, no browser automation, no challenge-solving —
  it's Cloudflare's own scoring of the requesting client. See the ⚠️ above and
  `url-reference.md` for the full story, including why `detail` still checks for and
  cleanly reports a challenge (`DETAIL_BLOCKED`) if Cloudflare's scoring ever changes.
- A bad/expired job id returns JobLeads' own `410 Gone`, treated the same as a 404
  (`NOT_FOUND`).
- Fetch retries 429/5xx with exponential backoff (max 6 retries) and a 15s timeout. No
  `Crawl-delay` is specified in `robots.txt`; volume is still kept low per the Terms of Use
  warning above — `search` and `detail` each make exactly one HTTP request per invocation.
