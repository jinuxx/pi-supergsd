# Auto Test Decoupling — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the existing `runAuto` to `legacyRunAuto`, implement a new `runAuto(config)` with empty-reactions support and automated idle-loop pumping, and port the simplest auto test ("no pending tasks") to use it.

**Architecture:** The new `runAuto` wraps the auto command handler and pumps idle waiters internally. It runs the handler to completion (or step-cap failure) without exposing `releaseNextIdle` or `flushMicrotasks` to the test. `legacyRunAuto` is returned alongside it so the 6 non-migrated auto tests keep working. The `AutoConfig` interface is defined with placeholder match/reaction types for future phases.

**Tech Stack:** Node 20+, TypeScript, node:test, node:assert, tsx

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-30-auto-test-decoupling-roadmap.md`](../roadmaps/2026-05-30-auto-test-decoupling-roadmap.md)

**Phase:** Phase 1: Minimal `runAuto` engine + simplest test

---

### File Map

| File | Role |
|------|------|
| `index.test.ts` | **Modify.** `makeHarness()`: rename `runAuto` → `legacyRunAuto`, add new `runAuto`, update return statement. `describe('automated workflow')`: update all non-ported tests to use `legacyRunAuto`, rewrite test #3. Add `AutoConfig`, `MatchDescriptor`, `ReactionDescriptor` types after `makeHarness`. |
| `index.ts` | **Not modified in this phase.** |

---

### Task 1: Rename `runAuto` to `legacyRunAuto` in harness

**Files:**
- Modify: `index.test.ts:1270-1273` (function definition)
- Modify: `index.test.ts:1285` (return statement)
- Modify: `index.test.ts:780,819,861,884,899,914,933` (test destructuring)

- [ ] **Step 1: Rename the function definition**

In `makeHarness()`, at ~line 1270, rename the function:

```ts
  function legacyRunAuto(): Promise<void> {
    return createAutoCommand(pi).handler('', ctx) as Promise<void>;
  }
```

- [ ] **Step 2: Update the return statement**

At ~line 1285 in the return object, change `runAuto` to `legacyRunAuto`:

```ts
  return {
    assertBranchHistory,
    isLlmTriggered,
    getStatus,
    appendUserMessage,
    appendAssistantMessage,
    releaseNextIdle,
    flushMicrotasks,
    emitSessionShutdown,
    setPendingMessages,
    setCancelNextNav,
    runPushTask,
    runStartTask,
    runFinishTask,
    runDiscardTask,
    runAbortTask,
    legacyRunAuto,
  };
```

- [ ] **Step 3: Update all non-ported test destructuring to use `legacyRunAuto`**

In `describe('automated workflow', ...)`, update the 6 non-ported tests. Each currently destructures `runAuto` — change to `legacyRunAuto`. Also update the local variable names where the destructured name is used.

Test "completes push-task -> /auto -> finish-task" (~line 780):
```ts
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, legacyRunAuto } =
      makeHarness();
    // ... later:
    const running = legacyRunAuto();
```

Test "returns the branch result..." (~line 819):
```ts
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, legacyRunAuto } =
      makeHarness();
    // ...
    const running = legacyRunAuto();
```

Test "stops when navigation is cancelled..." (~line 861):
```ts
    const { appendUserMessage, assertBranchHistory, isLlmTriggered, setCancelNextNav, releaseNextIdle, flushMicrotasks, runPushTask, legacyRunAuto } =
      makeHarness();
    // ...
    const running = legacyRunAuto();
```

Test "warns and returns when /auto is already running" (~line 899):
```ts
    const { assertBranchHistory, releaseNextIdle, flushMicrotasks, emitSessionShutdown, legacyRunAuto } =
      makeHarness();
    // ...
    const firstRun = legacyRunAuto();
    // ...
    await legacyRunAuto();
```

Test "stops when the last assistant message was aborted" (~line 914):
```ts
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, legacyRunAuto } =
      makeHarness();
    // ...
    const running = legacyRunAuto();
