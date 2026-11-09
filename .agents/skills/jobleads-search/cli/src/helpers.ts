// Data source: www.jobleads.com — an international freemium job-search aggregator. The
// US region lives at /us (a marketing/landing surface, NOT the search UI — /us itself
// 404s as a standalone path) with real search results server-rendered (Vue/Nuxt SSR) at
// /us/jobs, /us/jobs/q/<query>, /us/jobs/l/<location>, and /us/jobs/q/<query>/l/<location>.
// robots.txt permits all of these paths (only /jobs/global/, /headhunter-jobs/, /api/,
// /jobextern/ and a handful of account/campaign paths are disallowed - none of which this
// CLI touches). No login is required to view search results, individual postings, or any
// field captured here.
//
// Note on `detail` and Cloudflare: individual job pages (/us/job/<slug>--<id>) sit behind
// Cloudflare bot-management, and curl-based investigation during Step 2 was consistently
// blocked with a Turnstile JS challenge (HTTP 403, `cf-mitigated: challenge`) regardless of
// User-Agent string. Bun's own `fetch`, run with the exact same honest, self-identifying
// UA and no other special handling, was NOT challenged - verified live across many
// distinct postings (HTTP 200 every time). This CLI does nothing to engineer that: no
// browser automation, no Turnstile-solving, no UA spoofing beyond the one honest string
// declared below. It is Cloudflare's own scoring of the requesting client, not a bypass
// this tool performs - see url-reference.md for the full trail. Because that scoring could
// change at any time, `detail` still checks for and cleanly reports a 403 challenge instead
// of assuming success.

export const BASE_URL = "https://www.jobleads.com"
const DAY_MS = 86400000

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; jobleads-search-cli/1.0)"

export interface FetchResult {
  status: number
  body: string
  cfChallenge: boolean
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns status/body/cfChallenge instead
 * of throwing on 403, so callers (specifically `detail`) can distinguish an honest
 * Cloudflare bot-challenge block from a real error and report it cleanly. */
export async function htmlFetch(url: string): Promise<FetchResult> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return { status: 404, body: "", cfChallenge: false }
    // A Cloudflare Turnstile challenge always answers with 403 (the `cf-mitigated:
    // challenge` header confirms it when present, but the status code alone is enough to
    // treat this as "blocked, do not retry" - retrying a JS challenge with a plain fetch
    // can never succeed, and hammering it would be poor citizenship).
    const cfChallenge = response.status === 403
    const body = await response.text()
    return { status: response.status, body, cfChallenge }
  }
  throw new Error("Request failed after max retries")
}

/** Convenience wrapper for the search path, which is never Cloudflare-challenged in
 * practice (verified across many live requests during investigation) - callers that don't
 * need to distinguish a challenge just want the text. */
export async function textFetch(url: string): Promise<string> {
  const result = await htmlFetch(url)
  if (result.status >= 400 && result.status !== 404) {
    throw new Error(`Request failed: ${result.status}`)
  }
  return result.body
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not `fromCharCode`) so
 * supplementary-plane code points (emoji etc.) decode correctly, and drops out-of-range
 * values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string | null {
  const text = decodeHtmlEntities(stripTags(html))
  return text || null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  workSetting: string | null
  salary: string | null
}

/** Build the /us/jobs search URL from optional query/location and a 1-indexed page. */
export function buildSearchUrl(query: string | undefined, location: string | undefined, page: number): string {
  let path = `${BASE_URL}/us/jobs`
  if (query && query.trim()) path += `/q/${encodeURIComponent(query.trim())}`
  if (location && location.trim()) path += `/l/${encodeURIComponent(location.trim())}`
  return page > 1 ? `${path}?page=${page}` : path
}

/** Extract the text content of the element carrying `data-testid="<testid>"`, from the end
 * of its own opening tag to its matching closing tag - used for the small chip/label
 * fields (date, work-setting, salary) that wrap their real text in several layers of Vue
 * hydration-comment markers (`<!--[-->text<!--]-->`) and sometimes an extra nested `<span>`. */
function extractByTestId(chunk: string, testid: string, closeTag: "span" | "div" = "span"): string | null {
  const idx = chunk.indexOf(`data-testid="${testid}"`)
  if (idx === -1) return null
  const openEnd = chunk.indexOf(">", idx)
  if (openEnd === -1) return null
  const close = chunk.indexOf(`</${closeTag}>`, openEnd)
  if (close === -1) return null
  return clean(chunk.slice(openEnd + 1, close))
}

