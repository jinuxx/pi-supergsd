# Auto Test Decoupling Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** Decouple `/auto` tests from internal implementation by replacing 6 orchestration helpers with a single `runAuto(config)` method backed by a reactions engine, and moving auto state tracking from module-level `autoState` into a closure with status-line observability.

**Design Spec:** [`docs/superpowers/specs/2026-05-30-auto-test-decoupling-design.md`](../specs/2026-05-30-auto-test-decoupling-design.md)

**Planning Strategy:** The design is compact (2 files, 1 new method, 9 rewritten tests) but the reactions engine is novel — implementing it incrementally alongside test migration prevents over-engineering. Each phase introduces helpers for one group of reactions, ports at most 3 tests, and verifies the group works before adding complexity. The legacy infrastructure (`legacyRunAuto`, `releaseNextIdle`, etc.) stays in place until the final phase when all tests are migrated and cleanup is safe.

---

## Phase 1: Minimal `runAuto` engine + simplest test

**Outcome:** `legacyRunAuto` exists alongside a new `runAuto(config)` that supports empty reactions (`{ reactions: [] }`). One test is ported: "notifies when no pending tasks." The engine loop automates `waitForIdle()` resolution and enforces a step cap.

**Why now:** Foundation. The idle-pumping engine must work before any matching or reaction logic. Porting the simplest test validates the engine without introducing match/reaction complexity.