```

Test "keeps waiting while follow-up work is pending..." (~line 933):
```ts
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, setPendingMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, legacyRunAuto } =
      makeHarness();
    // ...
    const running = legacyRunAuto().then(() => { resolved = true; });
```

- [ ] **Step 4: Run tests to verify rename didn't break anything**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass (same as before rename, just using the new name).

- [ ] **Step 5: Commit**

```bash
git add index.test.ts
git commit -m "refactor: rename runAuto to legacyRunAuto in harness"
```

---

### Task 2: Add `AutoConfig` type and placeholder match/reaction types

**Files:**
- Modify: `index.test.ts` — after `makeHarness()` closing brace, before `notification()` helper

- [ ] **Step 1: Add the type definitions**

After the `makeHarness` function's closing `}` (~line 1290), before the `notification` helper, add:

```ts
// ── Auto test types (Phase 1: placeholders for future phases) ───

type MatchDescriptor = Record<string, unknown>;
type ReactionDescriptor = Record<string, unknown>;

interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
}
```

- [ ] **Step 2: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "feat: add AutoConfig and placeholder match/reaction types"
```

---

### Task 3: Implement new `runAuto(config)` with idle-loop automation

**Files:**
- Modify: `index.test.ts` — `makeHarness()`, after `legacyRunAuto` function definition (~line 1273), before the return statement

- [ ] **Step 1: Add the new `runAuto` function inside `makeHarness`**

After the `legacyRunAuto` function (~line 1273), before the return statement, add:

```ts
  async function runAuto(config: AutoConfig): Promise<void> {
    let settled = false;
    const handlerPromise = createAutoCommand(pi).handler('', ctx).finally(() => { settled = true; });

    const MAX_STEPS = 100;
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      // Yield so any pending microtasks from the handler flush
      await Promise.resolve();

      const waiter = idleWaiters.shift();
      if (waiter) {
        waiter();
        // Drain microtasks so the handler body executes past the resolved await
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    }

    if (!settled) {
      throw new Error('runAuto did not complete within step cap');
    }

    await handlerPromise;
  }
```

- [ ] **Step 2: Add `runAuto` to the return statement**

At ~line 1285, add `runAuto` alongside `legacyRunAuto` in the return object:

```ts
    legacyRunAuto,
    runAuto,
  };
```

- [ ] **Step 3: Run tests — verify existing tests still pass**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. The new `runAuto` isn't called yet, so no new behavior is exercised. `legacyRunAuto` still serves all 7 auto tests.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "feat: add new runAuto(config) with idle-loop automation alongside legacyRunAuto"
```

---

### Task 4: Port "no pending tasks" test to use new `runAuto`

**Files:**
- Modify: `index.test.ts:883-894` — rewrite the test

- [ ] **Step 1: Replace the existing test with the rewritten version**

Replace the existing test at lines 883–894:

```ts
  it('notifies and exits when started with no pending tasks', async () => {
    const h = makeHarness();
    await h.runAuto({ reactions: [] });
    h.assertBranchHistory(
      notification('No pending tasks to run.'),
    );
  });
```

- [ ] **Step 2: Run the specific test to verify it passes**

```bash
npx tsx --test --test-name-pattern="notifies and exits when started with no pending tasks" index.test.ts
```

Expected: PASS — the new `runAuto` resolves idle waiters internally, the auto handler sees no tasks, notifies, and exits.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. 6 auto tests still use `legacyRunAuto`. 1 uses new `runAuto`.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: port 'no pending tasks' test to new runAuto(config)"
```

---

### Task 5: Verify full gate

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run verify
```

Expected: All gates pass — lint, tsc, test, updater, skill drift, pack.

- [ ] **Step 2: Commit (if any fixups needed)**

If `npm run verify` reveals issues (e.g., lint), fix them, then:

```bash
git add -A
git commit -m "chore: fix verification issues for Phase 1"
```