/**
 * Parse the server-rendered search-results HTML into job cards. We split on
 * `data-testid="search-job-card"` (one per result) and parse each chunk independently so
 * one malformed card cannot break the rest - the same defensive pattern linkedin-search
 * uses for its own card markup.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split('data-testid="search-job-card"').slice(1)

  for (const chunk of chunks) {
    const linkMatch = chunk.match(/data-testid="search-job-card-link"[^>]*href="([^"]+)"[^>]*>([^<]*)</)
    if (!linkMatch) continue
    const href = decodeHtmlEntities(linkMatch[1])
    const title = clean(linkMatch[2])
    if (!title) continue

    const slugMatch = href.match(/\/us\/job\/([^/?]+)$/)
    if (!slugMatch) continue
    const slugParts = slugMatch[1].split("--")
    const id = slugParts[slugParts.length - 1]
    if (!id) continue

    let company: string | null = null
    let location: string | null = null
    const companyBlock = chunk.match(/data-testid="search-job-card-company"[^>]*>([\s\S]*?)<\/p>/)
    if (companyBlock) {
      const nameMatch = companyBlock[1].match(/search-job-card-company-name"[^>]*>([^<]*)</)
      company = nameMatch ? clean(nameMatch[1]) : null
      // The location is the second <span> in the block - a "company name" span, then a
      // "• location" span (the raw markup carries a literal leading bullet character,
      // "• Denver (CO)" - stripped below).
      const spanTexts = [...companyBlock[1].matchAll(/data-v-[a-z0-9]+>([^<]*)<\/span>/g)].map((m) => clean(m[1]))
      const nonEmpty = spanTexts.filter((t): t is string => !!t)
      const rawLocation = nonEmpty.length > 1 ? nonEmpty[nonEmpty.length - 1] : null
      location = rawLocation ? rawLocation.replace(/^[•\s]+/, "").trim() || null : null
    }

    const date = extractByTestId(chunk, "job-card-date")
    const workSetting = extractByTestId(chunk, "job-card-chip-work-setting", "div")
    const salary = extractByTestId(chunk, "job-card-chip-salary", "div")

    results.push({
      id,
      title,
      company,
      location,
      date: normalizeDate(date),
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
      workSetting,
      salary,
    })
  }

  return results
}

/** JobLeads renders posting dates as relative text ("Today", "Yesterday", "N days ago"),
 * capped at "14 days+" for anything older (the site itself stops counting past 14 days -
 * confirmed live: no card in any fetched result set showed an exact count above 13). Exact
 * cases are converted to a real ISO date; the capped case and anything unrecognized are
 * passed through as-is (never silently dropped) since we cannot compute an exact date for
 * them - see matchesJobage below for how the capped case is used as a lower bound. */
export function normalizeDate(raw: string | null, now: Date = new Date()): string | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  if (t === "today" || t === "just posted" || t === "new") return now.toISOString().slice(0, 10)
  if (t === "yesterday") return new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10)
  const agoMatch = t.match(/^(\d+)\s*days?\s*ago$/)
  if (agoMatch) return new Date(now.getTime() - parseInt(agoMatch[1], 10) * DAY_MS).toISOString().slice(0, 10)
  return raw.trim() // e.g. "14 days+" - kept verbatim, not fabricated into a fake ISO date
}

/** Client-side "posted within N days" filter. JobLeads exposes no server-side date/age
 * parameter this CLI could find (every guessed query-string name - date, posted, age,
 * jobAge, within, days - returned identical results to the unfiltered baseline during
 * investigation; see url-reference.md), so --jobage is applied here against the normalized
 * date field. An ISO date filters exactly; the capped "14 days+" label only tells us the
 * posting is *at least* 14 days old, so it is excluded whenever the requested window is
 * narrower than 14 days (it cannot possibly qualify) and included otherwise (it might
 * qualify; we cannot disprove it, and the contract's own precedent - see
 * psychedelic-alpha-search's matchesJobage - is to not silently drop ambiguous results). */
