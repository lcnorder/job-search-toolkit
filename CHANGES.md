# Changes relative to upstream

This repository is a fork of [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
(MIT License, Copyright (c) 2026 Mads Lorentzen). All credit for the original framework —
the `/setup`, `/scrape`, `/rank`, `/apply`, `/interview`, `/outcome` workflow, the CV/cover-letter
LaTeX templates, and the job-application-assistant skill — belongs to the upstream project.
If you just want the original, go there instead.

This fork adds:

1. **Claude Code plugin packaging** (`.claude-plugin/`) — lets the toolkit be installed with
   `/plugin` in addition to `git clone` / "Use this template".
2. **Four additional portal-search skills** under `.agents/skills/`: `greenhouse-search`,
   `getro-search`, `consider-search`, `jobleads-search`. Generic ATS/aggregator scrapers,
   no sector- or location-specific assumptions.
3. **A `/reset` fix**: upstream's `/reset` did not clear a "Patterns Observed" section that
   `/setup`'s writing-style analysis can add to `03-writing-style.md`, so a candidate's personal
   writing patterns could survive a reset. This fork's `/reset` clears it too.

Nothing else is changed. `CLAUDE.md`, the candidate-profile skill files, `cv/main_example.tex`,
and every other file are byte-for-byte upstream.

The additions above are offered back to upstream as a pull request where appropriate — check
the upstream repo before assuming this fork has anything the original doesn't.
