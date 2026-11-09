import { apiGet, normalizeJobId, toDetail, writeError, type GreenhouseJob, type JobDetailResult } from "../helpers.js"

export interface DetailOpts {
  id: string // a bare Greenhouse job id, or a job-boards.greenhouse.io URL containing /jobs/<id>
  company: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeJobId(opts.id)
  if (!id) {
    writeError(`could not parse a numeric Greenhouse job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const job = await apiGet<GreenhouseJob>(`/v1/boards/${encodeURIComponent(opts.company)}/jobs/${id}`)
    if (!job) {
      writeError(`no job ${id} found on ${opts.company}'s Greenhouse board (wrong id, wrong company, or the posting closed)`, "NOT_FOUND")
      return 1
    }
    const detail: JobDetailResult = toDetail(job, opts.company)

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company ?? "—"} · ${detail.location ?? "—"}${detail.location_type ? ` (${detail.location_type})` : ""}`,
        detail.date ? `Posted: ${detail.date.slice(0, 10)}` : "",
        detail.updated_at ? `Updated: ${detail.updated_at.slice(0, 10)}` : "",
        detail.departments.length ? `Departments: ${detail.departments.join(", ")}` : "",
        detail.offices.length ? `Offices: ${detail.offices.join(", ")}` : "",
        "",
        detail.description ?? "(no description)",
        "",
        `URL: ${detail.url}`,
        `id: ${detail.id}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
