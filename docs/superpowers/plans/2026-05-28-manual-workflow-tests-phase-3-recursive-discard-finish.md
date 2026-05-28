# Phase 3: Recursive tasks — discard→finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new manual workflow tests for the recursive push → start → push → discard → finish pattern, covering all 4 outer/inner context combos.

**Architecture:** Pure test additions to `index.test.ts`. No source code changes. After pushing the outer task, starting it, then pushing the inner task, `discardTask()` finds the pending inner task via `pendingTask()` (which walks backward and returns the first pending task — the inner task). It marks it `task-done` without navigating anywhere. The outer task remains "current" (its `task-start` entry is deeper in the branch history). Then `finishTask()` on the outer task navigates back to the main branch with the outer task result.

Key difference from finish→finish: the inner task is NEVER started. It's pushed and then discarded. This means no `startTask()` call on the inner task, no user message for it, no work on it. The branch history after discard shows just the `task()` entry followed by the discard notification.

**Tech Stack:** TypeScript, Node 20+, `node:test`, SessionManager (in-memory)

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-28-manual-workflow-tests-roadmap.md`](../roadmaps/2026-05-28-manual-workflow-tests-roadmap.md)

**Phase:** Phase 3: Recursive tasks — discard→finish

---

## File Structure

**Only file modified:**
- `index.test.ts` — add 4 new `it` blocks under `describe('manual workflow')`, after the previous tests (before `describe('automated workflow')`)

**No files created, no files modified outside `index.test.ts`.**

---

### Task 1: Write recursive discard→finish — fresh outer, fresh inner

**Files:**
- Modify: `index.test.ts` — insert after the last manual workflow test, before `describe('automated workflow')`

**Flow:**
```
pushTask('Outer task.')       → pending task: outer-task
startTask()                   → current task: outer-task (fresh branch: user('Outer task.'))
pushTask('Inner task.')       → pending task: inner-task
discardTask()                 → inner discarded, outer still current (no LLM trigger)
assistant('outer done')
finishTask()                  → outer result on main, status cleared
```

**Assertion map (after each step):**

1. After push outer: `user('main'), assistant('working...'), task('Outer task.'), notification`
   → status: `pending task: outer-task`

2. After startTask (fresh): `user('Outer task.')`
   → status: `current task: outer-task`, isLlmTriggered: true

3. After push inner: `user('Outer task.'), task('Inner task.'), notification`
   → status: `pending task: inner-task`

4. After discardTask: `user('Outer task.'), task('Inner task.'), notification(stored), notification(discarded)`
   → status: `current task: outer-task`, isLlmTriggered: false

5. After outer finishTask: `user('main'), assistant('working...'), task('Outer task.'), taskResult('outer-task', 'outer done'), notification`
   → status: `undefined`, isLlmTriggered: true

- [ ] **Step 1: Write the test**

Insert the following block before `describe('automated workflow', ...)`:

```typescript
  it('recursive discard→finish — fresh outer, fresh inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runDiscardTask } =
      makeHarness();

    // ── Push outer task (fresh context) on main branch ──
    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.');
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start outer task (fresh context — navigate to fresh branch) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
    );

    // ── Push inner task (fresh context) from within outer task ──
    await runPushTask('Inner task.');
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Discard inner task (no navigation, no LLM trigger) ──
    await runDiscardTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      notification('Task discarded.'),
    );

    // ── Work on outer task ──
    appendAssistantMessage('outer done');

    // ── Finish outer task → navigate back to main ──
    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run just this test**

Run: `node --test index.test.ts --test-name-pattern="discard→finish — fresh outer, fresh inner"`

