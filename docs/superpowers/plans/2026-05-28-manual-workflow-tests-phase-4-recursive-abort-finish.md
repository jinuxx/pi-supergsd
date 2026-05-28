# Phase 4: Recursive tasks — abort→finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new manual workflow tests for the recursive push → start → push → start → abort → finish pattern, covering all 4 outer/inner context combos.

**Architecture:** Pure test additions to `index.test.ts`. No source code changes. The inner task is started, partially worked on, then aborted. `abortTask` navigates back to the `returnTo` point (the inner task entry's leaf) — it does NOT append `task-done`, so the inner task remains pending. The outer task remains "current" after the abort (its `task-start` is deeper in the branch history). Then work on the outer task continues, and `finishTask` completes the outer task, navigating back to the main branch.

Key difference from finish→finish: the inner task is aborted mid-work, so abort's navigation abandons the inner task branch. After abort, status shows "pending task: inner-task" but the inner task leaf is on a sibling branch path — it's only reachable from the outer task branch, not from main.

Key difference from discard→finish: the inner task IS started and worked on, so there's a `startTask()` + assistant work before the abort. The abort navigates back (discard does not). And no `task-done` is appended (discard does append `task-done`).

**Tech Stack:** TypeScript, Node 20+, `node:test`, SessionManager (in-memory)

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-28-manual-workflow-tests-roadmap.md`](../roadmaps/2026-05-28-manual-workflow-tests-roadmap.md)

**Phase:** Phase 4: Recursive tasks — abort→finish

---

## File Structure

**Only file modified:**
- `index.test.ts` — add 4 new `it` blocks under `describe('manual workflow')`, after the previous tests (before `describe('automated workflow')`)

**No files created, no files modified outside `index.test.ts`.**

---

### Task 1: Write recursive abort→finish — fresh outer, fresh inner

**Files:**
- Modify: `index.test.ts` — insert after the last manual workflow test, before `describe('automated workflow')`

**Branch history map:**
```
main branch:     user('main'), assistant('working...'), task('Outer task.')
  → startTask(outer, fresh): navigate to fresh context → user('Outer task.')
    → pushTask(inner, fresh): user('Outer task.'), task('Inner task.')
      → startTask(inner, fresh): navigate to fresh context → user('Inner task.')
        → assistant('partial inner')
      → abortTask: navigate back to outer branch (returnTo = task('Inner task.'))
        Branch: user('Outer task.'), task('Inner task.'), notification('Task aborted...')
        → status: 'pending task: inner-task', isLlmTriggered: false
      → appendAssistant('outer done')
    → finishTask(outer): navigate to returnTo (task('Outer task.') on main)
      Branch: user('main'), assistant('working...'), task('Outer task.'), taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert the following block before `describe('automated workflow', ...)`:

```typescript
  it('recursive abort→finish — fresh outer, fresh inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runAbortTask } =
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

    // ── Start outer task (fresh context) ──
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

    // ── Start inner task (fresh context) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Inner task.'),
    );

    // ── Partial work on inner task ──
    appendAssistantMessage('partial inner');

    // ── Abort inner task → navigate back to outer branch (inner still pending) ──
    await runAbortTask();
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.'),
      notification('Task aborted. Branch abandoned without summary.'),
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

Run: `node --test index.test.ts --test-name-pattern="abort→finish — fresh outer, fresh inner"`

Expected: `pass`

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive abort→finish fresh/fresh"
```

---

### Task 2: Write recursive abort→finish — fresh outer, inherited inner

**Files:**
- Modify: `index.test.ts` — insert after the fresh/fresh test from Task 1

**Flow:**
```
main: user('main'), assistant('working...'), task('Outer task.')
  → startTask(outer, fresh): user('Outer task.')
    → pushTask(inner, inherited): user('Outer task.'), task('Inner task.', true)
      → startTask(inner, inherited): no navigation → user('Outer task.'), task('Inner task.', true), user('Inner task.')
        → assistant('partial inner')
      → abortTask: navigate to returnTo (task('Inner task.', true))
        Branch: user('Outer task.'), task('Inner task.', true), notification('Task aborted...')
        → status: 'pending task: inner-task', isLlmTriggered: false
      → appendAssistant('outer done')
    → finishTask(outer): navigate to returnTo (task('Outer task.') on main)
      Branch: user('main'), assistant('working...'), task('Outer task.'), taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert after the fresh/fresh test:

```typescript
  it('recursive abort→finish — fresh outer, inherited inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runAbortTask } =
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

    // ── Push inner task (inherited context) from within outer task ──
    await runPushTask('Inner task.', true);
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start inner task (inherited — no navigation) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      user('Inner task.'),
    );

    appendAssistantMessage('partial inner');

    // ── Abort inner task → navigate back to returnTo ──
    await runAbortTask();
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task aborted. Branch abandoned without summary.'),
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

Run: `node --test index.test.ts --test-name-pattern="abort→finish — fresh outer, inherited inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive abort→finish fresh/inherited"
```

---

### Task 3: Write recursive abort→finish — inherited outer, fresh inner

**Files:**
- Modify: `index.test.ts` — insert after the fresh/inherited test from Task 2

**Flow:**
```
main: user('main'), assistant('working...'), task('Outer task.', true)
  → startTask(outer, inherited): user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.')
    → pushTask(inner, fresh): ... , user('Outer task.'), task('Inner task.')
      → startTask(inner, fresh): navigate to fresh context → user('Inner task.')
        → assistant('partial inner')
      → abortTask: navigate to returnTo (task('Inner task.') on inherited outer branch)
        Branch: user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.'), task('Inner task.'), notification('Task aborted...')
        → status: 'pending task: inner-task', isLlmTriggered: false
      → appendAssistant('outer done')
    → finishTask(outer): navigate to returnTo (task('Outer task.', true))
      Branch: user('main'), assistant('working...'), task('Outer task.', true), taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert after the fresh/inherited test:

```typescript
  it('recursive abort→finish — inherited outer, fresh inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runAbortTask } =
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

    // ── Start outer task (inherited) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
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

    // ── Start inner task (fresh — navigate to fresh) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Inner task.'),
    );

    appendAssistantMessage('partial inner');

    // ── Abort inner task → navigate back to returnTo ──
    await runAbortTask();
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.'),
      notification('Task aborted. Branch abandoned without summary.'),
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

Run: `node --test index.test.ts --test-name-pattern="abort→finish — inherited outer, fresh inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive abort→finish inherited/fresh"
```

---

### Task 4: Write recursive abort→finish — inherited outer, inherited inner

**Files:**
- Modify: `index.test.ts` — insert after the inherited/fresh test from Task 3

**Flow:**
```
main: user('main'), assistant('working...'), task('Outer task.', true)
  → startTask(outer, inherited): user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.')
    → pushTask(inner, inherited): ... , user('Outer task.'), task('Inner task.', true)
      → startTask(inner, inherited): no navigation → ... , user('Outer task.'), task('Inner task.', true), user('Inner task.')
        → assistant('partial inner')
      → abortTask: navigate to returnTo (task('Inner task.', true))
        Branch: user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.'), task('Inner task.', true), notification('Task aborted...')
        → status: 'pending task: inner-task', isLlmTriggered: false
      → appendAssistant('outer done')
    → finishTask(outer): navigate to returnTo (task('Outer task.', true))
      Branch: user('main'), assistant('working...'), task('Outer task.', true), taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert after the inherited/fresh test:

```typescript
  it('recursive abort→finish — inherited outer, inherited inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask, runAbortTask } =
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

    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.', true),
      user('Inner task.'),
    );

    appendAssistantMessage('partial inner');

    await runAbortTask();
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task aborted. Branch abandoned without summary.'),
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

Run: `node --test index.test.ts --test-name-pattern="abort→finish — inherited outer, inherited inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive abort→finish inherited/inherited"
```

---

### Task 5: Full verification gate

- [ ] **Step 1: Run the verification gate**

Run: `npm run verify`

This runs lint → tsc → test → updater → skill drift → pack. Expected: all pass.

- [ ] **Step 2: If any failures, fix them**

Likely assertion adjustments if a behavior detail differs from expectations. The abort→finish pattern is the most complex (nested start → partial work → abort navigation → outer finish), so pay close attention to branch history assertions if they fail.

- [ ] **Step 3: Final commit with meaningful message**

```bash
git add index.test.ts
git commit -m "test: Phase 4 — recursive abort→finish all 4 context combos"
```
