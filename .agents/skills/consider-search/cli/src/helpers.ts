// Data source: the Consider platform's own board pages (e.g.
// https://careers.foresitecapital.com/jobs), server-rendered React. Each page embeds a full
// JSON snapshot in `window.serverInitialData = {...};` - including a CSRF token and the
// board's internal id - which the board's own client-side JS immediately re-POSTs to a
// same-origin API, `POST /api-boards/search-jobs`, to render the actual job list (the SSR
// HTML itself contains NO job data - just a loading spinner - unlike Getro's __NEXT_DATA__
// pages, which embed jobs directly). This CLI reproduces that same two-step handshake: GET
// the page once per invocation to mint a session (Set-Cookie: session/session.sig) and read
// the matching CSRF token, then POST the search with that cookie + token pair.
//
// IMPORTANT - everything this CLI touches is same-origin (the board's own hostname). There is
// no separate cross-origin API host to worry about here (unlike Getro's api.getro.com), and
// robots.txt on every Consider board investigated (careers.foresitecapital.com,
// jobs.costanoavc.com, careers.oneragtime.com, careers.setventures.com,
// careers.radiancapital.com - byte-for-byte identical on all five) is `Allow: /` for all user
// agents except LinkedInBot specifically - it does not disallow /api-boards/ on any of them.
// The session/CSRF handshake below was also confirmed live to be platform-wide rather than
// scoped to the board that minted it - see url-reference.md's "Session handshake is shared,
// not per-board" section - which is why fetchSession() always re-fetches both the session AND
// that same board's own board.id together, per call, rather than caching either separately.
//
// Consider's own Terms of Service (https://consider.com/legal/terms), read in full during
// investigation, prohibit "any robot, spider, scraper, or other automated means to access the
// Service for any purpose without our express written permission" - open robots.txt,
// prohibitive ToS, exactly the same shape as the getro-search skill's situation. This CLI
// exists anyway, in the same spirit: keep volume low, personal use only, never commercial or
// bulk collection. See SKILL.md's "Personal use only" section.

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; consider-search-cli/1.0)"

/**
 * Normalize a `--board` value into a bare hostname (e.g. "careers.foresitecapital.com"):
 * strips a leading scheme, a trailing slash/path, and surrounding whitespace. Returns null
 * for an empty or clearly-invalid value (no dot, contains a space).
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

/** Fetch with exponential backoff on 429/5xx. Returns the raw Response (caller reads it). */
async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
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
    return response
  }
  throw new Error("request failed after max retries")
}

// ---- serverInitialData extraction ----

/**
 * Scan forward from a `{` at `startIdx` and return the substring up to its matching `}`,
 * respecting string literals (so a brace inside a quoted string doesn't throw off the
 * depth count). Returns null if the braces never balance before the string ends.
 */
function extractBalancedJson(text: string, startIdx: number): string | null {
  if (text[startIdx] !== "{") return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === "\\") escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return text.slice(startIdx, i + 1)
    }
  }
  return null
}

export interface ConsiderSession {
  csrfToken: string
  cookieHeader: string
  boardId: string
}

/** The subset of `window.serverInitialData` this CLI reads. */
interface ServerInitialData {
  csrfToken?: string
  board?: { id?: string; isParent?: boolean }
}

/**
 * GET a board page, extract the embedded `window.serverInitialData` blob (CSRF token +
 * internal board id) and the session cookies the response set, in one round trip. Every
 * subsequent `/api-boards/*` call in this invocation reuses this session - Consider's
 * POST endpoints reject a CSRF token that doesn't match the session that minted it.
 */