export function matchesJobage(dateField: string | null, jobageDays: number | undefined): boolean {
  if (!jobageDays || jobageDays >= 9999) return true
  if (!dateField) return true
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateField)) {
    const posted = new Date(dateField).getTime()
    if (Number.isNaN(posted)) return true
    const ageDays = (Date.now() - posted) / DAY_MS
    return ageDays <= jobageDays
  }
  const capped = dateField.match(/^(\d+)\s*days?\+$/i)
  if (capped) {
    const lowerBound = parseInt(capped[1], 10)
    return lowerBound <= jobageDays
  }
  return true
}

// ---------------------------------------------------------------------------------------
// Detail-page parsing. The posting's real data lives under `data-testid="job-preview-*"`
// and `data-testid="job-card-chip-*"` markers in the same server-rendered page - a
// differently-shaped but sibling structure to the search-card markup above (e.g. chip text
// sits in an <h2> here instead of a <span>, and there's a dedicated location chip that the
// search card doesn't have - the search card folds location into the company line instead).
// ---------------------------------------------------------------------------------------

export interface JobDetail {
  title: string
  company: string | null
  location: string | null
  workSetting: string | null
  salary: string | null
  employmentType: string | null
  date: string | null
  description: string | null
}

/** Depth-tracking extraction for a `<div data-testid="...">` that itself contains further
 * nested `<div>`s (the description block does - "Job Summary:", "Job Duties:" etc. are each
 * their own nested div) - `extractByTestId`'s simple indexOf-to-first-closing-tag approach
 * would truncate at the first nested `</div>` instead of the real end. Same depth-counting
 * technique as linkedin-search's `extractDivContent`, anchored on a `data-testid` instead
 * of a class name. */
function extractDivByTestId(html: string, testid: string): string | null {
  const attrIdx = html.indexOf(`data-testid="${testid}"`)
  if (attrIdx === -1) return null
  const tagStart = html.lastIndexOf("<div", attrIdx)
  if (tagStart === -1) return null
  const openEnd = html.indexOf(">", tagStart)
  if (openEnd === -1) return null

  let i = openEnd + 1
  let depth = 1
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return html.slice(openEnd + 1, i - 6)
}

/** Raw description HTML -> readable plain text, paragraph/list/line breaks preserved. */
function cleanDescriptionHtml(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const stripped = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
  return stripped
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

/**
 * Parse a `/us/job/<slug>--<id>` detail page. Returns null when the page carries none of
 * the expected `job-preview-company` markers - the signal that this response is not a real
 * rendered posting (a Cloudflare challenge page, a redirect target, a genuinely removed
 * listing, or a future markup change), so callers treat null as NOT_FOUND rather than
 * emitting garbage fields.
 *
 * The description is whatever the server actually renders inline for the "Job description"
 * panel - on every live posting fetched during development this was a preview (~1500
 * characters, ending mid-sentence) behind a "Show more" control that expands further via
 * client-side JS this CLI does not run. It is real, honest text lifted straight from the
 * page (not a fabricated summary), just not guaranteed to be the complete posting - see
 * SKILL.md and url-reference.md.
 */
export function parseDetailPage(html: string): JobDetail | null {
  const companyIdx = html.indexOf('data-testid="job-preview-company"')
  if (companyIdx === -1) return null

  const before = html.slice(Math.max(0, companyIdx - 1000), companyIdx)
  const h1Matches = [...before.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)]
  const title = h1Matches.length ? clean(h1Matches[h1Matches.length - 1][1]) : null

  const companyWindow = html.slice(companyIdx, companyIdx + 400)
  const companyNameMatch = companyWindow.match(/company-name"[^>]*>([^<]*)</)
  const company = companyNameMatch ? clean(companyNameMatch[1]) : null

  const location = extractByTestId(html, "job-card-chip-location", "div")
  const workSetting = extractByTestId(html, "job-card-chip-work-setting", "div")
  const salary = extractByTestId(html, "job-card-chip-salary", "div")
  const employmentType = extractByTestId(html, "job-card-chip-contract-type", "div")
  const date = extractByTestId(html, "job-card-date")

  const descriptionHtml = extractDivByTestId(html, "job-preview-description")
  const description = descriptionHtml ? cleanDescriptionHtml(descriptionHtml) || null : null

  return {
    title: title || "(untitled)",
    company,
    location,
    workSetting,
    salary,
    employmentType,
    date: normalizeDate(date),
    description,
  }
}
