# Greenhouse Job Board API reference

The endpoints, parameters, and response shapes this skill depends on. This is the
file to update if Greenhouse changes its API. Base URL is fixed:
`https://boards-api.greenhouse.io` (there is no self-hosting / swappable base
URL here, unlike `freehire-search` — Greenhouse is a hosted SaaS ATS, not
something a forker would run themselves).

## Multi-tenancy

Every endpoint is scoped by a `<company>` path segment — the slug from the
company's public job-boards URL, `https://job-boards.greenhouse.io/<company>`
(older boards use `https://boards.greenhouse.io/<company>`; both resolve the
same slug against the API). There is no "list all companies" endpoint; the
caller must already know the slug. Verified live: the slug match is
case-insensitive (`Anthropic` and `anthropic` both resolve).

## Authentication

None. All endpoints below returned `200`/`404` (never `401`/`403`) in live
testing with a plain `fetch` and no credentials.

## `robots.txt`

`https://boards-api.greenhouse.io/robots.txt` (fetched live):

```
User-agent: *
Disallow: /embed/
```

Only `/embed/` is disallowed. `/v1/boards/*` — everything this skill calls —
is unrestricted. This is a genuine public API, not scraping.

## `GET /v1/boards/<company>/jobs`

Lists a company's open jobs. Verified live against 11 companies (2026-09-10):

| Company slug | HTTP | Job count |
|---|---|---|
| `anthropic` | 200 | 600 |
| `stripe` | 200 | 615 |
| `figma` | 200 | 157 |
| `coinbase` | 200 | 220 |
| `gitlab` | 200 | 230 |
| `airtable` | 200 | 16 |
| `robinhood` | 200 | 130 |
| `discord` | 200 | 45 |
| `instacart` | 200 | 104 |
| `affirm` | 200 | 200 |
| `doordash` / `notion` | 404 | not on Greenhouse under that slug (or a different slug) |

An unknown/misspelled slug is a `404` with an empty body, not an error object —
the CLI reports this as `UNKNOWN_COMPANY` rather than an empty result set.

### Query parameters

