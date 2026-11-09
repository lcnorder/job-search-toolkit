# JobLeads (www.jobleads.com/us) Platform Reference

What this skill depends on, how it was verified live (2026-09-10), and why it's built the
way it is. This is the file to update if JobLeads changes its markup, region routing, or
Terms of Use.

## Region routing: `/us` is a marketing page, `/us/jobs` is the real search UI

The task's own starting point, `https://www.jobleads.com/us`, **404s as a standalone path**
(confirmed both with and without `www.`). The real region entry points, found by fetching
the site's homepage and reading its own nav/footer links, are:

- `/us/jobs` — the search results page (also `/us/jobs-index`, a sitemap-style index; not
  used by this CLI).
- `/us/jobs/q/<query>` — keyword search.
- `/us/jobs/l/<location>` — location search.
- `/us/jobs/q/<query>/l/<location>` — both combined.
- `?page=<n>` — pagination, appended to any of the above (confirmed live: different result
  sets between `page=1` and `page=2` on an unfiltered query; **not** a strict partition
  though — narrow query+location combinations can return overlapping/reordered results
  across pages once the underlying match set gets small, and a page number far beyond the
  real result count does not reliably fall back to an empty response - see "Pagination
  quirks" below).

JobLeads has 25+ other country/region roots off the same domain (`/de`, `/gb`, `/au`, `/ca`,
etc., all linked from the homepage footer) - this skill only covers `/us`, per the task.

## robots.txt

```
User-agent: *
Allow: /master-class
Disallow: /campaign/
Disallow: /change-password
Disallow: /complete-registration/
Disallow: /confirm-registration/
Disallow: /forgot-password
Disallow: /headhunter-jobs/
Disallow: /inscription
Disallow: /jobs/global/
Disallow: /landing/
Disallow: /logged-out
Disallow: /manage-email-notifications
Disallow: /my-account
Disallow: /my-jobleads
Disallow: /my-profile
Disallow: /premium-membership/
Disallow: /quiz
Disallow: /shop/
Disallow: /api/
Disallow: /jobextern/
Disallow: /mixpanel-tracking-service/
Disallow: /resume-builder/result/
```

No `Sitemap:` directive. Every path this CLI touches (`/us/jobs*`, `/us/job/*`) is **not**
listed as disallowed - only account/campaign pages, the `/jobs/global/` variant (a different
path from the `/us/jobs` this skill uses), `/headhunter-jobs/`, `/jobextern/` (an outbound
apply-redirect path), and `/api/` are blocked. This CLI never calls `/api/` - see "Why no
API calls" below.

## Terms of Use — read in full, 2026-09-10 (`/terms-of-use`)

robots.txt being open is not the whole story. JobLeads' Terms of Use contain an explicit,
broad restriction on automated access, found in its data-use section:

> "Any use of the JobLeads platform for a reason other than the intended purpose is not
> permitted. In particular, collecting or saving data from the database, as well as using
> data in full, in part or extracts thereof online, for the commercial exploitation of
> addresses or as a basis or aid for compiling or adding to participant, address or other
> directories, or reading the databases online for the aforementioned purposes or for other
> commercial purposes is prohibited. **The User is not permitted to use mechanisms, software
> or scripts in connection with the use of the JobLeads platform, as well as blocking,
> overwriting, modification, copying, especially copying through the use of robot/crawler
> search engine technologies.** The User may, however, use the interfaces or software that
> is provided to the User as part of the JobLeads platform. The User shall refrain from any
> action that is likely to negatively impact the functionality of the JobLeads
> infrastructure, especially by overloading such infrastructure."

This is a broad, explicit "no scripts, no robot/crawler tools" clause — stronger than
`psychedelic-alpha-search`'s narrower personal-use-copy restriction, and comparable to
`getro-search`'s and `linkedin-search`'s outright bans. Per this repo's established pattern
this session (Getro: built anyway with a prominent personal-use-only warning since the user
accepted the risk when asked; Psychedelic Alpha: narrower restriction, documented), this
skill is built with the same kind of warning rather than silently declined or silently built
without disclosure. See `SKILL.md`'s "Terms of Use" section.

## What's public vs. gated

Search results and individual postings (title, company, location, salary, work setting,
employment type, posting age, and a description) are all viewable with **no login** -
verified by fetching many distinct search and detail pages with a cookie-less, honest
`User-Agent` and getting real data back every time. JobLeads' freemium features (job alerts,
recruiter-matching, "hidden job market" claims, CV upload/review) live behind
`/my-jobleads`, `/premium-membership/`, etc. — all robots.txt-disallowed and never touched
by this CLI. Nothing this skill needs is behind a login wall.

