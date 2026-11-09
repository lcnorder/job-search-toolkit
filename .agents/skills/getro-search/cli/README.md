# getro-cli

CLI for searching **Getro-platform** VC-portfolio job boards — `jobs.<org>.com` sites like
`jobs.menlovc.com` (Menlo Ventures) or `jobs.accel.com` (Accel).

**Data source**: each board's own server-rendered `/jobs` and `/companies/*/jobs/*` pages,
via the `__NEXT_DATA__` JSON snapshot Next.js embeds in them. **Never** the shared
cross-origin `api.getro.com` endpoint the boards' own client-side JS uses for real
pagination — its `robots.txt` is `Disallow: /` for everyone, so this CLI doesn't touch it.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev
type defs.

> **Personal use only.** `robots.txt` on every verified board is open, but Getro's own Terms
> of Service prohibit automated crawling/scraping of the Services. Keep volume low, don't use
> it commercially or for bulk data collection, and run it on your own responsibility — see
> `../SKILL.md`.

> **Not every `jobs.<vc>.com` board runs Getro.** `jobs.a16z.com` and
> `jobs.psychedelicalpha.com` look similar but are different platforms entirely — see
> `../SKILL.md`'s "Verified boards" table and `../url-reference.md` before pointing
> `--board` at a new host.

## Installation

```bash
cd .agents/skills/getro-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search a Getro board's jobs (`--board` required) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format
json|plain`. All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with
exit code `1`.

## Quick examples

```bash
# Business development roles at Menlo's portfolio companies
bun run src/cli.ts search --board jobs.menlovc.com -q "business development" --limit 5 --format table

# Senior remote engineering roles at Accel's portfolio companies
bun run src/cli.ts search --board jobs.accel.com -q "engineer" --seniority senior --remote remote --format table

# Full detail for one job
bun run src/cli.ts detail 92787641 --board jobs.menlovc.com --format plain
```

See `../SKILL.md` for the full flag reference, the verified-boards table, and the
Terms-of-Service note.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--board` | `-b` | **Required.** Getro board hostname, e.g. `jobs.menlovc.com`. |
| `--query` | `-q` | Keywords (title / company / skill). |
| `--location` | `-l` | Free-text place string, e.g. `"San Francisco, CA, USA"`. Separate multiple places with `;`, not `,` — the comma is part of the place name. |
| `--seniority` | | Comma-separated, e.g. `senior,mid_senior`. |
| `--remote` | | `remote` \| `onsite` \| `hybrid`. |
| `--jobage` | | Posted within N days — client-side filter over the already-fetched batch only. |
| `--page` | | Must be `1`. See `../SKILL.md` for why. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
| `--facet` | | `key=value`, repeatable. Unverified escape hatch beyond the flags above. |
