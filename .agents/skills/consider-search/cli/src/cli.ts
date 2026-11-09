#!/usr/bin/env bun
// Self-contained CLI for searching Consider-platform VC-portfolio job boards (e.g.
// careers.foresitecapital.com). No external CLI framework and zero runtime dependencies - it
// runs anywhere `bun` is available with nothing installed beyond the repo clone. See
// helpers.ts's file header for the session handshake (GET page for CSRF token + cookies,
// then POST the search) every command performs.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { normalizeBoard } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit", l: "location", b: "board" }

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
    if (key === "facet") {
      const acc = Array.isArray(flags.facet) ? flags.facet : []
      if (typeof value === "string") acc.push(value)
      flags.facet = acc
    } else {
      flags[key] = value
    }
  }
  return flags
}

type FlagValue = string | boolean | string[] | undefined

function stringFlag(raw: FlagValue): string | undefined {
  return typeof raw === "string" ? raw : undefined
}

function commaList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Split --location on ";" rather than ",", matching linkedin-search/getro-search's
 * convention: a location string is itself comma-bearing free text (e.g. "San Francisco,
 * California"). Unlike Getro, Consider's location match was observed to be loose/fuzzy
 * text rather than an exact indexed string (a bare "San Francisco" alone matched zero
 * jobs while "San Francisco, California" matched many - see url-reference.md), so pass the
 * full normalized place string as it appears in a job's own `locations` field for best
 * results.
 */
function locationList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
}

const HELP = `consider-cli — search Consider-platform VC-portfolio job boards (careers.<org>.com)

USAGE
  bun run src/cli.ts search --board <hostname> [-q "<keywords>"] [flags]
  bun run src/cli.ts detail <id> --board <hostname> [--format json|plain]

SEARCH FLAGS
  --board, -b <hostname>   Required. The Consider board's hostname, e.g.
                          careers.foresitecapital.com.
  --query, -q <text>      Keywords. NOTE: this re-ranks all of the board's jobs by
                          relevance rather than excluding non-matches - the total job
                          count does not drop when you add a keyword (confirmed live; see
                          url-reference.md). Still take the top results - they are the
                          most relevant - but don't read "meta.totalOnBoard" as a match
                          count when -q is set.
  --location, -l <text>   Free-text place string as it appears in a job's own "locations"
                          field, e.g. "San Francisco, California". Loose/fuzzy match -
                          confirmed working server-side. Separate multiple places with
                          ";", not ",".
  --department <text>     Comma-separated department name(s), e.g. "Finance,Engineering".
                          Confirmed working server-side (exact match against the
                          department label).
  --remote                Boolean flag - only remote-eligible postings (Consider's
                          "remoteOnly" filter). Confirmed working server-side. There is no
                          separate on-site/hybrid filter value; omit the flag to see all.
  --jobage <days>          Posted within N days (maps to Consider's own "postedSince"
                          facet as "<N>d" - confirmed working server-side, unlike Getro's
                          client-side-only equivalent).
  --page <n>              1-indexed. Consider paginates with an opaque cursor
                          ("meta.sequence"), not a numeric offset, so reaching page N
                          costs N-1 extra round trips within this one invocation - keep N
                          small.
  --limit, -n <n>         Client-side cap on results emitted.
  --format <fmt>          json (default) | table | plain.
  --facet <key=value>     Escape hatch: merges key=value(s) into the query body as-is
                          (repeatable, comma-splits the value). UNVERIFIED beyond the
                          flags above - seniority filtering in particular was tried under
                          several guessed key names and none filtered server-side (see
                          url-reference.md) - a wrong key/value is silently ignored by
                          Consider, not rejected.

DETAIL
  <id>                    The "id" field exactly as returned by a search result (format
                          "<companySlug>::<jobId>" - Consider's own detail lookup needs
                          both pieces). Often returns NOT_HOSTED_BY_CONSIDER - see
                          SKILL.md; the job's own apply URL (search's "url" field) is the
                          real posting in that case.

EXAMPLES
  bun run src/cli.ts search --board careers.foresitecapital.com -q "business development" --limit 5 --format table
  bun run src/cli.ts search --board careers.foresitecapital.com --department Finance --format table
  bun run src/cli.ts search --board careers.foresitecapital.com --remote --jobage 7 --format table
  bun run src/cli.ts detail "delfi-diagnostics::dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e" --board careers.foresitecapital.com --format plain

⚠ Personal use only — Consider's Terms of Service prohibit automated crawling/scraping even
though robots.txt is open (Allow: / except for LinkedInBot). Keep volume low. See SKILL.md.
`

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
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
  search: new Set([
    "query", "board", "location", "department", "remote", "jobage", "page", "limit", "format", "facet", "help", "h",
  ]),
  detail: new Set(["board", "format", "help", "h"]),
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

  if (cmd === "search") {
    const boardRaw = stringFlag(flags.board)
    const board = normalizeBoard(boardRaw)
    if (!board) {
      process.stderr.write(
        JSON.stringify({
          error: `search requires --board <hostname>, e.g. --board careers.foresitecapital.com`,
          code: "NO_BOARD",
        }) + "\n",
      )
      return 1
    }

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const fmt = (flags.format as string) || "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be json, table, or plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    const facets: Record<string, string[]> = {}
    const rawFacets = Array.isArray(flags.facet) ? flags.facet : []
    for (const kv of rawFacets) {
      const eq = kv.indexOf("=")
      if (eq <= 0) {
        process.stderr.write(JSON.stringify({ error: `invalid --facet "${kv}", want key=value`, code: "BAD_ARG" }) + "\n")
        return 1
      }
      const key = kv.slice(0, eq)
      const vals = commaList(kv.slice(eq + 1))
      facets[key] = (facets[key] ?? []).concat(vals)
    }

    const opts: SearchOpts = {
      board,
      query: stringFlag(flags.query),
      locations: locationList(flags.location),
      departments: commaList(flags.department),
      remoteOnly: flags.remote ? true : undefined,
      postedSince: flags.jobage ? `${flags.jobage}d` : undefined,
      extra: facets,
      page: flags.page ? parseInt(flags.page as string, 10) : 1,
      limit: flags.limit ? Math.max(0, parseInt(flags.limit as string, 10)) : undefined,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id>", code: "NO_ID" }) + "\n")
      return 1
    }
    const boardRaw = stringFlag(flags.board)
    const board = normalizeBoard(boardRaw)
    if (!board) {
      process.stderr.write(
        JSON.stringify({ error: `detail requires --board <hostname>`, code: "NO_BOARD" }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    if (!["json", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be json or plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    const opts: DetailOpts = { id, board, format: fmt as DetailOpts["format"] }
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
