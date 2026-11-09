# Consider Platform Reference

What this skill depends on, how it was verified, and the mechanics of the session handshake
every command performs. This is the file to update if a board's markup or the platform's data
shape changes.

## How this skill was found: Foresite Capital's board looked like Getro but wasn't

`https://careers.foresitecapital.com/companies` returns HTTP 200 and no `Getro` string
anywhere in the raw HTML — `server: nginx`, Express-style session cookies
(`session`/`session.sig`), no `x-powered-by: Getro`. The page is client-rendered: a plain
`curl` shows a loading spinner, not job data. Viewing the actual HTML source (not just
headers) found the real signature in the page footer: `Powered by Consider` linking to
`https://product.consider.com/ctc/talent-circle`, plus `window.serverInitialData` embedded in
a `<script>` tag carrying `"considerDomain":"consider.com"`. Verified live, 2026-09-10.

**Takeaway:** never trust a `jobs.<vc>.com`/`careers.<vc>.com` hostname pattern or a bare 200
status as proof of platform. Confirm independently every time — see `SKILL.md`'s "Verify the
platform" section for the exact check.

## Multi-tenant verification: checking the other five reportedly-Consider boards

The CLI's `--board` flag was already implemented, mirroring `getro-search`'s design (required
flag, `normalizeBoard` validation, no board-specific string baked into `helpers.ts`) — but
**only `careers.foresitecapital.com` had ever been exercised against it live**. The five other
boards in this skill's original description (Costanoa Ventures, OneRagtime, Radian Capital,
SET Ventures, AirTree Ventures) were carried over from an earlier web-search-only pass and
explicitly marked "not individually verified by this task" in `SKILL.md` — i.e. the
generalization claim had code behind it but no live evidence beyond one board, the same trap
`getro-search` learned the hard way with `jobs.a16z.com` and `jobs.psychedelicalpha.com`
(same naming pattern, different platform under the hood). The five candidates were checked
live, 2026-09-10,
with the same platform-signature check `SKILL.md` documents (`curl` for
`window.serverInitialData` + "Powered by Consider" in the footer, cross-checked against
`x-powered-by` headers):

