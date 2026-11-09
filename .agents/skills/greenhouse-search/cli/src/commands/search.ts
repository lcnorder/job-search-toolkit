import { apiGet, toResult, writeError, type GreenhouseJob, type JobResult, type JobsListResponse } from "../helpers.js"

export interface SearchOpts {
  company: string
  query?: string
  jobage?: number // days; undefined = no filter
  page: number
  limit: number
  format: "json" | "table" | "plain"
  // Fetch each job's full description in the same request (content=true) and
  // filter --query against it too. Off by default: a large board's full text
  // for every posting is a heavy payload for a discovery pass. Populate a
  // single posting's description with `detail` instead.
  withDescription: boolean
}

/** The date portion (YYYY-MM-DD) of an ISO timestamp, or "—" when absent. */
function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((r) => String(r.id).length)), cell: (r) => String(r.id) },
    { header: "TITLE", width: 42, cell: (r) => r.title },
    { header: "LOCATION", width: 28, cell: (r) => r.location ?? "—" },
    { header: "TYPE", width: 10, cell: (r) => r.location_type ?? "—" },
    { header: "POSTED", width: 10, cell: (r) => shortDate(r.date) },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")

  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (r: JobResult) =>
    [
      r.title,
      `  ${r.location ?? "—"}${r.location_type ? ` (${r.location_type})` : ""} · posted ${shortDate(r.date)}`,
      `  id: ${r.id}`,
      `  ${r.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

/** Whether `date` (ISO 8601) falls within the last `days` days of now. A missing date never matches an age filter (can't verify recency, so it is excluded rather than assumed fresh). */
function withinDays(date: string | null, days: number): boolean {
  if (!date) return false
  const ts = Date.parse(date)
  if (Number.isNaN(ts)) return false
  const ageMs = Date.now() - ts
  return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const listRes = await apiGet<JobsListResponse>(
      `/v1/boards/${encodeURIComponent(opts.company)}/jobs?content=${opts.withDescription ? "true" : "false"}`,
    )
    // A 404 here means the company slug isn't a Greenhouse board (or is
    // misspelled) — reporting it as an empty result set would hide that
    // behind plausible-looking output, so it is a distinct error instead.
    if (!listRes) {
      writeError(
        `no Greenhouse board found for company "${opts.company}" — check the slug (it's the path segment in the company's job-boards.greenhouse.io URL)`,
        "UNKNOWN_COMPANY",
      )
      return 1
    }

    let jobs: GreenhouseJob[] = listRes.jobs ?? []

    // Greenhouse's list endpoint has no documented server-side keyword search
    // or pagination (verified live: an undocumented `q=` param and `page=`
    // param are both silently ignored — the full board comes back every time),
    // so both are implemented client-side here, over the one fetched list.
    let results = jobs.map((j) => toResult(j, opts.company))

    if (opts.query) {
      const q = opts.query.toLowerCase()
      results = results.filter((r) => {
        if (r.title.toLowerCase().includes(q)) return true
        if (opts.withDescription && r.description && r.description.toLowerCase().includes(q)) return true
        return false
      })
    }

    if (opts.jobage !== undefined) {
      results = results.filter((r) => withinDays(r.date, opts.jobage!))
    }

    // Most-recently-first; the raw board order is Greenhouse's internal
    // ordering (not documented as chronological), so this makes browsing
    // predictable. Jobs missing first_published (rare) sort last.
    results = [...results].sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : -Infinity
      const tb = b.date ? Date.parse(b.date) : -Infinity
      return tb - ta
    })

    const total = results.length
    const start = (opts.page - 1) * opts.limit
    const page = results.slice(start, start + opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(page) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(page) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: page.length, page: opts.page, total }, results: page }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
