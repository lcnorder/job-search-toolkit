import {
  boardBaseUrl,
  htmlFetch,
  extractNextData,
  buildFilterParam,
  toResult,
  writeError,
  type GetroJobSummary,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  board: string
  query?: string
  locations: string[]
  seniority: string[]
  workMode: string[]
  facets: Record<string, string[]>
  jobage?: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("q", opts.query)
  const filter = buildFilterParam({
    locations: opts.locations,
    seniority: opts.seniority,
    workMode: opts.workMode,
    extra: opts.facets,
  })
  if (filter) params.set("filter", filter)
  return `${boardBaseUrl(opts.board)}/jobs?${params.toString()}`
}

/** `initialState.jobs` shape read off the /jobs page's __NEXT_DATA__ blob. */
interface JobsPageData {
  props?: {
    pageProps?: {
      initialState?: {
        jobs?: {
          found?: GetroJobSummary[]
          total?: number
        }
      }
    }
  }
}

function renderTable(results: JobResult[]): string {
  if (results.length === 0) return "No results."
  const rows = results.map((r) => {
    const title = (r.title || "").slice(0, 40).padEnd(40)
    const company = (r.company || "—").slice(0, 24).padEnd(24)
    const loc = (r.location || "—").slice(0, 22).padEnd(22)
    const date = (r.date || "—").slice(0, 10)
    return `${r.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(10) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(22) + " DATE"
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
    const html = await htmlFetch(buildUrl(opts))
    if (html === null) {
      writeError(`board "${opts.board}" was not found (404) - check the hostname`, "BOARD_NOT_FOUND")
      return 1
    }
    const data = extractNextData(html) as JobsPageData
    const jobsState = data.props?.pageProps?.initialState?.jobs
    if (!jobsState) {
      writeError(
        "the page loaded but did not contain a jobs listing - this board may not be running the genuine Getro platform (see SKILL.md's Verified boards section)",
        "UNEXPECTED_PAGE_SHAPE",
      )
      return 1
    }

    let jobs = jobsState.found ?? []

    // Client-side jobage filter: the SSR page has no server-side date facet, and only the
    // first ~20 matches are reachable at all (see helpers.ts's file-header note on why), so
    // this filters only within that already-fetched batch - it is not a full re-query.
    if (opts.jobage !== undefined) {
      const cutoff = Date.now() - opts.jobage * 86400000
      jobs = jobs.filter((j) => j.createdAt !== null && j.createdAt * 1000 >= cutoff)
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
            meta: {
              count: results.length,
              page: 1,
              totalOnBoard: jobsState.total ?? null,
            },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
