import {
  fetchSession,
  fetchJobDetail,
  decodeCompoundId,
  toResult,
  cleanHtml,
  writeError,
  BoardNotFoundError,
  type ConsiderJobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  board: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const decoded = decodeCompoundId(opts.id)
  if (!decoded) {
    writeError(
      `could not parse "${opts.id}" as a Consider job id - pass the "id" field exactly as returned by search (format "<companySlug>::<jobId>"), not a bare job id or an external URL`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const session = await fetchSession(opts.board)
    const job: ConsiderJobDetail | null = await fetchJobDetail(
      opts.board,
      session,
      decoded.jobId,
      decoded.companySlug,
    )

    if (!job) {
      // The overwhelming majority of postings on every Consider board investigated route
      // straight to an external ATS (Lever, Greenhouse, CareerPuck, ...) rather than being
      // hosted by Consider itself - this endpoint only ever returns data for the (rare)
      // `considerHosted: true` case. This is a real, documented platform limitation, not a
      // crash - see SKILL.md's "Why detail often can't fetch a description" section. The
      // job's own application page (search's `url` field) is the authoritative full
      // description in this case.
      writeError(
        "this job is not hosted by Consider (it routes to an external ATS) - Consider's API does not expose a full description for it. Re-run `search` and use the result's own `url` field (the direct application page) for the full posting text.",
        "NOT_HOSTED_BY_CONSIDER",
      )
      return 1
    }

    const base = toResult(job)
    const description = cleanHtml(job.description)

    if (opts.format === "plain") {
      const lines = [
        base.title,
        `${base.company || "—"} · ${base.location || "—"}`,
        "",
        base.seniority ? `Seniority: ${base.seniority}` : "",
        base.salary ? `Compensation: ${base.salary}` : "",
        "",
        description || "(no description)",
        "",
        `Apply: ${base.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify({ ...base, description }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    if (e instanceof BoardNotFoundError) {
      writeError(`board "${opts.board}" was not found (404) - check the hostname`, "BOARD_NOT_FOUND")
      return 1
    }
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