Expected: `pass`

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive discard→finish fresh/fresh"
```

---

### Task 2: Write recursive discard→finish — fresh outer, inherited inner

**Files:**
- Modify: `index.test.ts` — insert after the fresh/fresh test from Task 1

**Flow:**
```
pushTask('Outer task.')        → pending task: outer-task
startTask()                    → current task: outer-task (fresh branch: user('Outer task.'))
pushTask('Inner task.', true)  → pending task: inner-task  (task stored with inherit_context)
discardTask()                  → inner discarded, outer still current
assistant('outer done')
finishTask()                   → outer result on main, status cleared
```

Only difference from Task 1: `runPushTask('Inner task.', true)` — inner task is stored with inherited context flag (but since it's never started, the flag only affects the stored `task` entry data). The discard behavior is identical.

- [ ] **Step 1: Write the test**

Insert after the fresh/fresh test:

```typescript
  it('recursive discard→finish — fresh outer, inherited inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runDiscardTask } =
      makeHarness();

    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.');
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
    );

    // ── Push inner task with inherited context ──
    await runPushTask('Inner task.', true);
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runDiscardTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      notification('Task discarded.'),
    );

    appendAssistantMessage('outer done');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run the test**

Run: `node --test index.test.ts --test-name-pattern="discard→finish — fresh outer, inherited inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive discard→finish fresh/inherited"
```

---

### Task 3: Write recursive discard→finish — inherited outer, fresh inner

**Files:**
- Modify: `index.test.ts` — insert after the fresh/inherited test from Task 2

**Flow:**
```
pushTask('Outer task.', true)  → pending task: outer-task
startTask()                    → current task: outer-task (inherited, user('Outer task.') on main)
pushTask('Inner task.')        → pending task: inner-task
discardTask()                  → inner discarded, outer still current
assistant('outer done')
finishTask()                   → outer result on main, status cleared
```

The outer task stays on the main branch (inherited, no navigation at start). The inner task is pushed but never started.

- [ ] **Step 1: Write the test**

Insert after the fresh/inherited test:

```typescript
  it('recursive discard→finish — inherited outer, fresh inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runDiscardTask } =
      makeHarness();

    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.', true);
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    // Inherited: prior context preserved
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
    );

    // ── Push inner task (fresh context) from within outer task ──
    await runPushTask('Inner task.');
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runDiscardTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      notification('Task discarded.'),
    );

    appendAssistantMessage('outer done');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run the test**

Run: `node --test index.test.ts --test-name-pattern="discard→finish — inherited outer, fresh inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive discard→finish inherited/fresh"
```

---

### Task 4: Write recursive discard→finish — inherited outer, inherited inner

**Files:**
- Modify: `index.test.ts` — insert after the inherited/fresh test from Task 3

**Flow:**
```
pushTask('Outer task.', true)  → pending task: outer-task
startTask()                    → current task: outer-task (inherited, on main)
pushTask('Inner task.', true)  → pending task: inner-task
discardTask()                  → inner discarded, outer still current
assistant('outer done')
finishTask()                   → outer result on main, status cleared
```

Both tasks use inherited context. Everything stays on the main branch. The only navigation is the finishTask return.

- [ ] **Step 1: Write the test**

Insert after the inherited/fresh test:

```typescript
  it('recursive discard→finish — inherited outer, inherited inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runDiscardTask } =
      makeHarness();

    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.', true);
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
    );

    await runPushTask('Inner task.', true);
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runDiscardTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      notification('Task discarded.'),
    );

    appendAssistantMessage('outer done');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run the test**

Run: `node --test index.test.ts --test-name-pattern="discard→finish — inherited outer, inherited inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive discard→finish inherited/inherited"
```

---

### Task 5: Full verification gate

- [ ] **Step 1: Run the verification gate**

Run: `npm run verify`

This runs lint → tsc → test → updater → skill drift → pack. Expected: all pass.

- [ ] **Step 2: If any failures, fix them**

Likely assertion adjustments if a behavior detail differs from expectations. Since discard→finish is simpler than finish→finish (no inner start, no navigation), failures are unlikely.

- [ ] **Step 3: Final commit with meaningful message**

```bash
git add index.test.ts
git commit -m "test: Phase 3 — recursive discard→finish all 4 context combos"
```