| Param | Effect | Notes |
|---|---|---|
| `content` | `true` adds a `content` field (full HTML posting body) to every job in the response; `false` (or omitted) leaves it out | Documented and confirmed live. Requesting it for a large board (e.g. Stripe's 615 jobs) is a heavy payload — the CLI only sets this when `--with-description` is passed. |
| `q` (undocumented) | **No effect** | Tried live against `stripe` (`?q=engineer`): returned all 615 jobs, identical to no filter. There is no server-side keyword search. |
| `page` (undocumented) | **No effect** | Tried live against `stripe` (`?page=2`): returned the same 615 jobs (identical first id) as `?page=1`. There is no server-side pagination — the endpoint always returns the company's entire open-job list in one response. |

Because of the above, this skill implements `--query` and `--page`
**client-side**, over the one full list it fetches — documented in `SKILL.md`
and the CLI's own `--help`, per the portal-skill contract's rule against
silently dropping a flag.

### Response shape (`content=false`)

```jsonc
{
  "jobs": [
    {
      "id": 4461450008,                 // -> result.id, and detail's <id>
      "title": "Account Executive, AI Native",
      "absolute_url": "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
      "location": { "name": "New York City, NY; San Francisco, CA | New York City, NY" },
                                         // free text; multiple locations joined with
                                         // ";" or "|" — no structured per-location field
      "metadata": [
        { "id": 4036944008, "name": "Location Type", "value": "On-Site", "value_type": "single_select" }
      ],
      "internal_job_id": 4147866008,
      "requisition_id": "3356",
      "company_name": "Anthropic",
      "updated_at": "2026-08-21T21:32:54-04:00",
      "first_published": "2024-12-20T13:53:38-05:00",  // -> result.date
      "language": "en",
      "application_deadline": null
      // "content" only present when content=true
    }
  ]
}
```

`data_compliance` was also present per-job in one sample and is not surfaced
in this skill's output (GDPR consent flags, not job content).

### `date`: `first_published` vs `updated_at`

Both are ISO 8601 timestamps but mean different things: `updated_at` bumps on
**any** edit to the posting (a typo fix, a metadata change), while
`first_published` is set once, when the posting first went live. The
portal-skill contract's `date` field and `--jobage` (posting recency) both use
**`first_published`** — using `updated_at` would mark a job "recent" every
time its department tag gets tweaked, which is not what "posted within N
days" means to a searcher. `updated_at` is still carried on each result as an
extra field, for callers who do want edit-recency.

### `metadata`: company-defined, not a fixed schema

Live testing (2026-09-10) shows `metadata` field names vary **per company**,
not just per posting — companies use it for arbitrary custom fields, and
there is no shared vocabulary:

| Company | `metadata` field names seen |
|---|---|
| `anthropic` | `Location Type` |
| `coinbase` | `Careersite Department (for job postings)`, `HM Employee ID (WD)`, `Team`, `mule_recruiters_counter_custom`, `mule_sourcers_counter_custom` |
| `gitlab` | `Quota Coverage Type` |
| `robinhood` | `Careers Page Bucket` |
| `discord` | `Careers Site Department`, `Featured on Website` |
| `instacart` | `Employment Type`, `Exemption Status`, `Time Type` |
| `affirm` | `External Department`, `PERM Job?` |
| `stripe`, `figma`, `airtable` | none (empty array) |

The only field this skill reads specifically is **`Location Type`**
(On-Site/Remote/Hybrid), surfaced as `result.location_type` **when a company
happens to set it** — most don't, per the table above, so treat a `null`
`location_type` as "not disclosed", not "not remote". `detail` additionally
exposes the full raw `metadata` map (`name -> value`) so a caller can read a
company-specific field the CLI doesn't know to name.

## `GET /v1/boards/<company>/jobs/<id>`

A single job. Always includes `content` (no `content=true` needed) plus
`departments` and `offices`, which the list endpoint never includes at all.
Verified live (`anthropic`, job `4461450008`): `200` with keys `absolute_url,
data_compliance, internal_job_id, location, metadata, id, updated_at,
requisition_id, title, company_name, first_published, language,
application_deadline, content, departments, offices, ai_disclaimer,
include_ai_disclaimer, ai_opt_out_request_url`.

A nonexistent job id under a valid company (`anthropic/jobs/999999999999`) is
a `404`, mapped to `NOT_FOUND`. A job id that exists but belongs to a
*different* company's board is also a `404` under the wrong company slug —
ids are not globally unique across Greenhouse, only within one company's
board, which is why `detail` requires `--company` too.

### `content`: entity-escaped HTML, not plain HTML

Verified live: the `content` string's own tags are HTML-entity-escaped, e.g.
the wire value looks like `&lt;div class=&quot;content-intro&quot;&gt;&lt;h2&gt;...`
rather than `<div class="content-intro"><h2>...`. A naive strip-real-tags
pass does nothing to text like that — the "tags" are inert text until decoded
once. `cleanContent()` in `cli/src/helpers.ts` decodes entities first (to
reveal genuine `<div>`/`<p>`/`<br>` markup), then runs the usual
block-tag-to-newline + strip-tags + decode-entities-again pipeline (a second
pass is needed because decoding once can reveal further entities, like
`&amp;nbsp;` -> `&nbsp;` -> a literal space).

## Parsing notes

- The response is JSON, so there is no HTML *card* parsing (unlike the
  scraping portals) — the only markup handling is `content`'s double-escaping,
  above.
- Fetch uses an honest User-Agent naming the tool
  (`Mozilla/5.0 (compatible; greenhouse-search-cli/1.0)`), `Accept:
  application/json`, and exponential backoff with jitter on 429/5xx (max 6
  retries, matching the other portal skills in this repo). A connection error
  fails fast with no retry.
- No credentials, no rate-limit response observed in testing (a handful of
  requests against 11 companies), no `Retry-After` header seen — the backoff
  schedule is the same defensive default the other skills use, not tuned
  against an observed limit.
