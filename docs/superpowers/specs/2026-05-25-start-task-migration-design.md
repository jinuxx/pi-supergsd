# `/start-task` Migration — Skill Updates Design

**Status:** approved
**Date:** 2026-05-25

## Purpose

Update pi-supergsd skills to use `push-task`'s new `context` parameter, the `/start-task` command, and `/return` verbatim handoff — all introduced in pi-navigator's handoff mode update. Skills currently reference the older `/start-fresh`-based workflow.

## Background

pi-navigator recently added:

- **`push-task` `context` parameter** — `"fresh"` (default) or `"branch"`, controlling context mode
- **`/start-task` command** — consumes a pending task, starts it as a subagent. Uses `last-response` handoff so the result comes back verbatim
- **`/start-branch` and `/start-fresh` no longer consume tasks** — they ignore pending tasks, which stay queued for `/start-task`
- **`/return` overrides** — `/return last` (verbatim), `/return summary` (forced summary)

## Scope

Update four skills that already use `push-task` + `/start-fresh`:

| Skill | File |
|---|---|
| brainstorming | `skills/brainstorming/SKILL.md` |
| writing-plans | `skills/writing-plans/SKILL.md` |
| requesting-code-review | `skills/requesting-code-review/SKILL.md` |
| writing-skills | `skills/writing-skills/SKILL.md` |

| Skill | Context | Push-task calls |
|---|---|---|
| brainstorming | `fresh` | 1 |
| writing-plans | `fresh` | 1 |
| requesting-code-review | `fresh` | 1 (+ example) |
| writing-skills | `branch` | 3 |

## Per-Skill Changes

### Common pattern for fresh-context skills (brainstorming, writing-plans, requesting-code-review)

The before/after blocks below illustrate the pattern. They are not literal find/replace scripts — the planner must locate exact text in each file.

**Before:**
```
Call `push-task({ prompt: "..." })`
Tell the user: "Run `/start-fresh` for a fresh-context review..."
After `/return`, incorporate the summary findings...
```

**After:**
```
Call `push-task({ prompt: "...", context: "fresh" })`
Tell the user: "Run `/start-task` for a fresh-context review..."
After `/return`, incorporate the review findings...
```

Key change: "summary findings" → "review findings" because `/start-task` uses `last-response` handoff (verbatim result, not summarized).

### writing-skills (branch context)

**Before:**
```
Call `push-task({ prompt: <pressure scenario> })`
Tell the user: "Run `/start-fresh` to run the baseline scenario."
After `/return`, document the agent's choices...
```

**After:**
```
Call `push-task({ prompt: <pressure scenario>, context: "branch" })`
Tell the user: "Run `/start-task` to run the baseline scenario."
After `/return`, document the agent's choices...
```

All three push-task calls (RED baseline, GREEN with-skill, REFACTOR verification) use `context: "branch"` so the agent retains memory of the skill it just wrote and the design decisions behind it.

### requesting-code-review: "branch summary" → verbatim language

The file uses "branch summary" in two places that should reflect verbatim results:

- **Line 37:** "read the branch summary and act on feedback" → "read the review output and act on feedback"
- **Line 61 (example):** `[After /return, branch summary contains]:` → `[After /return, review output]:`

With `/start-task`, the handoff mode is `last-response`, so the review comes back verbatim — not summarized.

### requesting-code-review: example `push-task` call

The narrative example at the end of the requesting-code-review flow also needs updating:

**Before:**
```
`push-task({ prompt: "You are a Senior Code Reviewer... [review body from code-reviewer.md, filled with BASE_SHA=a7981ec, HEAD_SHA=3df7661, DESCRIPTION=Added verifyIndex() and repairIndex() with 4 issue types, PLAN_OR_REQUIREMENTS=Task 2 from docs/superpowers/plans/deployment-plan.md]" })`
```

**After:**
```
`push-task({ prompt: "You are a Senior Code Reviewer... [review body from code-reviewer.md, filled with BASE_SHA=a7981ec, HEAD_SHA=3df7661, DESCRIPTION=Added verifyIndex() and repairIndex() with 4 issue types, PLAN_OR_REQUIREMENTS=Task 2 from docs/superpowers/plans/deployment-plan.md]", context: "fresh" })`
```

The surrounding prose (`[After /return, branch summary contains]:`) is already covered by the verbatim-language fix above.

## Design Principles

1. **Conditional with fallback** — unchanged from prior design. Every `push-task` instruction keeps its "Otherwise:" fallback.
2. **User controls transitions** — unchanged. The LLM calls `push-task`, tells the user to run `/start-task`.
3. **Self-contained prompts** — unchanged. Prompts passed to `push-task` must be fully self-contained. This is already true; no prompt content changes.
4. **`context` explicit** — always include the `context` parameter for clarity, even when it matches the default (`"fresh"`).
5. **Verbatim results** — note that `/start-task` returns the last assistant message verbatim (not summarized), which is a benefit for review tasks.

## Verification

After implementation, confirm no stale `/start-fresh` references remain in the four affected skill files:

```bash
grep -n "start-fresh" skills/brainstorming/SKILL.md skills/writing-plans/SKILL.md skills/requesting-code-review/SKILL.md skills/writing-skills/SKILL.md
```

Expected: no output. Any match means a reference was missed.
