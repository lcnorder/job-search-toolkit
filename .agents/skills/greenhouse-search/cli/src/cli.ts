#!/usr/bin/env bun
// Self-contained CLI for searching any company's Greenhouse job board via the
// public boards-api.greenhouse.io Job Board API. No external CLI framework and
// zero runtime dependencies, so it runs anywhere `bun` is available with
// nothing installed beyond the repo clone.
//
// Multi-tenant by design: Greenhouse hosts hundreds of independent company
// boards behind one API, so `--company <slug>` is REQUIRED on every command —
// there is no default board.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[] | undefined
}

// Short-flag aliases.
const ALIAS: Record<string, string> = { q: "query", n: "limit", c: "company" }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    const next = argv[i + 1]
    let value: string | boolean = true
    if (next !== undefined && !next.startsWith("-")) {
      value = next
      i++
    }
    flags[key] = value
  }
  return flags
}

function stringFlag(raw: string | boolean | string[] | undefined): string | undefined {
  return typeof raw === "string" ? raw : undefined
}

const HELP = `greenhouse-cli — search any company's Greenhouse job board (boards-api.greenhouse.io)

USAGE
  bun run src/cli.ts search --company <slug> [-q "<keywords>"] [flags] [--format json|table|plain]
  bun run src/cli.ts detail <id> --company <slug> [--format json|plain]

SEARCH FLAGS
  --company, -c <slug>    REQUIRED. The company's Greenhouse board slug — the
                          path segment in job-boards.greenhouse.io/<slug>.
  --query, -q <text>      Keyword filter on job title (and description when
                          --with-description is set). Client-side: Greenhouse's
                          API has no documented server-side keyword search
                          (verified live: an undocumented q= param is ignored).
  --jobage <days>         Posted within N days, filtered client-side on
                          first_published (see url-reference.md for why not
                          updated_at). No server-side equivalent.
  --page <n>              1-indexed page over the (filtered) result set.
                          Client-side: Greenhouse returns a company's whole
                          board in one response with no true pagination
                          (verified live: a page= param is ignored) — --page
                          slices the list this CLI already fetched.
  --limit, -n <n>         Results per page. Default 25.
  --format <fmt>          json (default) | table | plain.
  --with-description      Fetch each job's full posting text in the same
                          request (content=true) and let --query match it too.
                          Off by default — a large board's full text for every
                          posting is a heavy payload for a discovery pass; use
                          'detail' to read one posting's full text instead.

DETAIL
  <id>                    A numeric Greenhouse job id (from a search result's
                          id), or a full job-boards.greenhouse.io/.../jobs/<id> URL.
  --company, -c <slug>    REQUIRED. Job ids are only unique within a company's
                          board, and the board scopes the request URL.

EXAMPLES
  bun run src/cli.ts search --company anthropic -q "partnerships" --limit 5 --format table
  bun run src/cli.ts search --company stripe --jobage 14 --format table
  bun run src/cli.ts detail 4461450008 --company anthropic --format plain

Reads are public (no API key, no login). Greenhouse's robots.txt only disallows
/embed/ — /v1/boards/* is unrestricted (verified live).
`

function parseIntFlag(name: string, raw: string | boolean | string[] | undefined): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    process.stderr.write(
      JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n",
    )
    return null
  }
  return val
}

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["company", "query", "jobage", "page", "limit", "format", "with-description", "help", "h"]),
  detail: new Set(["company", "format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
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

  if (cmd === "search" || cmd === "detail") {
    const company = stringFlag(flags.company)
    if (!company || !company.trim()) {
      process.stderr.write(
        JSON.stringify({
          error: "--company (or -c) is required - Greenhouse hosts hundreds of independent company boards, so every search/detail call must name one (the slug from job-boards.greenhouse.io/<slug>)",
          code: "MISSING_COMPANY",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const opts: SearchOpts = {
      company: stringFlag(flags.company)!.trim(),
      query: stringFlag(flags.query),
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      page: flags.page ? parseInt(flags.page as string, 10) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : 25,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
      withDescription: flags["with-description"] !== undefined,
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = { id, company: stringFlag(flags.company)!.trim(), format: fmt === "plain" ? "plain" : "json" }
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
