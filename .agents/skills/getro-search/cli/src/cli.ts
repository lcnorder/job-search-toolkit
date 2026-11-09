#!/usr/bin/env bun
// Self-contained CLI for searching Getro-platform VC-portfolio job boards (e.g.
// jobs.menlovc.com, jobs.accel.com). No external CLI framework and zero runtime
// dependencies - it runs anywhere `bun` is available with nothing installed beyond the repo
// clone. See helpers.ts's file header for why this only ever fetches each board's own SSR
// pages and never the disallowed api.getro.com.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { normalizeBoard, normalizeWorkMode } from "./helpers.js"

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
 * Split --location on ";" rather than ",": a Getro location string is itself
 * comma-bearing free text (e.g. "San Francisco, CA, USA" is ONE searchable_locations
 * entry, not three) - comma-splitting it breaks the facet (confirmed live: it silently
 * returns zero results because none of "San Francisco"/"CA"/"USA" alone match the
 * board's indexed location strings). Pass --location twice or separate with ";" for
 * more than one place.
 */
function locationList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
}

const HELP = `getro-cli — search Getro-platform VC-portfolio job boards (jobs.<org>.com)

USAGE
  bun run src/cli.ts search --board <hostname> [-q "<keywords>"] [flags]
  bun run src/cli.ts detail <id|url> --board <hostname> [--format json|plain]

SEARCH FLAGS
  --board, -b <hostname>   Required. The Getro board's hostname, e.g. jobs.menlovc.com
                          (NOT jobs.a16z.com or jobs.psychedelicalpha.com - those boards
                          are NOT running the Getro platform; see SKILL.md).
  --query, -q <text>      Keywords (title, skill, role). Optional.
  --location, -l <text>   Free-text location, e.g. "San Francisco, CA, USA" (commas are
                          part of the place name here - separate multiple places with
                          ";" instead, not ","). Matches Getro's searchable_locations
                          facet (confirmed working - see url-reference.md).
  --seniority <levels>    Comma-separated, e.g. senior,mid_senior,entry_level,associate.
  --remote <mode>         remote | onsite | hybrid (work_mode facet; confirmed working
                          for remote/onsite, hybrid returned 0 results in testing - the
                          board may simply have none right now).
  --jobage <days>         Posted within N days. Client-side only: filters within the
                          ~20 results the board's page already returned (see Notes in
                          SKILL.md) - it is not a full re-query.
  --page <n>              Must be 1 (default). Getro's SSR page always renders the same
                          first ~20 matches regardless of a page parameter - true
                          pagination requires the cross-origin api.getro.com endpoint,
                          which robots.txt disallows outright, so this CLI errors
                          loudly on --page > 1 instead of returning duplicate results.
  --limit, -n <n>         Client-side cap on results emitted. Default: no cap beyond
                          what the board's page returns (usually ~20).
  --format <fmt>          json (default) | table | plain.
  --facet <key=value>     Escape hatch: merges key=value(s) into Getro's filter param
                          as-is (repeatable, comma-splits the value). UNVERIFIED beyond
                          the three flags above - a wrong key/value returns zero
                          results rather than an error (see url-reference.md).

DETAIL
  <id|url>                 A numeric job id (from a search result's id) or a full
                          https://<board>/companies/<slug>/jobs/<id>-<slug> URL (in
                          which case --board is inferred from the URL).

EXAMPLES
  bun run src/cli.ts search --board jobs.menlovc.com -q "business development" --limit 5 --format table
  bun run src/cli.ts search --board jobs.menlovc.com -q "engineer" --seniority senior --remote remote --format table
  bun run src/cli.ts search --board jobs.accel.com -q "product manager" -l "London, UK" --format table
  bun run src/cli.ts detail 92787641 --board jobs.menlovc.com --format plain

Verified Getro boards: jobs.menlovc.com, jobs.accel.com, jobs.alleycorp.com,
jobs.technyc.org, jobs.dukecapitalpartners.duke.edu. NOT Getro (do not use): jobs.a16z.com,
jobs.psychedelicalpha.com, jobs.lsvp.com — see SKILL.md.

⚠ Personal use only — Getro's Terms of Service prohibit automated crawling/scraping even
though every verified board's robots.txt is open. Keep volume low. See SKILL.md.
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
    "query", "board", "location", "seniority", "remote", "jobage", "page", "limit", "format", "facet", "help", "h",
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
        JSON.stringify({ error: `search requires --board <hostname>, e.g. --board jobs.menlovc.com`, code: "NO_BOARD" }) + "\n",
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

    const page = flags.page ? parseInt(flags.page as string, 10) : 1
    if (page !== 1) {
      process.stderr.write(
        JSON.stringify({
          error:
            "--page must be 1: Getro's SSR page always renders the same first ~20 matches regardless of a page parameter, and true pagination requires the cross-origin api.getro.com endpoint, which robots.txt disallows outright (Disallow: /). This CLI will not fetch it.",
          code: "PAGE_UNSUPPORTED",
        }) + "\n",
      )
      return 1
    }

    const fmt = (flags.format as string) || "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be json, table, or plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    const remoteRaw = stringFlag(flags.remote)
    if (remoteRaw && !["remote", "onsite", "on-site", "hybrid"].includes(remoteRaw.toLowerCase())) {
      process.stderr.write(
        JSON.stringify({ error: `--remote must be remote, onsite, or hybrid, got "${remoteRaw}"`, code: "BAD_ARG" }) + "\n",
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
      seniority: commaList(flags.seniority),
      workMode: remoteRaw ? [normalizeWorkMode(remoteRaw)] : [],
      facets,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      limit: flags.limit ? Math.max(0, parseInt(flags.limit as string, 10)) : undefined,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const boardRaw = stringFlag(flags.board)
    const board = boardRaw ? normalizeBoard(boardRaw) ?? undefined : undefined
    if (boardRaw && !board) {
      process.stderr.write(JSON.stringify({ error: `invalid --board "${boardRaw}"`, code: "BAD_ARG" }) + "\n")
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