| Candidate (web-search guess) | Actual hostname found | Platform | Evidence |
|---|---|---|---|
| Costanoa Ventures | `jobs.costanoavc.com` (`careers.costanoavc.com` 302-redirects to a non-Consider `costanoa.vc/jobs` marketing page — the real board is on the `jobs.` subdomain) | **Consider** | `window.serverInitialData` + "Powered by Consider" footer confirmed; live `search`/`detail` tested end-to-end (725 jobs at verification time) |
| OneRagtime | `careers.oneragtime.com` | **Consider** | Same signature confirmed; live `search` tested |
| Radian Capital | `careers.radiancapital.com` (not `radiancap.com`, which doesn't resolve) | **Consider** | Same signature confirmed; live `search` tested |
| SET Ventures | `careers.setventures.com` | **Consider** | Same signature confirmed; live `search` tested |
| AirTree Ventures | `jobs.airtree.vc` (`careers.airtree.vc` doesn't resolve) | **Getro, NOT Consider** | `x-powered-by: Getro` response header — no `window.serverInitialData`, no "Powered by Consider" footer. This is a genuine Getro board; use `getro-search --board jobs.airtree.vc` instead (not yet in that skill's own verified-boards table — a future maintainer should add it there). |

Four of five panned out. The generalization claim in `SKILL.md` rests on what was actually
verified here (Foresite + Costanoa tested end-to-end with `search` and `detail`; OneRagtime,
Radian Capital, and SET Ventures confirmed via the platform signature and a live `search` call
but not deep-tested with `detail`) — not on the original unverified web-search list, which was
wrong about one of its five entries.

## Session handshake is shared across boards, not per-board

The task that produced this multi-tenant refactor specifically asked whether the GET+CSRF+
cookie handshake (see "Session handshake mechanics" below) is scoped to the board it was
minted against, or valid platform-wide — this matters for correctness once `--board` accepts
any hostname, so it was tested explicitly rather than assumed. Method: mint a session against
`careers.foresitecapital.com` (via `fetchSession`), then use that session's cookies + CSRF
token to call `jobs.costanoavc.com/api-boards/search-jobs` directly (and the reverse: a
Costanoa-minted session against Foresite's endpoint), varying the POST body's `board.id`
field independently of which session/host was used.

**Result: the session/CSRF pair is accepted by every board's endpoint regardless of which
board minted it.** What actually determines which board's jobs come back is the `board.id`
value in the POST body alone:

| Session/cookies from | Endpoint host called | `board.id` in body | Result |
|---|---|---|---|
| `careers.foresitecapital.com` | `careers.foresitecapital.com` | `foresite-capital` | `total: 793` (Foresite's own count — control case) |
| `careers.foresitecapital.com` | `jobs.costanoavc.com` | `foresite-capital` (unchanged) | `total: 793` (Foresite's count, even though the HTTP request went to Costanoa's hostname) |
| `jobs.costanoavc.com` | `careers.foresitecapital.com` | `costanoa-ventures` (unchanged) | `total: 726` (Costanoa's own count — confirmed against `jobs.costanoavc.com`'s own baseline of 725, off by one likely due to a job posted between the two calls) |
| `careers.foresitecapital.com` (session/cookies) | `jobs.costanoavc.com` (endpoint host) | `costanoa-ventures` (deliberately overridden) | `total: 725` (correctly returns Costanoa's data) |

**Practical takeaway: the CSRF token is a general anti-automation gate for the whole Consider
platform, not a per-board authorization token.** The board actually queried is selected purely
by the request body's `board.id`, independent of both the requesting host and the session used.
This does **not** create a correctness bug in this CLI: `runSearch`/`runDetail` always call
`fetchSession(opts.board)` fresh, per invocation, which fetches both a valid session **and**
that same board's own `board.id` together from that board's own `/jobs` page — so the two
always match and every query is correctly scoped to the board the caller asked for. The finding
matters for a future maintainer mainly as a correction to any assumption that a stale or
cross-board session would be rejected: it would not be, at the HTTP layer, though the CLI's own
design (never persisting or reusing a session across a different `--board` value in the same
process) never actually exercises that path.

## What this skill fetches

Two same-origin endpoints on the board's own hostname — **no separate cross-origin API host**
to worry about here, unlike Getro's `api.getro.com`:

1. `GET https://<board>/jobs` — the SSR page. Contains no job data itself (just a loading
   spinner + `window.serverInitialData`), but this is the only way to mint a valid session:
   the response's `Set-Cookie` headers (`session`, `session.sig`) and the `csrfToken` embedded
   in `window.serverInitialData` are a matched pair — the search API rejects a CSRF token
   that doesn't match the session cookie that produced it (`{"error":"INVALID_CSRF"}`, verified
   live by mismatching them deliberately).
2. `POST https://<board>/api-boards/search-jobs` — the real search API the page's own
   client-side JS calls after hydration. Requires the `Cookie` + `X-CSRF-Token` pair from step
   1, sent together in the same CLI invocation (a session is not persisted between runs — each
   `search`/`detail` call fetches its own fresh one).
3. `GET https://<board>/api-boards/jobs/<jobId>?companyId=<companySlug>` — single-job detail,
   used by `detail`. Only the `Cookie` header is needed here (no CSRF token) — confirmed live
   by omitting `X-CSRF-Token` and still getting a normal (if empty) response.

### `robots.txt` (identical on every verified board)

```
# www.robotstxt.org/

User-agent: LinkedInBot
Disallow: /

User-agent: *
Allow: /
```

Confirmed byte-for-byte identical on `careers.foresitecapital.com`, `jobs.costanoavc.com`,
`careers.oneragtime.com`, `careers.setventures.com`, and `careers.radiancapital.com` — expected,
since this file is served by Consider's own shared infrastructure rather than configured
per-client. `Allow: /` for every agent except `LinkedInBot`, including this CLI's own
descriptive User-Agent. Does not disallow `/api-boards/` on any of them. The
`LinkedInBot`-specific disallow is presumably to stop LinkedIn's own crawler from
re-indexing/mirroring board listings directly — not relevant to this skill's own fetches.

### Terms of Service — read this before running the CLI

`https://consider.com/legal/terms`, fetched and read in full during investigation, prohibits
under its Acceptable Use section:

> use any robot, spider, scraper, or other automated means to access the Service for any
> purpose without our express written permission, or bypass any measures we may use to prevent
> or restrict access to the Service

Same shape as `getro-search`'s situation: open `robots.txt`, prohibitive ToS. Per
`add-portal.md` Step 2.4, this skill carries the same personal-use-only warning — see
`SKILL.md`.

## Session handshake mechanics

`window.serverInitialData = {...};` is a JSON object (not a JS object literal with unquoted
keys — safe to `JSON.parse` directly once extracted), embedded inline in the page's `<script>`
tag. It is **not** wrapped in a `<script id="...">` tag the way Getro's `__NEXT_DATA__` is, so
this skill locates it by the `window.serverInitialData = ` string marker and then does a
brace-balanced scan (tracking string literals, so a `{`/`}` inside a quoted value doesn't
throw off the count) to find the matching closing brace — see `helpers.ts`'s
`extractBalancedJson`. The two fields this skill reads out of it:

```jsonc
{
  "csrfToken": "QFOmsyDZ-4xQ7d4D7MhcEKh6PSzwrc8Pj2bw",
  "board": { "id": "foresite-capital", "isParent": true }
  // …plus a large amount of form-schema/config data this skill does not need
}
```

`board.id` is the value the search POST body's own `board.id` field must echo back — using
the wrong value was not tested (not worth the extra live request budget), but using the
matching value from the same page load is confirmed to work.

Cookies: the `/jobs` GET response's `Set-Cookie` headers include `session`, `session.sig`, and
several Cloudflare/ALB session cookies (`AWSALBAPP-0..3` — some carrying the literal value
`_remove_`, which is itself a valid cookie value, not an error). This skill forwards **all** of
them back verbatim (name=value pairs joined with `; `) on the subsequent POST/GET — narrowing
to just `session`/`session.sig` was not tested, so the current implementation errs toward
forwarding everything the server set.

## Search: `POST /api-boards/search-jobs`

Request body shape (confirmed live against `careers.foresitecapital.com`):

```jsonc
{
  "meta": { "size": 20 },              // or { "size": 20, "sequence": "<cursor>" } for page 2+
  "board": { "id": "foresite-capital", "isParent": true },
  "query": { /* facet keys below */ },
  "grouped": false
}
```

### Confirmed working query keys

| JSON key | CLI flag | Verified values | Evidence |
|----------|----------|------------------|----------|
| `keywords` | `--query` / `-q` | any free text | Re-ranks results (see "Keyword search is ranking, not filtering" below) — confirmed the returned job set's ordering and content changed with different keyword strings. |
| `locations` | `--location` / `-l` | array of free-text location strings, e.g. `["San Francisco, California"]` | Cut the unfiltered total (793) to 85, every returned job's `locations` field containing a San Francisco variant. **A bare city name alone did NOT work**: `locations: ["San Francisco"]` (no state) returned `total: 0` — use the fuller normalized string as it appears in a job's own `locations`/`normalizedLocations` field. |
| `departments` | `--department` | array of department label strings, e.g. `["Finance"]` | Cut the total to 15, every returned job's `departments` array containing `"Finance"`. Exact label match (case-sensitive, matched observed casing). |
| `remoteOnly` | `--remote` (boolean flag) | `true` | Cut the total to 196, every returned job's `remote` field `true`. |
| `postedSince` | `--jobage <days>` (sent as `"<N>d"`) | e.g. `"1d"`, `"7d"` | `"1d"` returned `total: 8`; `"7d"` returned `total: 71` — both plausible, increasing subsets. Confirmed **server-side** filtering, unlike Getro's client-side-only `--jobage`. |

### Keyword search is ranking, not filtering

`query: { keywords: "engineer" }` returned `total: 793` — **identical to the unfiltered
baseline** — and so did every other keyword string tried. Combined with `meta.sequence`
decoding to a base64 JSON blob containing an explicit `"score"` field (e.g.
`{"_id": "...", "score": 1001.17...}`), this strongly indicates Consider's `keywords` search is
a relevance-ranking input over the *entire* board, not a boolean include/exclude filter: every
job on the board is still "in" the result set, just reordered by relevance score. Practically,
this means the top few results for a keyword query genuinely are the best matches (verified:
`"business development"` surfaced a plausible mix of BD/commercial roles near the top), but
`meta.totalOnBoard`/`total` should not be read as a match count when `-q` is set — it is the
board's total job count regardless of the keyword. This is a materially different contract from
Getro's `q` param, which does reduce `jobsState.total` (see `getro-search/url-reference.md`).

### Facet keys tried and found NOT to work

Documented so nobody re-guesses these. All returned `total: 793` (the board's unfiltered
total), i.e. silently ignored rather than rejected with an error:

- `seniority: ["vp"]`, `seniority: ["director"]` — a job's own field is `jobSeniorities`
  (array of `{id, label, value}`, e.g. `{"id":"director","label":"Director/Senior
  Director","value":"director"}`), but the identically-named query key does not filter.
- `jobSeniorities`, `seniorities`, `seniorityIds`, `jobSeniorityIds` (as `["director"]`) — none
  of these guessed key names filtered either. The real key (if one exists) was not found in
  the time budgeted for this investigation.
- `jobId`, `jobIds`, `id`, `ids` (as `["<a real jobId>"]`) — tried in hope of a direct
  get-by-id lookup via search (to sidestep the `detail` endpoint's Consider-hosted-only
  limitation); none filtered. There is no confirmed way to fetch a single arbitrary job's full
  record by id other than `/api-boards/jobs/<id>?companyId=...`, which itself only returns data
  for Consider-hosted jobs (see `SKILL.md`).

The CLI exposes a `--facet key=value` escape hatch for anyone who wants to experiment beyond
the confirmed keys, clearly marked unverified in `--help` and `SKILL.md`.

### Pagination: `meta.sequence` is a real cursor; `from`/`page` offsets do nothing

`{"meta": {"size": 3, "from": 3}}` returned the **exact same first 3 jobs** as `{"meta":
{"size": 3}}` with no `from` — a numeric offset is silently ignored. But feeding the previous
response's own `meta.sequence` value back in as `{"meta": {"size": 3, "sequence":
"<value>"}}` genuinely advanced to the next batch of results (confirmed: different jobs
returned). `meta.sequence` decodes (base64) to a JSON object like `{"_id": "<job's internal
id>", "score": <float>}` — an Elasticsearch-style `search_after` cursor keyed on the last
result's score/id, not an offset. This CLI's `--page <n>` therefore walks the cursor chain
sequentially (fetch page 1, then re-POST with each response's own `sequence` n-1 times) to
reach page `n`, rather than requesting an offset directly — see `search.ts`.

## Detail: `GET /api-boards/jobs/<jobId>?companyId=<companySlug>`

Confirmed live: for every one of the first 50 jobs sampled on `careers.foresitecapital.com`
(`considerHosted: false` on all 50 — none hosted directly by Consider), this endpoint returns:

```json
{"version": {...}, "errors": [], "debug": []}
```

— i.e. no `job` key at all, regardless of whether `companyId` is passed as the display-name
form (`"Delfi Diagnostics"`) or the slug form (`"delfi-diagnostics"`); both were tried against
a non-hosted job and both came back empty. This is expected: the endpoint is for the
`considerHosted: true` minority (jobs Consider's own application flow handles directly, viewed
as a modal within the board's own React app), and no example of one was found on this board
within the investigation's request budget — search results carry only `considerHosted: false`
in every page sampled. The CLI's `detail` command surfaces this as a clean
`NOT_HOSTED_BY_CONSIDER` error (see `SKILL.md`) rather than pretending to have fetched
something.

**Whether `companyId` genuinely needs to be the display-name form for the `considerHosted:
true` case (vs. the slug this CLI sends) was not confirmed**, since no positive example
existed to test against. A future maintainer who finds a `considerHosted: true` job should
verify this and update `helpers.ts`'s `fetchJobDetail` if the slug form turns out not to work.

## `search-jobs` response job object

```jsonc
{
  "jobId": "dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e",   // Lever-style; numeric for Greenhouse-sourced jobs (e.g. "4398267009")
  "title": "Accounting Operations Manager",
  "companyId": "Delfi Diagnostics",       // display-name form - NOT url-safe, has spaces/casing
  "companySlug": "delfi-diagnostics",     // url-safe form - what this CLI uses in compound ids
  "companyName": "Delfi Diagnostics",
  "companyDomain": "delfidiagnostics.com",
  "companyStaffCount": 174,
  "considerHosted": false,                // true for the (rare/unobserved) Consider-hosted case
  "departments": ["Finance"],
  "locations": ["Palo Alto, CA"],
  "normalizedLocations": [{"id": "Palo Alto, California", "label": "Palo Alto, California", "value": "Palo Alto, California"}],
  "remote": false,
  "hybrid": false,
  "jobSeniorities": [{"id": "manager", "label": "Manager/Senior Manager", "value": "manager"}],
  "jobFunctions": [{"id": "Accounting", "label": "Accounting", "value": "Accounting"}],
  "requiredSkills": [{"id": "resume:FDA", "label": "FDA", "value": "resume:FDA"}, /* … */],
  "preferredSkills": [/* same shape */],
  "salary": {
    "period": {"label": "Year", "value": "year"},
    "minValue": 140000,
    "maxValue": 175000,
    "currency": {"label": "USD", "value": "USD"},
    "isOriginal": true
  },
  "timeStamp": "2026-09-09T23:11:01.621000Z",   // ISO 8601 - already the right shape, no epoch conversion needed
  "url": "https://jobs.lever.co/delfidiagnostics/dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e",
  "applyUrl": "https://jobs.lever.co/delfidiagnostics/dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e?lever-source%5B%5D=careers.foresitecapital.com"
  // …plus companyLogos, scores, atsJobs, matchingTalent, and other fields this skill ignores
}
```

`url` and `applyUrl` are both already the **external** ATS posting URL for a non-hosted job
(the CLI prefers `applyUrl` when present, since it carries a source-attribution query param
Consider itself adds) — there is no separate "board's own copy of the job" page to visit
first, unlike Getro's detail pages.

## Parsing notes

- No HTML card scraping anywhere in this skill — search results come back as structured JSON
  from `/api-boards/search-jobs` directly, and the one HTML page fetched (`/jobs`) is only
  read for its embedded `window.serverInitialData` blob and session cookies, never for job
  content.
- Fetch uses an honest, self-identifying User-Agent (`Mozilla/5.0 (compatible;
  consider-search-cli/1.0)`), exponential backoff with jitter on 429/5xx (max 6 retries), and
  a 15s timeout per request, matching the repo's fetch contract.
