// Data source: the Getro platform's own board pages (e.g. https://jobs.menlovc.com/jobs),
// server-rendered by Next.js (pages router). Each page embeds a full JSON snapshot of the
// page's Redux store in a <script id="__NEXT_DATA__" type="application/json"> tag - we fetch
// the HTML and regex out that one script block, then JSON.parse it. No HTML card scraping is
// needed: the structured data is already there, we just have to find it.
//
// IMPORTANT - what this CLI deliberately never touches:
//   https://api.getro.com/robots.txt -> "Disallow: /" for all user agents.
// Every Getro board's own client-side JS calls that shared, cross-origin API
// (https://api.getro.com/api/v2/collections/<id>/search/jobs) to do real filtered search and
// to paginate past the first ~20 results (confirmed by inspecting jobs.menlovc.com's own
// network traffic). That host disallows crawling outright, so this CLI never requests it,
// directly or indirectly - it only fetches each board's own /jobs and /companies/*/jobs/*
// pages, which every verified board's robots.txt leaves open (see url-reference.md). This is
// also why `search --page 2` and beyond, and true full-text ranking, are not available here:
// the SSR page always renders the same first ~20 matches for a given query+filter regardless
// of a page/offset parameter (verified - see url-reference.md "Pagination" section).
//
// Getro's own Terms of Service (getro.com/terms) prohibit "crawling," "scraping," or
// "spidering" any page or data of the Services through manual or automated means, even though
// robots.txt on every verified board is fully open. This CLI exists anyway, in the same spirit
// as linkedin-search: keep volume low, personal use only, never commercial or bulk collection.
// See SKILL.md's "Personal use only" section.

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; getro-search-cli/1.0)"

/**
 * Normalize a `--board` value into a bare hostname (e.g. "jobs.menlovc.com"): strips a
 * leading scheme, a trailing slash/path, and surrounding whitespace. Returns null for an
 * empty or clearly-invalid value (no dot, contains a space).
 */