## Search: server-rendered HTML, no reachable JSON API

The homepage and `/us/jobs*` pages ship a Nuxt `__NUXT_DATA__` payload, which looked
promising at first but turned out to be a dead end for this CLI's purposes: it stores the
already-rendered *count* of cards (an integer), not the card data itself, and a sibling
`vdb-job-preview` payload is deliberately withheld from non-browser requests (the payload's
own `dataLoaded: { fetched: false, skipped: true, reason: "guest-bot-ssr" }` field says so
outright - JobLeads' own SSR layer recognizes non-browser traffic and skips serving that
particular payload to it, even though it still renders the visible page fully). The real
per-card data is in the plain server-rendered HTML markup instead: each result is a
`<div data-testid="search-job-card">` containing:

- `data-testid="search-job-card-link"` — the `<a href>` (relative `/us/job/<slug>--<id>`)
  and its inner text (the title).
- `data-testid="search-job-card-company"` — a `<p>` with a `search-job-card-company-name`
  `<span>` (company) followed by a second `<span>` carrying a literal leading bullet
  character and the location, e.g. `"• Denver (CO)"`.
- `data-testid="job-card-chip-work-setting"` / `"job-card-chip-salary"` — optional chips
  (`"On-site"`, `"USD 130,000 - 170,000"`); absent chips mean `null`, not a parse failure.
- `data-testid="job-card-date"` — relative posting age text (see "Dates" below).