**Scope:**
- Rename current `runAuto` to `legacyRunAuto` in `makeHarness`
- New `runAuto(config: AutoConfig)` with empty-reactions support
- Internal loop: resolve `waitForIdle()`, step cap (~100), return `Promise<void>`
- Port test: "notifies and exits when started with no pending tasks" (test #3)

**Out of scope:**
- Match descriptors, reaction descriptors, any reaction types
- Status line `[auto]` prefix
- Source `autoState` removal
- Any other test migration

**Key files/areas likely affected:**
- `index.test.ts`: `makeHarness()` — rename `runAuto` → `legacyRunAuto`, add new `runAuto`
- `index.test.ts`: `describe('automated workflow')` — migrate test #3

**Dependencies:** None.

**Verification:**
- Test #3 passes with new `runAuto({ reactions: [] })`
- All existing tests (manual workflow, remaining auto tests via `legacyRunAuto`) still pass
- `npm test` green

**Phase boundary health:** Legacy and new `runAuto` coexist. All non-migrated auto tests still use `legacyRunAuto` unchanged. No regression.

**Risks:**
- Step cap too low for edge cases — mitigation: generous cap (~100), refine later

**Context notes:** The new `runAuto` at this phase resolves `waitForIdle()` but has no matching engine — after each idle it just checks auto's own loop logic. This is sufficient for the "no pending tasks" test.

---

## Phase 2: `user`/`assistant` match+reaction + fresh/inherit context tests

**Outcome:** `runAuto` supports `user()` and `assistant()` as both match descriptors and reaction descriptors. Two tests ported: "push→auto→finish (fresh context)" and "push→auto→finish (inherit context)."

**Why now:** These tests drive the core reactions feature — matching user messages and injecting assistant responses. They also validate auto completes end-to-end with real task flow.

**Scope:**
- Implement `user("text")` match descriptor: scans branch for new user messages containing pattern
- Implement `assistant("text")` reaction descriptor: injects an assistant message entry
- Basic matching engine: after each idle, scan branch for new entries, find first matching reaction pair, apply
- Port tests #1 and #2

**Out of scope:**
- `userEsc()`, `userCtrlC()`, `userRunsAuto()`
- `task()` as reaction descriptor
- Pending-message tracking for steering scenarios
- Status line `[auto]` prefix (tests don't assert on it yet)

**Key files/areas likely affected:**
- `index.test.ts`: `makeHarness()` — match/reaction engine additions
- `index.test.ts`: `describe('automated workflow')` — migrate tests #1, #2

**Dependencies:** Phase 1 (minimal engine).

**Verification:**
- Tests #1 and #2 pass with new `runAuto`
- Tests #3–#9 still pass via `legacyRunAuto`
- `npm test` green

**Phase boundary health:** Three tests migrated. Remaining 7 auto tests still use `legacyRunAuto`. No feature regression.

**Risks:**
- Matching logic too naive (exact substring vs. contains) — mitigation: "contains" is the spec; implement strictly

**Context notes:** The matching engine at this phase is stateless: scan branch for any new entry matching any reaction pair's match descriptor. Since reactions are immutable, the same pair can fire again if the pattern reappears — correct per spec.

---

## Phase 3: `userEsc` + navigation cancel and aborted assistant tests

**Outcome:** `userEsc()` reaction descriptor is implemented. Two tests ported: "stops when navigation cancelled" and "stops after aborted assistant."

**Why now:** `userEsc` introduces the first non-message reaction type — it cancels `navigateTree` and stops the loop. Two tests exercise different entry points for this behavior.

**Scope:**
- `userEsc()` helper: returns `{ type: 'user-esc' as const }`
- Harness: when `userEsc` fires, cancel next `navigateTree` call and stop auto loop
- Port tests #4 and #5

**Out of scope:**
- `userCtrlC()`, `userRunsAuto()`
- `task()` as reaction descriptor
- Pending-message tracking

**Key files/areas likely affected:**
- `index.test.ts`: `userEsc` helper, reaction handler for `user-esc` type
- `index.test.ts`: `describe('automated workflow')` — migrate tests #4, #5

**Dependencies:** Phase 2 (match/reaction engine, `user`/`assistant` descriptors).

**Verification:**
- Tests #4 and #5 pass with new `runAuto`
- Tests #1–#3 still pass with new `runAuto`
- Remaining tests still pass via `legacyRunAuto`
- `npm test` green

**Phase boundary health:** Five tests migrated. `legacyRunAuto` serves 4 remaining tests.

**Risks:**
- `navigateTree` cancellation timing — must cancel the *first* nav call in that idle cycle, not a later one. Mitigation: cancel flag consumed atomically.

**Context notes:** Test #5 uses a multi-step reaction: `[user(...), assistant(...)]` then `[assistant(...), userEsc()]`. This validates that the matching engine correctly handles reaction chains where the output of one pair becomes the input match for the next.

---

## Phase 4: `user`, `task`, `userCtrlC` reactions + subtask, steering, and shutdown tests

**Outcome:** `user()` as reaction descriptor, `task()` as reaction descriptor, and `userCtrlC()` reaction are implemented. Pending-message tracking is added to the harness. Three tests ported: "subtask within a task," "user steering message queued," and "session shutdown during auto."

**Why now:** This phase introduces all remaining reaction types except `userRunsAuto`. The subtask and steering tests need `task()` and `user()` as reactions, respectively. Session shutdown needs `userCtrlC`. Three tests fit together because they all extend the reaction engine rather than adding fundamentally new mechanisms.

**Scope:**
- `user("text")` as reaction descriptor: injects a user message entry
- `task("prompt")` / `task("prompt", inherit)` as reaction descriptor: injects a task custom entry
- `userCtrlC()` helper: returns `{ type: 'user-ctrl-c' as const }`
- Harness: pending-message-aware loop continuation (auto doesn't exit while reaction work remains)
- Port tests #6, #8, #9

**Out of scope:**
- `userRunsAuto()`
- Status line `[auto]` prefix assertion (deferred to Phase 5)

**Key files/areas likely affected:**
- `index.test.ts`: `userCtrlC` helper, reaction handlers for user/task/ctrl-c
- `index.test.ts`: pending-message tracking in matching engine
- `index.test.ts`: `describe('automated workflow')` — migrate tests #6, #8, #9

**Dependencies:** Phase 3 (reaction engine, `userEsc`).

**Verification:**
- Tests #6, #8, #9 pass with new `runAuto`
- Tests #1–#5 still pass with new `runAuto`
- Test #7 still passes via `legacyRunAuto`
- `npm test` green

**Phase boundary health:** Eight tests migrated. Only test #7 ("already running") remains on `legacyRunAuto`.

**Risks:**
- `userCtrlC` needs session shutdown → triggers `stopped` flag in auto's closure. The harness must dispatch shutdown handlers after the reaction fires. Mitigation: call shutdown handlers between idle resolutions.

**Context notes:** Test #8 (steering) exercises pending-message tracking: after `assistant("thinking...")` matches, the `user("steer it")` reaction hasn't fired yet, so the harness treats this as pending work and keeps the loop alive. This requires the matching engine to track "seen but not fully applied" pairs.

---

## Phase 5: `userRunsAuto` + already-running test + source changes + cleanup

**Outcome:** The final test is ported. Source changes applied (`autoState` → closure, `[auto]` status prefix). All legacy helpers removed from the harness. `legacyRunAuto` deleted.

**Why now:** This is the cleanup phase. All tests are on the new `runAuto`, so legacy infrastructure is dead code. Source changes are applied last because they don't affect the test migration — they only change how auto reports state.

**Scope:**
- `userRunsAuto()` helper: returns `{ type: 'user-runs-auto' as const }`
- Harness: when `userRunsAuto` fires, invoke `/auto` handler again from within the active run
- Port test #7 ("already running")
- Source change: remove `autoState`, move `stopped` flag into `createAutoCommand` closure
- Source change: wrap `updateTaskStatus` with `[auto]` prefix while running
- Add `getStatus()` assertions to test #1 (verify `[auto]` prefix appears/clears)
- Remove from harness: `legacyRunAuto`, `releaseNextIdle`, `flushMicrotasks`, `emitSessionShutdown`, `setPendingMessages`, `setCancelNextNav`
- Remove unused mocks from `ctx` (e.g., `hasPendingMessages` if no longer needed, `navigateTree` cancellation controlled by reactions)

**Out of scope:**
- None — this is the final phase.

**Key files/areas likely affected:**
- `index.ts`: `createAutoCommand` — closure-based running state, status prefix
- `index.ts`: remove `autoState`
- `index.ts`: `updateTaskStatus` wrapper for auto prefix
- `index.test.ts`: `userRunsAuto` helper, reaction handler
- `index.test.ts`: `makeHarness()` — remove legacy helpers
- `index.test.ts`: `describe('automated workflow')` — migrate test #7

**Dependencies:** Phase 4 (all other reactions, all other tests).

**Verification:**
- All 9 auto tests pass with new `runAuto`
- All manual workflow tests pass unchanged
- `npm test` green
- `npm run verify` green (lint, tsc, test, updater, skill drift, pack)
- No references to `legacyRunAuto`, `releaseNextIdle`, `flushMicrotasks`, `emitSessionShutdown`, `setPendingMessages`, `setCancelNextNav` remain in codebase

**Phase boundary health:** Final state. All helpers removed. Single `runAuto(config)` API. Source uses closure-based state.

**Risks:**
- `userRunsAuto` is the most complex reaction — invoking auto reentrantly while the first invocation is mid-loop. Mitigation: the harness tracks a "currently running" flag, detects the reentrant call, and handles the "already running" notification+return path directly rather than going through the full auto handler.

**Context notes:** When removing `emitSessionShutdown`, confirm no other test depends on it. The `session_shutdown` handler registration is still needed in the source for real Pi — only the test harness mock is removed. The new `runAuto` handles shutdown internally via `userCtrlC` reactions.
