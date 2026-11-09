# Getro Platform Reference

What this skill depends on, how it was verified, and — most importantly — which
`jobs.<org>.com` boards actually run the Getro platform versus merely looking like they do.
This is the file to update if a board's markup or the platform's data shape changes.

## The headline finding: not every "jobs at our portfolio" board is Getro

The task that produced this skill assumed `jobs.a16z.com`, `jobs.menlovc.com`, and
`jobs.psychedelicalpha.com` were the same underlying platform because their `robots.txt`
files look similar (open, sitemap-only or a generic `Allow: /`). **They are not the same
platform.** Verified live, 2026-09-10:

| Host | Platform | Evidence |
|------|----------|----------|
| `jobs.menlovc.com` | **Getro** | `x-powered-by: Getro` response header; "Powered by Getro" footer link to `getro.com/vc`; Next.js pages-router `__NEXT_DATA__` blob with the shape documented below |
| `jobs.accel.com` | **Getro** | Same header + footer + `__NEXT_DATA__` shape |
| `jobs.alleycorp.com` | **Getro** | `x-powered-by: Getro` header |
| `jobs.technyc.org` | **Getro** | `x-powered-by: Getro` header |
| `jobs.dukecapitalpartners.duke.edu` | **Getro** | `x-powered-by: Getro` header |
| `jobs.a16z.com` | **NOT Getro** | `x-powered-by: Next.js`; `cache-tag: …:frontier-jobs-a16z` (a custom-built app, codenamed "frontier", not the Getro SaaS); a completely different design system and URL scheme (search result titles link straight to the source ATS; there is no `__NEXT_DATA__`; the search page ignores every query-string filter it was given, always rendering the same generic list) |
| `jobs.psychedelicalpha.com` | **NOT Getro** | Runs **Niceboard** (`cdn.niceboard.co`, `/employer/login`, `/seeker/login`, `/categories`, `getApplyUrl()` client helpers) — an entirely different job-board SaaS product with a category-based (not portfolio-company-based) structure. `jobs.psychedelicalpha.com/jobs` doesn't even resolve (404) |
| `jobs.lsvp.com` | **NOT Getro** | A third, distinct custom app (AWS ALB session cookies, no Getro markers, no `__NEXT_DATA__`) |

**Takeaway for this skill:** `--board` only works for genuine Getro boards. Passing
`jobs.a16z.com`, `jobs.psychedelicalpha.com`, or `jobs.lsvp.com` fails loudly with
`SEARCH_FAILED` / "could not find the `__NEXT_DATA__` payload" rather than silently
returning wrong or empty data — see `helpers.ts`'s `extractNextData`. If you want a16z or
Psychedelic Alpha specifically, they need their own portal skills (built against their own,
different markup) — this one does not cover them despite the similar hostname pattern.

The most reliable way to confirm a new candidate board is genuine Getro before pointing
`--board` at it: `curl -sI https://jobs.<org>.com/jobs | grep -i x-powered-by` should say
`Getro`, or view-source and look for `Powered by Getro` in the footer / a
`<script id="__NEXT_DATA__" type="application/json">` block.

## What this skill fetches, and what it deliberately never touches

Every genuine Getro board's client-side app fetches search results from a **shared,
cross-origin API**: `https://api.getro.com/api/v2/collections/<per-board-id>/search/jobs`
(confirmed by inspecting `jobs.menlovc.com`'s own network traffic while using its search box
in a browser — collection `767` for Menlo). That host's `robots.txt` is:

```
User-agent: *
Disallow: /
```

**A full disallow, for every user agent, on the entire host.** This skill never requests
`api.getro.com`, directly or indirectly — no exceptions, regardless of what a per-board
`robots.txt` says, per this task's mandate to respect `robots.txt` rather than route around it.

