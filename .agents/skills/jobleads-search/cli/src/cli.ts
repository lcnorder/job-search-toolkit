#!/usr/bin/env bun
// Self-contained CLI for searching www.jobleads.com/us (a US-region job-search
// aggregator). No external CLI framework, so it runs anywhere `bun` is available with
// zero install beyond the repo clone.
//
// `search` and `detail` both work against real, server-rendered pages - no login required.
// `detail`'s description is whatever the server renders inline for the posting, which may
// be a preview rather than the complete text (see SKILL.md). This tool never attempts to
// bypass a CAPTCHA or bot challenge under any circumstance; see helpers.ts for what that
// means in practice for JobLeads' Cloudflare bot-management.
//
// Also see SKILL.md's "Terms of Use" warning: JobLeads' own Terms of Use prohibit using
// "mechanisms, software or scripts" and "robot/crawler search engine technologies" on the
// platform. Keep volume low and run this on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `jobleads-cli — search www.jobleads.com/us

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [-l "<location>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    Keywords (job title, skill). Maps to JobLeads' /q/<query> path
                        segment. Omit to browse the whole US region.
  --location, -l <text> City/state/"remote" (e.g. "Denver CO", "Austin TX", "Remote").
                        Maps to JobLeads' /l/<location> path segment - a geo-radius match,
                        not an exact-string filter, so nearby towns can appear too.
  --jobage <days>       Posted within N days. Client-side only - JobLeads exposes no
                        server-side age parameter this CLI could find. Precision is capped
                        at 14 days (see SKILL.md).
  --page <n>            1-indexed page over JobLeads' own server-side pagination. Default 1.
  --limit, -n <n>       Cap results returned (client-side, max 25 - JobLeads' own page size).
  --format <fmt>        json (default) | table | plain.

DETAIL
  Accepts a bare job id or a full /us/job/<slug>--<id> URL (the \`url\` field from a
  \`search\` result - preferred). Returns the posting's fields, including a description
  that may be a preview rather than the complete text - see SKILL.md.

EXAMPLES
  bun run src/cli.ts search -q "business development" -l "Austin TX" --format table
  bun run src/cli.ts search -q "VP business development" --jobage 14 --format table
  bun run src/cli.ts search -l "Remote" --format table
  bun run src/cli.ts detail 4426311357abcd1234 --format plain

Terms-of-Use note: keep volume low, personal use only — see SKILL.md.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
    // Number(), not parseInt(): parseInt truncates a fractional value instead of rejecting
    // it, which would silently change what the search returns rather than erroring.
    const val = typeof raw === "string" ? Number(raw.trim()) : NaN
    if (!Number.isInteger(val) || val < 1) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) +
          "\n",
      )
      return null
    }
    return val
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      flags.jobage = String(v)
    }
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
