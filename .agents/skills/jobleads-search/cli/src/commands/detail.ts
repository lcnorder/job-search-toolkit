import { BASE_URL, htmlFetch, parseDetailPage, writeError, type JobDetail } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare id (the trailing hex segment of a job URL's slug) or a full
 * /us/job/<slug>--<id> URL, as returned by `search`'s `url` field. The slug segments before
 * the id are decorative - confirmed live: `/us/job/job--<id>` (a deliberately wrong slug)
 * 200s and resolves the correct posting - so a bare id works fine via a placeholder slug. */
export function normalizeInput(input: string): { id: string; url: string } | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/us\/job\/([^/?]+)/)
  if (urlMatch) {
    const parts = urlMatch[1].split("--")
    const id = parts[parts.length - 1]
    if (!id) return null
    const url = trimmed.startsWith("http") ? trimmed : `${BASE_URL}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`
    return { id, url }
  }
  if (/^[a-z0-9]{6,}$/i.test(trimmed)) {
    return { id: trimmed, url: `${BASE_URL}/us/job/job--${trimmed}` }
  }
  return null
}

function toResult(id: string, url: string, detail: JobDetail) {
  return {
    id,
    title: detail.title,
    company: detail.company,
    location: detail.location,
    date: detail.date,
    url,
    description: detail.description,
    workSetting: detail.workSetting,
    salary: detail.salary,
    employmentType: detail.employmentType,
  }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const normalized = normalizeInput(opts.id)
  if (!normalized) {
    writeError(`Could not parse a job id or URL from "${opts.id}"`, "BAD_ID")
    return 1
  }
  const { id, url } = normalized

  try {
    const fetched = await htmlFetch(url)

    // Belt-and-suspenders: Cloudflare did not challenge any detail-page request made with
    // this CLI's plain, honest fetch during development (see helpers.ts's file header), but
    // that scoring is Cloudflare's own and could change - if it ever does, report it
    // cleanly instead of parsing a challenge page as if it were a posting.
    if (fetched.cfChallenge) {
      writeError(
        "JobLeads returned a Cloudflare bot challenge (HTTP 403) for this request. This " +
          "tool does not attempt to solve CAPTCHAs or bot challenges under any " +
          "circumstance. Open the URL in a browser instead: " +
          url,
        "DETAIL_BLOCKED",
      )
      return 1
    }
    // 410 Gone is JobLeads' real response for an expired/removed posting id (confirmed
    // live) - treated the same as 404 rather than a generic failure.
    if (fetched.status === 404 || fetched.status === 410 || !fetched.body) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    if (fetched.status >= 400) {
      writeError(`Unexpected response: HTTP ${fetched.status}`, "DETAIL_FAILED")
      return 1
    }

    const detail = parseDetailPage(fetched.body)
    if (!detail) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = toResult(id, url, detail)

    if (opts.format === "plain") {
      const bits = [job.company || "—", job.location || "—", job.workSetting, job.employmentType, job.salary].filter(
        Boolean,
      )
      const lines = [
        job.title,
        bits.join(" · "),
        job.date ? `Posted: ${job.date}` : "",
        "",
        job.description ||
          "(no description available - the server rendered no description panel for this posting)",
        "",
        `URL: ${job.url}`,
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
