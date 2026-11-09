# consider-cli

CLI for searching **Consider-platform** VC-portfolio job boards — `careers.<org>.com` sites
like `careers.foresitecapital.com` (Foresite Capital).

**Data source**: two same-origin endpoints on the board's own hostname — `GET /jobs` (to mint
a session: a CSRF token + cookies from `window.serverInitialData`) and `POST
/api-boards/search-jobs` (the real search, using that session). No cross-origin API host to
worry about, unlike `getro-search`'s `api.getro.com`.
**Authentication**: None required — the CLI mints its own throwaway session per invocation.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev
type defs.

> **Personal use only.** `robots.txt` on the verified board is open (`Allow: /` except for
> `LinkedInBot`), but Consider's own Terms of Service prohibit automated
> crawling/scraping of the Services. Keep volume low, don't use it commercially or for bulk
> data collection, and run it on your own responsibility — see `../SKILL.md`.

> **Verify the platform before trusting a new `--board` host.** A `careers.<vc>.com` or
> `jobs.<vc>.com` VC portfolio board could be Consider, Getro, or something else entirely —
> see `../SKILL.md`'s "Verify the platform" section before pointing `--board` at a host not
> already in the verified-boards table.

## Installation

```bash
cd .agents/skills/consider-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search a Consider board's jobs (`--board` required) |
| `detail` | Fetch detail for a single job listing — only works for the (rare) jobs Consider hosts directly; see `../SKILL.md` |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format
json|plain`. All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with
exit code `1`.

## Quick examples

```bash
# Business development roles at Foresite's portfolio companies
bun run src/cli.ts search --board careers.foresitecapital.com -q "business development" --limit 5 --format table

# Finance department openings
bun run src/cli.ts search --board careers.foresitecapital.com --department Finance --format table

# Full detail for one job (works only if Consider hosts it directly)
bun run src/cli.ts detail "delfi-diagnostics::dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e" --board careers.foresitecapital.com --format plain
```

See `../SKILL.md` for the full flag reference, the verified-boards table, and the
Terms-of-Service note.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--board` | `-b` | **Required.** Consider board hostname, e.g. `careers.foresitecapital.com`. |
| `--query` | `-q` | Keywords. **Re-ranks, does not filter** — see `../SKILL.md`. |
| `--location` | `-l` | Free-text place string, e.g. `"San Francisco, California"`. A bare city name alone did not match anything in testing — use the fuller normalized form. Separate multiple places with `;`, not `,`. |
| `--department` | | Comma-separated department label(s), e.g. `Finance,Engineering`. |
| `--remote` | | Boolean flag — only remote-eligible postings. |
| `--jobage` | | Posted within N days — confirmed server-side filter (unlike Getro's client-side-only equivalent). |
| `--page` | | 1-indexed. Costs N-1 extra round trips to reach page N (cursor-based pagination). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
| `--facet` | | `key=value`, repeatable. Unverified escape hatch — seniority filtering in particular was tried and not found to work under several guessed keys. |
