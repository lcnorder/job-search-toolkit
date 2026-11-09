import {
  boardBaseUrl,
  htmlFetch,
  extractNextData,
  normalizeJobId,
  boardFromUrl,
  toDetailResult,
  writeError,
  type GetroJobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  board?: string
  format: "json" | "plain"
}

/** `initialState.jobs.currentJob` shape read off a /companies/*\/jobs/* page's __NEXT_DATA__. */
interface JobDetailPageData {
  props?: {
    pageProps?: {
      initialState?: {
        jobs?: {
          currentJob?: GetroJobDetail | null
        }
      }
    }
  }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const urlBoard = boardFromUrl(opts.id)
  const board = urlBoard ?? opts.board
  if (!board) {
    writeError("detail requires --board <hostname> (or pass a full board URL as the id)", "NO_BOARD")
    return 1
  }
  const id = normalizeJobId(opts.id)
  if (!id) {
    writeError(`could not parse a numeric job id from "${opts.id}"`, "BAD_ID")
    return 1
  }

  try {
    // The company/title slug segments are decorative - Getro resolves the posting purely off
    // the numeric id (verified live: a placeholder company slug still returns the right job).
    const url = `${boardBaseUrl(board)}/companies/x/jobs/${id}-x`
    const html = await htmlFetch(url)
    if (html === null) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const data = extractNextData(html) as JobDetailPageData
    const currentJob = data.props?.pageProps?.initialState?.jobs?.currentJob
    if (!currentJob) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const job = toDetailResult(currentJob)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.status ? `Status: ${job.status}` : "",
        job.job_functions.length ? `Function: ${job.job_functions.join(", ")}` : "",
        job.employment_types.length ? `Employment: ${job.employment_types.join(", ")}` : "",
        job.salary ? `Compensation: ${job.salary}` : "",
        "",
        job.description || "(no description)",
        "",
        `Apply: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