export function normalizeBoard(input: string | undefined): string | null {
  if (!input) return null
  let host = input.trim().replace(/^https?:\/\//i, "")
  host = host.split("/")[0]
  if (!host || !host.includes(".") || /\s/.test(host)) return null
  return host.toLowerCase()
}

export function boardBaseUrl(board: string): string {
  return `https://${board}`
}

/** Fetch a Getro board page with exponential backoff on 429/5xx. Returns null on a 404. */
export async function htmlFetch(url: string): Promise<string | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(`could not reach ${url} (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("request failed after max retries")
}

/**
 * Extract and parse the Next.js `__NEXT_DATA__` JSON blob every genuine Getro board page
 * embeds. Its absence means either the page is a 404/error page (caller should already have
 * handled that via htmlFetch's null return) or the host is not actually running the Getro
 * platform (see SKILL.md's "Verified boards" section - several superficially similar VC
 * "jobs at our portfolio" sites are NOT Getro and this CLI does not support them).
 */
export function extractNextData(html: string): unknown {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  )
  if (!m) {
    throw new Error(
      "could not find the __NEXT_DATA__ payload on this page - the board may not be running the genuine Getro platform, or its markup has changed (see url-reference.md)",
    )
  }
  try {
    return JSON.parse(m[1])
  } catch {
    throw new Error("found __NEXT_DATA__ but could not parse it as JSON")
  }
}

// ---- Wire shapes (the fields this skill reads; the real payload carries more) ----

export interface GetroOrganization {
  id: number
  name: string
  slug: string
  stage?: string | null
  headCount?: number | null
  industryTags?: (string | { description: string })[]
  logoUrl?: string | null
}

/** A job as it appears in a /jobs search page's `initialState.jobs.found` array. */
export interface GetroJobSummary {
  id: number
  title: string
  organization: GetroOrganization
  locations: string[]
  searchableLocations?: string[]
  workMode?: string | null
  seniority?: string | null
  skills?: string[]
  url: string // the external ATS posting URL
  slug: string
  createdAt: number | null // epoch seconds
  compensationPublic?: boolean
  compensationAmountMinCents?: number | null
  compensationAmountMaxCents?: number | null
  compensationCurrency?: string | null
  compensationPeriod?: string | null
}

/** A job as it appears on its own /companies/*\/jobs/* detail page's `currentJob`. */
export interface GetroJobDetail {
  id: number
  title: string
  organization: GetroOrganization & { domain?: string | null; description?: string | null }
  locations: { name: string }[]
  url: string
  slug: string
  postedAt: string | null // ISO 8601
  closedAt: string | null
  status: string | null // "active" | "closed" | ...
  description: string | null // raw HTML
  jobFunctions?: { id: number; name: string }[]
  employmentTypes?: string[]
  compensationPublic?: boolean
  compensationAmountMinCents?: number | null
  compensationAmountMaxCents?: number | null
  compensationCurrency?: string | null
  compensationPeriod?: string | null
}

/** The portal-skill contract's search-result shape, plus a permitted superset of extras. */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  description: string | null
  company_slug: string | null
  work_mode: string | null
  seniority: string | null
  skills: string[]
  salary: string | null
}

export interface JobDetailResult extends Omit<JobResult, "description"> {
  status: string | null
  job_functions: string[]
  employment_types: string[]
  description: string | null
}

function formatSalary(
  minCents: number | null | undefined,
  maxCents: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined,
): string | null {
  if (minCents == null && maxCents == null) return null
  const cur = currency ? `${currency} ` : ""
  const per = period && period !== "period_not_defined" ? ` / ${period}` : ""
  const fmt = (c: number) => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })
  if (minCents != null && maxCents != null && minCents !== maxCents) {
    return `${cur}${fmt(minCents)}-${fmt(maxCents)}${per}`
  }
  return `${cur}${fmt(minCents ?? maxCents!)}${per}`
}

/** Reshape a search-page job summary into the contract result shape. */
export function toResult(j: GetroJobSummary): JobResult {
  return {
    id: String(j.id),
    title: j.title || "(untitled)",
    company: j.organization?.name || null,
    location: j.locations?.length ? j.locations.join(", ") : j.searchableLocations?.[0] || null,
    date: j.createdAt ? new Date(j.createdAt * 1000).toISOString() : null,
    url: j.url,
    description: null, // not present on the search page; fetch `detail` for the full text
    company_slug: j.organization?.slug || null,
    work_mode: j.workMode || null,
    seniority: j.seniority || null,
    skills: j.skills || [],
    salary: formatSalary(
      j.compensationAmountMinCents,
      j.compensationAmountMaxCents,
      j.compensationCurrency,
      j.compensationPeriod,
    ),
  }
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
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

/** Strip a Getro job description's HTML into readable prose. Null for empty input. */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

function industryTagNames(tags: GetroOrganization["industryTags"]): string[] {
  if (!tags) return []
  return tags.map((t) => (typeof t === "string" ? t : t.description)).filter(Boolean)
}

/** Reshape a detail-page `currentJob` into the contract detail shape. */
export function toDetailResult(j: GetroJobDetail): JobDetailResult {
  return {
    id: String(j.id),
    title: j.title || "(untitled)",
    company: j.organization?.name || null,
    location: j.locations?.length ? j.locations.map((l) => l.name).join(", ") : null,
    date: j.postedAt,
    url: j.url,
    company_slug: j.organization?.slug || null,
    work_mode: null, // not present on the detail payload; see search results for work_mode
    seniority: null,
    skills: industryTagNames(j.organization?.industryTags),
    salary: formatSalary(
      j.compensationAmountMinCents,
      j.compensationAmountMaxCents,
      j.compensationCurrency,
      j.compensationPeriod,
    ),
    status: j.status,
    job_functions: (j.jobFunctions || []).map((f) => f.name),
    employment_types: j.employmentTypes || [],
    description: cleanHtml(j.description),
  }
}

/**
 * Build the base64 `filter` query param Getro's own SSR search page reads. Confirmed working
 * keys (see url-reference.md "Confirmed filter facets"): `searchable_locations` (array of
 * free-text location strings), `seniority` (array of enum strings, e.g. "senior",
 * "mid_senior"), `work_mode` (array, e.g. "remote", "on_site"). `extra` merges in any
 * additional key=>values the caller supplies via --facet (unverified beyond the three above -
 * Getro returns zero results for a facet key/value it does not recognize rather than an
 * error, so a typo fails silently at the data level, not the HTTP level).
 */
export function buildFilterParam(opts: {
  locations?: string[]
  seniority?: string[]
  workMode?: string[]
  extra?: Record<string, string[]>
}): string | null {
  const filter: Record<string, string[]> = {}
  if (opts.locations?.length) filter.searchable_locations = opts.locations
  if (opts.seniority?.length) filter.seniority = opts.seniority
  if (opts.workMode?.length) filter.work_mode = opts.workMode
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      if (v.length) filter[k] = v
    }
  }
  if (Object.keys(filter).length === 0) return null
  return Buffer.from(JSON.stringify(filter), "utf-8").toString("base64")
}

/** Map a --remote value to Getro's work_mode enum. */
export function normalizeWorkMode(mode: string): string {
  const m = mode.toLowerCase()
  if (m === "onsite" || m === "on-site" || m === "on_site") return "on_site"
  return m // "remote", "hybrid", or passed through as-is
}

/** Extract a numeric job id from a bare id or a /companies/<slug>/jobs/<id>-<slug> URL. */
export function normalizeJobId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const m = trimmed.match(/\/jobs\/(\d+)(?:-|$|[/?#])/)
  if (m) return m[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return null
}

/** Extract a board hostname from a full https://jobs.<board>/... URL, if present. */
export function boardFromUrl(input: string): string | null {
  const m = input.trim().match(/^https?:\/\/([^/]+)\//)
  return m ? m[1].toLowerCase() : null
}
