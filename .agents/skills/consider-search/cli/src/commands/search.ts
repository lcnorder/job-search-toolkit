import {
  fetchSession,
  searchJobs,
  toResult,
  writeError,
  BoardNotFoundError,
  type SearchQuery,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  board: string
  query?: string
  locations: string[]
  departments: string[]
  remoteOnly?: boolean
  postedSince?: string
  extra: Record<string, string[]>
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(results: JobResult[]): string {
  if (results.length === 0) return "No results."
  const rows = results.map((r) => {
    const title = (r.title || "").slice(0, 40).padEnd(40)
    const company = (r.company || "—").slice(0, 24).padEnd(24)
    const loc = (r.location || "—").slice(0, 22).padEnd(22)
    const date = (r.date || "—").slice(0, 10)
    return `${r.id.padEnd(28)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(28) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(results: JobResult[]): string {
  return (
    results
      .map(
        (r) =>
          `${r.title}\n  ${r.company || "—"} · ${r.location || "—"} · ${r.date || "—"}\n  id: ${r.id}\n  ${r.url}`,
      )
      .join("\n\n") + (results.length ? "\n" : "")
  )
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const session = await fetchSession(opts.board)

    const query: SearchQuery = { ...opts.extra }
    if (opts.query) query.keywords = opts.query
    if (opts.locations.length) query.locations = opts.locations
    if (opts.departments.length) query.departments = opts.departments
    if (opts.remoteOnly !== undefined) query.remoteOnly = opts.remoteOnly
    if (opts.postedSince) query.postedSince = opts.postedSince

    // Consider paginates with an opaque server-issued cursor (`meta.sequence`), not a
    // numeric offset (`from`/`page` were tried live and returned the same first page
    // regardless - see url-reference.md). To reach page N we walk the cursor chain N-1
    // times server round-trips, matching the contract's 1-indexed --page while respecting
    // how this platform actually paginates.
    const size = 20
    let sequence: string | undefined
    let jobs: Awaited<ReturnType<typeof searchJobs>>["jobs"] = []
    let total = 0
    for (let p = 1; p <= opts.page; p++) {
      const res = await searchJobs(opts.board, session, query, size, sequence)
      jobs = res.jobs
      total = res.total
      sequence = res.meta.sequence
      if (p < opts.page && jobs.length === 0) break // ran out of pages early
    }

    let results = jobs.map(toResult)
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results))
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: { count: results.length, page: opts.page, totalOnBoard: total },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    if (e instanceof BoardNotFoundError) {
      writeError(`board "${opts.board}" was not found (404) - check the hostname`, "BOARD_NOT_FOUND")
      return 1
    }
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