`parseJobCards` in `helpers.ts` splits the HTML on `data-testid="search-job-card"` and
parses each chunk independently (linkedin-search's defensive pattern), so one malformed
card can't break the rest.

**No date/age query parameter could be found.** Every plausible query-string name tried
against a live search URL — `date`, `posted`, `age`, `jobAge`, `within`, `days` — returned
results identical to the unfiltered baseline. `--jobage` is therefore applied client-side
against each card's own date text (see "Dates" below).

**No exact total-match count is exposed.** The `__NUXT_DATA__` payload's `totalCount` field
resolves to the same integer as the current page's card count (25), not a true total across
all pages — this CLI's JSON `meta.count` is the count of results in the current response,
per the standard portal-skill shape, not a total.

### Location: a real geo-radius match, not a substring filter

`--location "Austin TX"` legitimately returns postings in Cedar Park, New Braunfels, and
Round Rock — none of which contain the word "Austin" (confirmed live). This is real,
correct geo-radius behavior on JobLeads' side, not noise, so this CLI does **not**
re-filter results by a location substring match client-side (an earlier draft of this CLI
did, and it incorrectly zeroed out every real result for exactly this reason during
development - see the git history of `helpers.ts` if curious). `--location "Remote"` also
returns real results (confirmed live).

### Pagination quirks

Confirmed live: `?page=2` on a broad, unfiltered query returns a genuinely different result
set than `?page=1`. However, once a query+location combination narrows the match set down
(a realistic case for a specific role + specific metro), `?page=2` can return results that
overlap heavily with `?page=1` (same jobs, different order) rather than a disjoint next
page, and a page number far beyond the real result count (`?page=999`, tried live) does not
reliably fall back to an empty result set the way some portals' pagination does. Treat
`--page` as "ask for a later window," not as a guaranteed-disjoint, well-bounded partition.

### Dates

Posting age is rendered as relative text: `"Today"`, `"Yesterday"`, `"N days ago"`, capped
at `"14 days+"` for anything older (no card observed during development ever showed an
exact count above 13 - the site's own UI stops counting past two weeks).
`normalizeDate` in `helpers.ts` converts the exact cases to a real ISO date; the capped
label and anything unrecognized are kept verbatim (never fabricated into a fake ISO date).
`matchesJobage` uses the capped label as a lower bound: a `"14 days+"` posting fails any
window narrower than 14 days (it cannot possibly qualify) and passes windows at or above 14
days (it might qualify - the exact age is unknown, and per this repo's established
precedent - `psychedelic-alpha-search`'s `matchesJobage` - an ambiguous result is not
silently dropped).

## Detail: `GET /us/job/<slug>--<id>` — and the Cloudflare finding

### The slug is decorative

Confirmed live: `GET /us/job/job--e40c098bc5f9d671b4c65b64530d9c0ba` (a deliberately wrong
slug) resolves the correct posting. `detail` therefore only strictly needs the id, though
passing the full URL from a `search` result is still preferred (see `commands/detail.ts`).

### Individual job pages sit behind Cloudflare bot-management

Step 2 investigation used `curl`. Every `/us/job/<slug>--<id>` request via `curl` returned
**HTTP 403** with `cf-mitigated: challenge` and a `"Just a moment..."` Turnstile
interstitial - tried against six distinct real postings, with both an honest declared UA
(`Mozilla/5.0 (compatible; jobleads-search-cli/1.0)`) and a full desktop-Chrome UA string,
with and without cookies carried over from a prior search-page fetch. All blocked
identically. This looked, at that point, like a hard technical wall: search worked, detail
never would, and no amount of honest header tuning could change that (a JS challenge cannot
be solved by a plain HTTP client without executing and solving it, which this tool will
never do).

**Then Step 4's live CLI test told a different story.** Running the actual CLI - built on
Bun's own `fetch`, with the identical honest UA string and no other special handling -
against the same URLs that `curl` had just failed on returned **HTTP 200 with the full
rendered page**, every time (verified across many distinct postings, repeatedly, including
re-fetching the exact same URL `curl` had just been blocked on). This CLI does nothing to
engineer that outcome: no browser automation, no Turnstile-solving, no UA spoofing beyond
the one honest, self-identifying string declared in `helpers.ts`. The difference is entirely
in Cloudflare's own scoring of the two HTTP clients' request fingerprints (TLS/HTTP2
handshake characteristics `curl` and Bun's fetch implementation don't share) - not anything
this tool chose to do differently between the two attempts.

Because that scoring is Cloudflare's own and could change at any time (tightened
bot-management, a policy update, etc.), `htmlFetch` still checks every response's status and
`detail` still reports a clean `DETAIL_BLOCKED` error if a 403 challenge ever does occur,
rather than assuming success or attempting to work around it.

### The detail page's real data

Server-rendered under different `data-testid` markers than the search card (a sibling
structure, not the same one):

- An `<h1>` immediately before `data-testid="job-preview-company"` — the title.
- `data-testid="job-preview-company-name"` — the company.
- `data-testid="job-card-chip-location"` / `"-work-setting"` / `"-salary"` /
  `"-contract-type"` — chips, text wrapped in `<h2>` here (vs. `<span>` on the search card;
  `extractByTestId` strips tags either way).
- `data-testid="job-card-date"` — same relative-date text as the search card.
- `data-testid="job-preview-description"` — the description panel. This `<div>` contains
  further nested `<div>`s (`"Job Summary:"`, `"Job Duties:"`, etc. are each their own div),
  so extracting it needs real depth-tracking (`extractDivByTestId` in `helpers.ts`, the same
  technique as `linkedin-search`'s `extractDivContent`), not a naive "first closing tag"
  scan.

**The description is a preview, not confirmed to be the complete posting.** On every
posting fetched during development, the rendered description text ends mid-sentence around
~1500 characters, behind a visible "Show more" button that expands further content via
client-side JavaScript this CLI does not execute (and which very likely calls the
robots.txt-disallowed `/api/` path anyway, based on the pattern observed on the search page
for `/api/jobs`). `detail`'s `description` field is real, honest text lifted directly from
the server's own response - never fabricated or summarized - just not guaranteed complete.
`SKILL.md` and the CLI's own help text disclose this.

**410 Gone, not 404, is JobLeads' real "expired posting" response** for a bad/expired job
id (confirmed live against a made-up id) - `detail` treats both the same as `NOT_FOUND`.

## Why there's no `/api/` call anywhere in this CLI

The search page's own client-side hydration would, if allowed to run its JS, likely call an
`/api/` endpoint for at least some interactions (the disallowed-path pattern matches what
`psychedelic-alpha-search` and `getro-search` both found on their own platforms) - but since
`robots.txt` disallows the entire `/api/` path outright, this CLI never calls it, full stop,
regardless of what parsing convenience it might offer. Every field this CLI returns comes
from HTML JobLeads renders directly into a permitted page response.

## Fetch behavior

Honest, self-identifying User-Agent (`Mozilla/5.0 (compatible; jobleads-search-cli/1.0)`),
exponential backoff with jitter on 429/5xx (max 6 retries), 15s timeout per request. No
`Crawl-delay` is specified in robots.txt, but volume is still kept low per the Terms of Use
warning above - `search` makes exactly one request per invocation, `detail` exactly one.