Instead, this skill fetches only each board's own `/jobs` and `/companies/*/jobs/*` pages —
i.e. `https://jobs.<org>.com/...`, which is a **different host** from `api.getro.com` and
which every verified board's own `robots.txt` leaves fully open (see table below). Those
pages are server-rendered (Next.js `getServerSideProps`), and the server-side render embeds
a full JSON snapshot of the page's Redux store in a `<script id="__NEXT_DATA__"
type="application/json">` tag. Fetching that HTML and regex-extracting + `JSON.parse`-ing
that one script block gets structured data with no HTML-card scraping at all.

### Per-board `robots.txt` (verified Getro boards only)

| Board | robots.txt |
|-------|-----------|
| `jobs.menlovc.com` | `Sitemap: https://jobs.menlovc.com/sitemap.xml` only — no disallow |
| `jobs.accel.com` | Sitemap only — no disallow |
| `jobs.alleycorp.com` | Sitemap only — no disallow |
| `jobs.technyc.org` | Sitemap only — no disallow |
| `jobs.dukecapitalpartners.duke.edu` | Sitemap only — no disallow |

None of the verified boards' own `robots.txt` disallow anything this skill fetches, and none
specify a crawl-delay. (`jobs.psychedelicalpha.com`'s `robots.txt` *does* disallow `/api/`
with a 1s crawl-delay — the original recon's basis for guessing a shared platform — but that
board is Niceboard, not Getro, and out of scope here regardless.)

### Terms of Service — read this before running the CLI

`robots.txt` being open is not the whole story. Getro's own Terms of Service
(`https://www.getro.com/terms`, fetched and read in full during Step 2) contain, under
Acceptable Use:

> "Crawls," "scrapes," or "spiders" any page, data, or portion of or relating to the
> Services or Content (through use of manual or automated means)

This is a blanket prohibition covering every Getro-hosted board (each client job board is
"the Services," white-labeled). It parallels `linkedin-search`'s situation: `robots.txt`
permits automated fetches, but the Terms of Service prohibit them outright. Per
`add-portal.md` Step 2.4, this skill therefore carries the same prominent
personal-use-only warning as `linkedin-search` — see `SKILL.md`.

## Search: `GET https://<board>/jobs`

Query parameters, confirmed live against `jobs.menlovc.com` (a fresh, un-authenticated
`curl` request, no cookies/session — matching what the SSR path serves to any visitor):

| Param | Maps to CLI flag | Notes |
|-------|-------------------|-------|
| `q` | `--query` / `-q` | Free-text keyword query. **Confirmed working server-side** (result count and the visible list both changed correctly; cross-checked against the live site's own search box, which round-trips through the same param — `location.href` became `?q=engineer` after typing "engineer" into the site's own search box and it fetched from `api.getro.com`, but the *same* `q=engineer` also works when the CLI requests `/jobs` directly, which is what matters here). |
| `filter` | (built internally from `--location`, `--seniority`, `--remote`, `--facet`) | Base64-encoded JSON object. See "Confirmed filter facets" below. |

