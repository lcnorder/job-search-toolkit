// Data source: Greenhouse's public "Job Board API" (boards-api.greenhouse.io),
// unauthenticated JSON, no API key. Unlike freehire (one aggregator) or
// linkedin-search (one HTML site), Greenhouse hosts hundreds of independent
// company boards under one API — every call is scoped by a `--company` slug
// (e.g. `anthropic`, `stripe`, `figma`) supplied by the caller, never fixed.
//
// robots.txt at boards-api.greenhouse.io only disallows /embed/ — the /v1/boards/*
// paths used here are unrestricted (verified live).

export const BASE_URL = "https://boards-api.greenhouse.io"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; greenhouse-search-cli/1.0)"

/**
 * GET JSON from the Greenhouse Job Board API. Retries 429/5xx (transient
 * server states) with exponential backoff + jitter (max 6 retries); returns
 * `null` on a 404 (unknown company slug, or unknown job id within a company).
 * A connection failure fails fast with a clear message — no retry, so an
 * outage degrades this source quickly rather than hanging the caller.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const url = `${BASE_URL}${path}`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(
        `could not reach the Greenhouse Job Board API at ${BASE_URL} (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Greenhouse API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null

    const body = (await response.json().catch(() => null)) as T | null
    if (!response.ok) {
      throw new Error(`Greenhouse API request failed: ${response.status} ${response.statusText}`)
    }
    if (body === null) throw new Error("Greenhouse API returned an unparseable response body")
    return body
  }
  throw new Error("Greenhouse API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** One metadata facet on a Greenhouse job (company-defined; wildly variable — see url-reference.md). */
export interface GreenhouseMetadata {
  id: number
  name: string
  value: string | number | string[] | null
  value_type: string
}

/** A department reference as it appears on a job (list carries none; detail carries them). */
export interface GreenhouseDepartment {
  id: number
  name: string
}

/** An office reference as it appears on job detail. */
export interface GreenhouseOffice {
  id: number
  name: string
  location?: string | null
}

/**
 * A Greenhouse job as returned by the Job Board API. The list endpoint
 * (`GET /v1/boards/<company>/jobs`) omits `content`/`departments`/`offices`
 * unless `content=true` is passed (content only); the single-job endpoint
 * (`GET /v1/boards/<company>/jobs/<id>`) always includes all of them.
 */
export interface GreenhouseJob {
  id: number
  title: string
  updated_at: string
  first_published: string | null
  absolute_url: string
  location: { name: string } | null
  metadata: GreenhouseMetadata[] | null
  requisition_id: string | null
  internal_job_id: number
  company_name: string
  language?: string
  application_deadline?: string | null
  content?: string
  departments?: GreenhouseDepartment[]
  offices?: GreenhouseOffice[]
}

/** The list endpoint's envelope: `{ "jobs": [...] }`. */
export interface JobsListResponse {
  jobs: GreenhouseJob[]
}

/**
 * A search result in the portal-skill contract shape. `id` is the numeric
 * Greenhouse job id (what `detail <id> --company <slug>` consumes) and `date`
 * is `first_published` (see url-reference.md for why, over `updated_at`).
 * Missing values are `null`, never omitted. The extra fields are a permitted
 * superset of the contract's minimum.
 */
export interface JobResult {
  id: number
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  updated_at: string | null
  location_type: string | null
  requisition_id: string | null
  description: string | null
}

/** A job detail: the search result plus departments/offices/metadata and a cleaned description. */
export interface JobDetailResult extends JobResult {
  departments: string[]
  offices: string[]
  metadata: Record<string, string>
}

/** The "Location Type" metadata facet (e.g. On-Site/Remote/Hybrid), when the company sets it — not universal. */
function locationType(job: GreenhouseJob): string | null {
  const entry = (job.metadata ?? []).find((m) => m.name === "Location Type")
  if (!entry || entry.value == null) return null
  return Array.isArray(entry.value) ? entry.value.join(", ") : String(entry.value)
}

/** Reshape a Greenhouse job into the contract search-result fields. `description` is `cleanContent(job.content)` when content was fetched, else `null`. */
export function toResult(job: GreenhouseJob, company: string): JobResult {
  return {
    id: job.id,
    title: job.title || "(untitled)",
    company: job.company_name || company,
    location: job.location?.name || null,
    date: job.first_published || null,
    url: job.absolute_url,
    updated_at: job.updated_at || null,
    location_type: locationType(job),
    requisition_id: job.requisition_id || null,
    description: job.content !== undefined ? cleanContent(job.content) : null,
  }
}

/** Reshape a Greenhouse job into the detail result (adds departments/offices/metadata; description always populated). */
export function toDetail(job: GreenhouseJob, company: string): JobDetailResult {
  const metadata: Record<string, string> = {}
  for (const m of job.metadata ?? []) {
    if (m.value == null) continue
    metadata[m.name] = Array.isArray(m.value) ? m.value.join(", ") : String(m.value)
  }
  return {
    ...toResult(job, company),
    description: cleanContent(job.content),
    departments: (job.departments ?? []).map((d) => d.name),
    offices: (job.offices ?? []).map((o) => o.name),
    metadata,
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
    .replace(/&(mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo|trade|copy|reg|deg|bull|middot);/g, (_, name) => NAMED_ENTITIES[name])
}

// Common named entities beyond the handful above (verified needed live: a
// Greenhouse posting's compensation line used &mdash; for an em dash, which a
// narrower table would leave visible as literal "&mdash;" in plain-text output).
const NAMED_ENTITIES: Record<string, string> = {
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  trade: "™",
  copy: "©",
  reg: "®",
  deg: "°",
  bull: "•",
  middot: "·",
}

/**
 * Strip a Greenhouse job's `content` field into readable prose.
 *
 * Greenhouse's `content` is HTML whose own markup is itself HTML-entity-escaped
 * (verified live: the wire value looks like `&lt;div&gt;&lt;p&gt;...&lt;/p&gt;&lt;/div&gt;`,
 * not `<div><p>...</p></div>`), so this needs one decode pass to reveal the real
 * tags before the usual block-tag-to-newline + strip-tags + decode-entities
 * pipeline (which then handles any entities, like `&amp;nbsp;` -> `&nbsp;` -> " ",
 * that the first pass exposed). Null for empty input.
 */
export function cleanContent(raw: string | null | undefined): string | null {
  if (!raw) return null
  const html = decodeHtmlEntities(raw)
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

/** Normalize a company slug: trim only. Greenhouse slugs are case-insensitive server-side (verified live) and not otherwise restricted here, so validation is left to the API's own 404. */
export function normalizeCompany(input: string): string | null {
  const trimmed = input.trim()
  return trimmed || null
}

/** Extract a numeric Greenhouse job id from a bare id or a job-board URL (`.../jobs/<id>`). */
export function normalizeJobId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const m = trimmed.match(/\/jobs\/(\d+)/)
  if (m) return m[1]
  return /^\d+$/.test(trimmed) ? trimmed : null
}
