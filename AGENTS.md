# AGENTS.md — pi-supergsd

## What this project is

A Pi extension that packages curated, patched [Superpowers](https://github.com/obra/superpowers) skills for Pi users.

**Build time:** `npm run update` clones the upstream Superpowers repo, applies declarative patches, and writes patched skills to `skills/`.

**Runtime:** `index.ts` serves skills via Pi's `resources_discover` event.

## Architecture

```
pi-supergsd/
├── index.ts                    # Pi extension entry point (runtime, no network calls)
├── skills/                     # Skills: generated (from updater) + custom (hand-written; committed)
├── updater/
│   ├── updater.ts              # Entry script: clones, patches, writes
│   ├── common-patch.json       # Patches applied to EVERY file after per-file patches
│   ├── skills/                 # One JSON definition per upstream-derived skill
│   │   ├── brainstorming.json
│   │   ├── systematic-debugging.json
│   │   └── ... (10 total)
│   └── lib/
│       ├── patcher.ts          # Pure patch engine (no side effects)
│       ├── patcher.test.ts     # Unit tests for patch engine
│       ├── source.ts           # Git clone/update and local file reader
│       ├── source.test.ts      # Black-box tests for git source module
│       └── types.ts            # Shared TypeScript types
```

## Key conventions

- **TypeScript**, ES modules (`"type": "module"`), Node 20+, `tsx` for execution
- **Native `fetch`**, Node built-in test runner (`node:test`)
- Patches are applied in order: **per-file patches first, then common patches**
- The `updater/` directory is build-time tooling. `index.ts` and `skills/` are runtime assets.

## How to test

```bash
# Run all tests (updater tests + release scripts)
npm test

# Run the updater — fetches fresh skills from upstream, applies patches
npm run update

# Type-check everything
npx tsc --noEmit
```

The updater exits non-zero if any patch fails to match upstream content. This is intentional — it catches upstream drift.

## How to add or modify a skill

### Upstream-derived skills

Skills that originate from the [Superpowers](https://github.com/obra/superpowers) repo are defined in `updater/skills/<name>.json` and regenerated via `npm run update`.

1. Create `updater/skills/<name>.json` (see existing files for format)
2. Run `npm run updater`
3. Verify the output in `skills/<name>/`
4. Commit both the definition and generated files

### Custom skills

Skills that don't exist upstream (e.g. `writing-roadmaps`) are written directly into `skills/<name>/`.

1. Create `skills/<name>/SKILL.md` with proper frontmatter (`name`, `description`)
2. Add any supporting files alongside SKILL.md
3. Commit the changes

Custom skills in `skills/` coexist with updater-generated skills. Running `npm run updater` only touches skills that have definitions in `updater/skills/` — custom skills are left alone.

### Skill definition format

```json
{
  "name": "my-skill",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "Claude Code", "replace": "Pi" }
      ]
    }
  ],
  "exclude": ["optional-file-to-skip.md"]
}
```

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
- **Per-file patches run first.** They operate on original upstream content. Common patches normalize afterward. Write per-file `find` strings against upstream text (e.g. `superpowers:`, not `/skill:`).
- **Always verify after running updater.** Check that generated files look correct before committing.
- **`index.ts` is not type-checked cleanly without Pi's runtime types.** The `@earendil-works/pi-coding-agent` types are provided at runtime by Pi. Only `updater/` files need to compile with `npx tsc --noEmit`.