**A wrong param name is silently ignored, not rejected.** Early investigation tried
`?titlePrefix=engineer` (a16z's own, unrelated query param) against Menlo and got back the
exact same unfiltered ~20-job default list every time, with no error — this is why every
facet below was verified by diffing `initialState.jobs.total` and the first few `found[]`
entries between a request with the param and one without, not by trusting a 200 status.

### Confirmed filter facets (all live-tested on `jobs.menlovc.com`, cross-checked on `jobs.accel.com`)

The `filter` param is `base64(JSON.stringify({ ...keys }))`. Values are always arrays, even
for a single value.

| JSON key | CLI flag | Verified values | Evidence |
|----------|----------|------------------|----------|
| `searchable_locations` | `--location` / `-l` (free text) | Any location string as it appears in a job's own `searchableLocations`/`locations` field, e.g. `"San Francisco, CA, USA"` | `{"searchable_locations":["San Francisco, CA, USA"]}` cut `q=engineer`'s result count from 2,980 to 852, and every returned job's `locations` field contained San Francisco. **The whole string is one array element — it is not comma-split.** A location string routinely contains its own commas (city, state, country), so the CLI splits `--location` on `;` instead of `,` (bug found and fixed during Step 4 testing: comma-splitting `"San Francisco, CA, USA"` into three tokens made the facet match nothing). |
| `seniority` | `--seniority` | `senior`, `mid_senior`, `entry_level`, `associate`, `internship` (values observed in the wild across sampled jobs; not confirmed to be an exhaustive enum) | `{"seniority":["senior"]}` cut the unfiltered total (4,178) to 1,602, and every returned job's `seniority` field was `"senior"`. |
| `work_mode` | `--remote` | `remote`, `on_site` confirmed working; `hybrid` accepted (no HTTP error) but returned 0 results in testing — plausibly just no hybrid postings matched at that moment, not proof the value itself is wrong | `{"work_mode":["remote"]}` cut the total to 406, all returned jobs `workMode: "remote"`. `{"work_mode":["hybrid"]}` returned `total: 0`. |

Facets combine with **AND** semantics and combine correctly with `q`: `q=engineer` +
`seniority=["senior"]` + `work_mode=["remote"]` together returned 86 results, all matching
every criterion (verified by inspecting each returned job's fields).

### Facet keys tried and found NOT to work

Documented so nobody re-guesses these:

- `{"companies": ["<org-slug>"]}` and `{"companies": [<org-numeric-id>]}` — both left the
  result set completely unfiltered (still the board's full unfiltered total). The company
  facet almost certainly exists (the UI has a "Company" filter) under some other key/shape,
  but it was not found in the time budgeted for this investigation.
- `{"job_functions": ["Engineering"]}` — returned `total: 0`. The UI's "Job function" filter
  likely expects numeric ids from a controlled list (`initialState.allJobFunctions` in the
  page's own `__NEXT_DATA__`, e.g. `{"id": 5, "name": "(Engineering)"}` was observed on a
  detail page) rather than a free-text label — untested further.
- `a16z's ?titlePrefix=` query param does nothing on genuine Getro boards (see above) — it
  is specific to a16z's own, different, non-Getro app.

The CLI exposes a `--facet key=value` escape hatch for anyone who wants to experiment beyond
the three confirmed keys, clearly marked unverified in `--help` and `SKILL.md`: an
unrecognized key/value returns zero results rather than an HTTP error, so a typo fails
silently at the data level.

### Pagination does not work via the SSR page — by design, and that's the correct call

`?page=2` (and other guesses) against `/jobs` returned **the exact same first ~20 jobs**
every time, regardless of the page number requested, `q`, or `filter`. The real "load more"
mechanism is client-side JavaScript hitting `api.getro.com` directly (see network trace
above) — which is the endpoint `robots.txt` fully disallows. There is therefore no way to
reach page 2+ of a Getro board's results while respecting `robots.txt`, on any board, for any
query. The CLI's `search --page` flag accepts only `1` and exits `1` with a clear
`PAGE_UNSUPPORTED` error for anything else, rather than silently returning duplicate results
under a `page: 2` label.

### `initialState.jobs.found[]` job object (the `/jobs` search page)

```jsonc
{
  "id": 92787641,
  "title": "Solutions Engineer",
  "organization": {
    "id": 9423,
    "name": "Carta",
    "slug": "carta-com",
    "stage": "series_unknown",
    "headCount": 5,
    "industryTags": ["Enterprise Software", "Fintech", "Software"],
    "logoUrl": "https://cdn.getro.com/companies/…"
  },
  "locations": ["London, UK"],
  "searchableLocations": ["London, UK", "Greater London, UK", "England, UK", "United Kingdom", "Europe"],
  "workMode": "on_site",
  "seniority": "mid_senior",
  "skills": ["Fund Administration", "IT Portfolio Management", …],
  "url": "https://boards.greenhouse.io/carta/jobs/7989778003",   // the EXTERNAL ATS posting URL
  "slug": "92787641-solutions-engineer",
  "createdAt": 1789047558,          // epoch SECONDS (verified: matched the fetch's own wall-clock time)
  "hasDescription": true,           // the full description is NOT included here — see detail below
  "compensationPublic": true,
  "compensationAmountMinCents": null,
  "compensationAmountMaxCents": null,
  "compensationCurrency": null,
  "compensationPeriod": "period_not_defined"
}
```

No `description` field on the search page — only the `hasDescription` boolean. Fetch
`detail <id> --board <hostname>` for the full text.

## Detail: `GET https://<board>/companies/<any-string>/jobs/<numeric-id>-<any-string>`

**The company slug and title slug segments are purely decorative.** Verified live: fetching
`https://jobs.menlovc.com/companies/wrong-slug/jobs/92787641-solutions-engineer` (deliberately
wrong company slug) and `https://jobs.menlovc.com/companies/x/jobs/92787641-x` (both slugs
replaced with `x`) both returned **200** and the correct job (`currentJob.id === 92787641`,
title "Solutions Engineer"). Getro resolves the route purely off the numeric id. This is why
the CLI's `detail` command builds `https://<board>/companies/x/jobs/<id>-x` and needs only
the numeric id, never the real slugs — simpler and one less thing that can drift when a job's
title changes.

A 404 (nonexistent id, or a since-removed posting on some boards) is mapped to the standard
`NOT_FOUND` error.

### `initialState.jobs.currentJob` (the detail page)

```jsonc
{
  "id": 92787641,
  "title": "Solutions Engineer",
  "organization": { "id": 9423, "name": "Carta", "slug": "carta-com", "domain": "carta.com", "description": "…", "industryTags": [{"description": "Enterprise Software"}, …], … },
  "locations": [{ "id": 17839, "name": "London, UK", "placeId": "…" }],
  "url": "https://boards.greenhouse.io/carta/jobs/7989778003",
  "slug": "92787641-solutions-engineer",
  "postedAt": "2026-09-10T13:39:18.889Z",     // ISO 8601, unlike the search page's epoch-seconds createdAt
  "closedAt": null,
  "deactivatedAt": null,
  "expiresAt": null,
  "status": "active",                          // observed: "active"; presumably "closed" for filled roles
  "visibility": "visible",
  "source": "career_page",
  "applicationMethod": "method_not_defined",
  "applicationPath": null,
  "employmentTypes": [],                       // e.g. ["intern"] observed on another posting
  "jobFunctions": [{ "id": 5, "name": "(Engineering)" }],
  "description": "<div> <h2>The Company You'll Join</h2> <p>…</p> … </div>",  // raw HTML
  "compensationPublic": true,
  "compensationAmountMinCents": null,
  "compensationAmountMaxCents": null,
  "compensationCurrency": null,
  "compensationPeriod": "period_not_defined"
}
```

`description` is raw HTML (`<h2>`, `<p>`, `<ul>`/`<li>`, `<br>` observed) — the CLI's
`cleanHtml` (same approach as `freehire-search`/`linkedin-search`: strip tags, decode
entities, collapse block-level tags to newlines) turns it into readable plain text for
`--format plain` and for the JSON `description` field alike.

**Note on `organization.industryTags` shape drift:** on the search page it is
`string[]` (e.g. `["Enterprise Software", "Fintech", "Software"]`); on the detail page it is
`{ description: string }[]` (e.g. `[{"description": "Enterprise Software"}, …]`). `helpers.ts`
handles both shapes (`industryTagNames`).

## Company/industry facet for a life-sciences focus

The task asked specifically about filtering to biotech/health portfolio companies (relevant
to this user's profile). No board-wide "industry" URL facet was found to work (see "Facet
keys tried and found NOT to work" above). What **is** available, without any extra request:
every job's `organization.industryTags` is returned inline in the search results (e.g.
Benchling's jobs carry `"Life Science"`, `"Biotechnology"` among their tags) — a client-side
`--query` match against company name/title plus eyeballing the `skills`/company context in
`--format json` output is the practical way to spot life-sciences roles today. A true
server-side industry facet may exist under a key this investigation didn't find; a future
maintainer with more time budget should look at `initialState.filters.industryTags` /
`allJobFunctions`-style controlled-vocabulary lists embedded in the page's own
`__NEXT_DATA__` for the real key and value format before guessing further.

## Parsing notes

- The response is JSON embedded in HTML (`__NEXT_DATA__`), not raw HTML card markup, so
  there is no chunked per-card regex parsing here (unlike `linkedin-search`) — the risk of
  "one malformed card breaks the rest" does not apply the same way. The one thing that *can*
  break generically is the page not containing `__NEXT_DATA__` at all, which `helpers.ts`'s
  `extractNextData` turns into a clear, specific error rather than a crash or empty result.
- Fetch uses an honest, self-identifying User-Agent (`Mozilla/5.0 (compatible;
  getro-search-cli/1.0)`), exponential backoff with jitter on 429/5xx (max 6 retries), and a
  15s timeout per the repo's fetch contract.
