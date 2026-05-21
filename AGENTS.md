# AGENTS.md — pi-supergsd

## What this project is

A Pi extension that packages curated, patched [Superpowers](https://github.com/obra/superpowers) skills for Pi users.

**Build time:** `npm run updater` fetches selected skills from GitHub, applies declarative patches, and writes them to `skills/` and `system-prompt.md`.

**Runtime:** `index.ts` serves skills via Pi's `resources_discover` event and injects the `using-superpowers` guide into the system prompt via `before_agent_start`.

## Architecture

```
pi-supergsd/
├── index.ts                    # Pi extension entry point (runtime, no network calls)
├── system-prompt.md            # Generated: patched using-superpowers guide
├── skills/                     # Generated: patched skill files (committed)
├── updater/
│   ├── updater.ts              # Entry script: fetches, patches, writes
│   ├── common-patch.json       # Patches applied to EVERY file before per-file patches
│   ├── skills/                 # One JSON definition per included skill
│   │   ├── brainstorming.json
│   │   ├── systematic-debugging.json
│   │   └── ... (11 total)
│   └── lib/
│       ├── patcher.ts          # Pure patch engine (no side effects)
│       ├── patcher.test.ts     # Unit tests for patch engine
│       ├── fetcher.ts          # GitHub raw content fetcher with retry/backoff
│       └── types.ts            # Shared TypeScript types
```

## Key conventions

- **TypeScript**, ES modules (`"type": "module"`), Node 20+, `tsx` for execution
- **Native `fetch`**, Node built-in test runner (`node:test`)
- Patches are applied in order: **common patches first, then per-file patches**
- The `updater/` directory is build-time tooling. `index.ts` and `skills/` are runtime assets.

## How to test

```bash
# Run patch engine unit tests (11 tests)
npm test

# Run the updater — fetches fresh skills from upstream, applies patches
npm run updater

# Type-check everything
npx tsc --noEmit
```

The updater exits non-zero if any patch fails to match upstream content. This is intentional — it catches upstream drift.

## How to add or modify a skill

1. Create `updater/skills/<name>.json` (see existing files for format)
2. Run `npm run updater`
3. Verify the output in `skills/<name>/`
4. Commit both the definition and generated files

### Skill definition format

```json
{
  "name": "my-skill",
  "source": { "repo": "obra/superpowers", "ref": "main", "path": "skills/my-skill" },
  "files": [
    { "path": "SKILL.md", "patches": [
      { "op": "replace", "find": "Claude Code", "replace": "Pi" }
    ]}
  ]
}
```

Use `"output": "system-prompt.md"` to write concatenated output to a file instead of `skills/<name>/`.

### Patch operations

| Op | Behavior |
|---|---|
| `replace` | Exact string replacement, all occurrences |
| `regex-replace` | Regex replacement with `$1`, `$2` capture groups |
| `delete-line` | Delete any line containing the find string |
| `delete-block` | Delete lines from `findStart` through `findEnd` (inclusive) |
| `prepend` | Add text at start of file |
| `append` | Add text at end of file |

Patches that don't match are returned in `unmatched` and reported as warnings. The updater exits non-zero if any fail.

## Important gotchas

- **Patches are applied sequentially.** A `delete-line` that removes a line will cause later patches targeting text on that same line to fail. Merge or order carefully.
- **Common patches run first.** The per-file patches operate on content *after* common patches. Make sure `find` strings reflect post-common-patch content (e.g. `/skill:` not `superpowers:`).
- **Always verify after running updater.** Check that generated files look correct before committing.
- **`index.ts` is not type-checked cleanly without Pi's runtime types.** The `@earendil-works/pi-coding-agent` types are provided at runtime by Pi. Only `updater/` files need to compile with `npx tsc --noEmit`.