export async function fetchSession(board: string): Promise<ConsiderSession> {
  const response = await fetchRetry(`${boardBaseUrl(board)}/jobs`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  })
  if (response.status === 404) {
    throw new BoardNotFoundError()
  }
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${response.statusText}`)
  }
  const html = await response.text()

  const marker = "window.serverInitialData = "
  const idx = html.indexOf(marker)
  if (idx === -1) {
    throw new Error(
      "could not find window.serverInitialData on this page - this board may not be running the genuine Consider platform, or its markup has changed (see url-reference.md)",
    )
  }
  const jsonStr = extractBalancedJson(html, idx + marker.length)
  if (!jsonStr) {
    throw new Error("found window.serverInitialData but could not locate a balanced JSON object")
  }
  let data: ServerInitialData
  try {
    data = JSON.parse(jsonStr)
  } catch {
    throw new Error("found window.serverInitialData but could not parse it as JSON")
  }
  if (!data.csrfToken || !data.board?.id) {
    throw new Error(
      "window.serverInitialData was present but missing csrfToken or board.id - this board may not be running the genuine Consider platform (see url-reference.md)",
    )
  }

  const cookieHeader = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")

  return { csrfToken: data.csrfToken, cookieHeader, boardId: data.board.id }
}

export class BoardNotFoundError extends Error {
  constructor() {
    super("board was not found (404) - check the hostname")
  }
}

// ---- Search ----

/** `POST /api-boards/search-jobs` request body shape. */
export interface SearchQuery {
  keywords?: string
  locations?: string[]
  departments?: string[]
  remoteOnly?: boolean
  postedSince?: string
  [extra: string]: unknown
}

export interface SearchResponse {
  jobs: ConsiderJob[]
  total: number
  meta: { sequence?: string }
}

/**
 * POST a search-jobs query. `sequence` (from a previous response's `meta.sequence`) resumes
 * a cursor-based pagination - see url-reference.md's "Pagination" section for why `from`/
 * `page` offsets were tried and found to do nothing, while `sequence` genuinely advances.
 */
export async function searchJobs(
  board: string,
  session: ConsiderSession,
  query: SearchQuery,
  size: number,
  sequence?: string,
): Promise<SearchResponse> {
  const body = {
    meta: sequence ? { size, sequence } : { size },
    board: { id: session.boardId, isParent: true },
    query,
    grouped: false,
  }
  const response = await fetchRetry(`${boardBaseUrl(board)}/api-boards/search-jobs`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
      Cookie: session.cookieHeader,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`search request failed: ${response.status} ${response.statusText}`)
  }
  const parsed = (await response.json()) as {
    error?: string
    errors?: { message?: string }[]
    jobs?: ConsiderJob[]
    total?: number
    meta?: { sequence?: string }
  }
  if (parsed.error) {
    throw new Error(`search rejected: ${parsed.error} (session/CSRF handshake likely stale)`)
  }
  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(`search returned an error: ${parsed.errors.map((e) => e.message).join("; ")}`)
  }
  return { jobs: parsed.jobs ?? [], total: parsed.total ?? 0, meta: parsed.meta ?? {} }
}

// ---- Job detail (Consider-hosted jobs only - see SKILL.md) ----

export interface ConsiderJobDetail extends ConsiderJob {
  description?: string | null
}

/**
 * GET a single job by id. Only returns data for jobs Consider hosts directly
 * (`considerHosted: true` in search results) - the large majority of jobs on every board
 * investigated route straight to an external ATS (Lever, Greenhouse, etc.) and this endpoint
 * returns an empty body for those, by design of the platform, not a bug in this CLI. See
 * SKILL.md's "Why `detail` often can't fetch a description" section.
 */
export async function fetchJobDetail(
  board: string,
  session: ConsiderSession,
  jobId: string,
  companyId: string,
): Promise<ConsiderJobDetail | null> {
  const url = `${boardBaseUrl(board)}/api-boards/jobs/${encodeURIComponent(jobId)}?companyId=${encodeURIComponent(companyId)}`
  const response = await fetchRetry(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Cookie: session.cookieHeader,
    },
  })
  if (!response.ok) {
    throw new Error(`detail request failed: ${response.status} ${response.statusText}`)
  }
  const parsed = (await response.json()) as { job?: ConsiderJobDetail }
  return parsed.job ?? null
}

// ---- Wire shapes (the fields this skill reads; the real payload carries more) ----

interface LabeledValue {
  id?: string
  label?: string
  value?: string
}

interface ConsiderSalary {
  period?: LabeledValue
  minValue?: number | null
  maxValue?: number | null
  currency?: LabeledValue
}

/** A job as returned by `/api-boards/search-jobs`. */
export interface ConsiderJob {
  jobId: string
  title: string
  companyId?: string | null // display name, e.g. "Delfi Diagnostics" - NOT url-safe
  companySlug?: string | null // e.g. "delfi-diagnostics"
  companyName?: string | null
  companyDomain?: string | null
  considerHosted?: boolean
  departments?: string[]
  locations?: string[]
  remote?: boolean
  hybrid?: boolean
  jobSeniorities?: LabeledValue[]
  jobFunctions?: LabeledValue[]
  requiredSkills?: LabeledValue[]
  preferredSkills?: LabeledValue[]
  salary?: ConsiderSalary
  timeStamp?: string | null // ISO 8601
  url?: string
  applyUrl?: string
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

function formatSalary(salary: ConsiderSalary | undefined): string | null {
  if (!salary || (salary.minValue == null && salary.maxValue == null)) return null
  const cur = salary.currency?.value ? `${salary.currency.value} ` : ""
  const per = salary.period?.value && salary.period.value !== "period_not_defined" ? ` / ${salary.period.value}` : ""
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 })
  const { minValue, maxValue } = salary
  if (minValue != null && maxValue != null && minValue !== maxValue) {
    return `${cur}${fmt(minValue)}-${fmt(maxValue)}${per}`
  }
  return `${cur}${fmt(minValue ?? maxValue!)}${per}`
}

function workMode(j: ConsiderJob): string | null {
  if (j.remote) return "remote"
  if (j.hybrid) return "hybrid"
  if (j.remote === false && j.hybrid === false) return "on_site"
  return null
}

/**
 * Search results only ever carry `jobId` + `companyId`/`companySlug` as two separate fields -
 * there is no single natural-language job id in the wire format. `detail` needs BOTH to look
 * a job up, so this CLI encodes them together as one opaque id (`<companySlug>::<jobId>`),
 * matching the contract's "pass an id straight from search into detail" convention without
 * requiring a separate `--company` flag on every `detail` call. See url-reference.md.
 */
export function encodeCompoundId(job: ConsiderJob): string {
  const slug = job.companySlug || job.companyId || "unknown"
  return `${slug}::${job.jobId}`
}

export function decodeCompoundId(id: string): { companySlug: string; jobId: string } | null {
  const idx = id.indexOf("::")
  if (idx <= 0 || idx === id.length - 2) return null
  return { companySlug: id.slice(0, idx), jobId: id.slice(idx + 2) }
}

/** Reshape a search-result job into the contract result shape. */
export function toResult(j: ConsiderJob): JobResult {
  return {
    id: encodeCompoundId(j),
    title: j.title || "(untitled)",
    company: j.companyName || j.companyId || null,
    location: j.locations?.length ? j.locations.join(", ") : null,
    date: j.timeStamp || null,
    url: j.applyUrl || j.url || "",
    description: null, // not present on search results - see fetchJobDetail's caveats
    company_slug: j.companySlug || null,
    work_mode: workMode(j),
    seniority: j.jobSeniorities?.length ? j.jobSeniorities.map((s) => s.label).filter(Boolean).join(", ") : null,
    skills: (j.requiredSkills || []).map((s) => s.label).filter((s): s is string => Boolean(s)),
    salary: formatSalary(j.salary),
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

/** Strip a Consider job description's HTML into readable prose. Null for empty input. */
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
