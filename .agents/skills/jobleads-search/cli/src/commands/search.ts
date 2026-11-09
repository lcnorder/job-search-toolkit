import { buildSearchUrl, textFetch, parseJobCards, matchesJobage, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

// JobLeads renders 25 results per SSR page and exposes no page-size parameter this CLI
// could find - --limit is applied client-side, capped at the page's own size.
const PAGE_SIZE = 25

function renderTable(results: JobCard[]): string {
  if (results.length === 0) return "No results."
  const rows = results.map((r) => {
    const title = (r.title || "").slice(0, 40).padEnd(40)
    const company = (r.company || "—").slice(0, 24).padEnd(24)
    const loc = (r.location || "—").slice(0, 20).padEnd(20)
    const date = (r.date || "—").padEnd(12)
    return `${r.id.padEnd(12)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(12) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(20) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(results: JobCard[]): string {
  if (results.length === 0) return "No results."
  return results
    .map((r) => {
      const bits = [r.company || "—", r.location || "—", r.workSetting, r.salary, r.date].filter(Boolean)
      return `${r.title}\n  ${bits.join(" · ")}\n  id: ${r.id}\n  ${r.url}`
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const url = buildSearchUrl(opts.query, opts.location, opts.page)
    const html = await textFetch(url)
    if (!html) {
      writeError("Could not fetch search results", "SEARCH_UNAVAILABLE")
      return 1
    }

    // --location is not re-applied client-side: JobLeads' /l/<location> path segment is
    // already a geo-radius match (e.g. "Austin TX" legitimately returns Cedar Park and
    // Round Rock postings within commuting distance, neither of which contains "Austin" in
    // its own location string), so a client-side substring filter would wrongly drop real,
    // relevant matches instead of catching bad ones.
    let results = parseJobCards(html)
    results = results.filter((r) => matchesJobage(r.date, opts.jobage))

    const limit = opts.limit !== undefined ? Math.min(Math.max(opts.limit, 0), PAGE_SIZE) : results.length
    results = results.slice(0, limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: { count: results.length, page: opts.page },
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
