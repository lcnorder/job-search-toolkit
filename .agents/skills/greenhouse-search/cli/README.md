# greenhouse-cli

CLI for searching **any company's** [Greenhouse](https://www.greenhouse.io/) job
board, via Greenhouse's public Job Board API (`boards-api.greenhouse.io`).
Greenhouse hosts hundreds of independent company boards behind one API, so
`--company <slug>` is **required** on every call — there is no default board.

**Data source**: `GET https://boards-api.greenhouse.io/v1/boards/<company>/jobs` and `.../jobs/<id>`.
**Authentication**: None required — reads are fully public (no API key, no login).
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

## Installation

```bash
cd .agents/skills/greenhouse-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Finding a company's slug

The slug is the path segment in the company's public job-boards URL:
`https://job-boards.greenhouse.io/<slug>` (or the older `boards.greenhouse.io/<slug>`).
Anthropic's is `anthropic`, Stripe's is `stripe`, Figma's is `figma`. If a
company isn't on Greenhouse, or the slug is wrong, `search`/`detail` exit 1
with an `UNKNOWN_COMPANY` / `NOT_FOUND` error rather than an empty result.

## Commands

| Command | Description |
|---------|-------------|
| `search` | List/filter one company's open jobs |
| `detail` | Fetch full detail for a single job by its numeric id |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Anthropic postings mentioning "partnerships"
bun run src/cli.ts search --company anthropic -q "partnerships" --limit 5 --format table

# Stripe roles posted in the last 14 days
bun run src/cli.ts search --company stripe --jobage 14 --format table

# Full detail for one job (id from a search result's id)
bun run src/cli.ts detail 4461450008 --company anthropic --format plain
```

See `../SKILL.md` for the full flag reference and the client-side-vs-server-side
notes on `--query`, `--jobage`, and `--page`.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--company` | `-c` | **Required.** Greenhouse board slug. |
| `--query` | `-q` | Keyword filter on title (and description with `--with-description`). Client-side — no server-side search endpoint exists. |
| `--jobage` | | Posted within N days, filtered client-side on `first_published`. |
| `--page` | | 1-indexed page over the filtered list. Client-side — Greenhouse returns the whole board in one response. |
| `--limit` | `-n` | Results per page. Default 25. |
| `--format` | | `json` \| `table` \| `plain`. |
| `--with-description` | | Fetch full posting text for every job in the list call (`content=true`) and let `--query` match it too. Off by default. |

Why several flags are client-side: Greenhouse's Job Board API has no documented
keyword-search or pagination parameters, and live testing confirmed an
undocumented `q=`/`page=` param is silently ignored (the full board comes back
every time) — see `../url-reference.md`.
