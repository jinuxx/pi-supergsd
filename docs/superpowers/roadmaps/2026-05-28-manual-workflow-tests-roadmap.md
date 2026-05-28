# Manual Workflow Tests Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** Extend manual workflow tests with abort-inherited (1), recursive (12), and multi-stacked (4) task coverage — 17 new tests in `index.test.ts`.

**Design Spec:** [`docs/superpowers/specs/2026-05-28-manual-workflow-tests-design.md`](../specs/2026-05-28-manual-workflow-tests-design.md)

**Planning Strategy:** While small enough for a single detailed plan, the 17 tests are grouped into three orthogonal scenario families. Each phase adds one scenario family, keeping each plan focused on a single pattern. The phases are independent (no test depends on another) but are ordered by complexity for ease of writing and reviewing.

---

## Phase 1: Abort + Multi-stacked tasks

**Outcome:** 5 new tests — one for abort with inherited context, four for the multi-stacked push pattern (all context combos).

**Why now:** Foundations first — abort inherited is the simplest extension of an existing test, and multi-stacked is a straightforward two-push LIFO flow with no nesting.

**Scope:**
- Abort with inherited context test
- Multi-stacked push → push → start → finish → start → finish (4 context combos)

**Out of scope:**
- Recursive/nested task tests

**Key files/areas likely affected:**
- `index.test.ts`: new `it` blocks under `describe('manual workflow')`

**Dependencies:** None

**Verification:**
- All 5 new tests pass
- All existing 32 tests still pass
- `npm run verify` passes (lint → tsc → test → updater → drift → pack)

**Phase boundary health:** New tests are pure additions — no existing code changes, no shared state. CI green after phase.

**Risks:** None significant.

**Context notes:** Follow existing test patterns — use `appendUserMessage`, `appendAssistantMessage`, `runPush*` helpers, and `assertBranchHistory` exactly like the existing tests.

---

## Phase 2: Recursive tasks — finish→finish

**Outcome:** 4 new tests for the recursive push → start → push → start → finish → finish pattern, covering all 4 context combos.

**Why now:** The most common recursive pattern — both nested tasks complete normally.

**Scope:**
- finish→finish recursive tests (4 context combos)

**Out of scope:**
- discard or abort recursive patterns

**Key files/areas likely affected:**
- `index.test.ts`: new `it` blocks

**Dependencies:** Phase 1 (want the abort+multi tests committed before adding recursive tests for clean git history)

**Verification:**
- All 4 new tests pass
- All existing tests still pass
- `npm run verify` passes

**Phase boundary health:** Pure additions to the test file. CI green after phase.

**Risks:** None significant.

**Context notes:** After `finishTask` on inner task, the outer task is still "current". The task-result injection happens on the outer task's branch before the outer finishTask navigates back to root.

---

## Phase 3: Recursive tasks — discard→finish

**Outcome:** 4 new tests for the recursive push → start → push → discard → finish pattern, covering all 4 context combos.

**Why now:** The inner task is discarded without doing any work.

**Scope:**
- discard→finish recursive tests (4 context combos)

**Out of scope:**
- abort recursive pattern

**Key files/areas likely affected:**
- `index.test.ts`: new `it` blocks

**Dependencies:** Phase 2 (same family, same file)

**Verification:**
- All 4 new tests pass
- All existing tests still pass
- `npm run verify` passes

**Phase boundary health:** Pure additions. CI green.

**Risks:** None.

**Context notes:** After `discardTask`, the inner task is marked done, and the outer task becomes current again. No LLM was triggered for the inner task.

---

## Phase 4: Recursive tasks — abort→finish

**Outcome:** 4 new tests for the recursive push → start → push → start → abort → finish pattern, covering all 4 context combos.

**Why now:** The inner task is started, partially worked on, then aborted — the most complex recursive pattern.

**Scope:**
- abort→finish recursive tests (4 context combos)

**Out of scope:**
- Anything beyond the 17 specified tests

**Key files/areas likely affected:**
- `index.test.ts`: new `it` blocks

**Dependencies:** Phase 3

**Verification:**
- All 4 new tests pass
- All 36 previous tests still pass
- `npm run verify` passes

**Phase boundary health:** Pure additions. CI green.

**Risks:** None.

**Context notes:** After `abortTask`, the inner task remains pending (not discarded). Status shows "pending task: inner-task" on the outer task branch. Outer still current. Then finishTask navigates from outer back to root, injecting the outer task result.
