# Design: Refactor manual workflow tests to use `pathSuite`

## Summary

Replace the `describe('manual workflow', ...)` block (~1320 lines, 21 hand-written `it()` blocks) in `index.test.ts` with a single `pathSuite('manual workflow', ...)` call that uses the same composable tree structure already defined in the file.

## Tree structure

```
root (harness setup only, no assertions)
├── push-task
│   ├── discard-task
│   └── start-task
│       ├── finish-task
│       ├── abort-task
│       │   └── start-task                        (restart after abort)
│       │       └── finish-task
│       ├── push-task                             (inner, from active outer)
│       │   ├── discard-task
│       │   │   └── finish-task                   (outer)
│       │   └── start-task
│       │       ├── finish-task                   (inner)
│       │       │   └── finish-task               (outer)
│       │       └── abort-task
│       │           └── finish-task               (outer)
│       └── push-task [inherited]
│           └── (same 2 children as above)
└── push-task [inherited]
    └── (mirror of subtree under push-task)
```

- Nodes named `push-task` mean fresh context (default).
- Nodes named `push-task [inherited]` use `inherit_context=true`.
- Dual-finish paths cover the 4 context combos: through which root + which inner push node is taken.
- Discard and abort recursive paths cover all 4 combos as well.

## Node anatomy

Each node is ~8-15 lines: a few harness actions followed by explicit `assert.strictEqual`, `assert.ok`, and `assertBranchHistory` calls. No shared helpers for assertions — every node contains its own explicit expectations.

### Root node

Setup only. No assertions.

```ts
path('root', async (h) => {
  h.appendUserMessage('main work');
  h.appendAssistantMessage('working...');
},
  path('push-task', ...),
  path('push-task [inherited]', ...),
)
```

### push-task

Push a task, assert pending state and branch history.

```ts
path('push-task', async (h) => {
  await h.runPushTask('Some task.');
  assert.strictEqual(h.getStatus(), 'pending task: some-task');
  assert.ok(!h.isLlmTriggered());
  h.assertBranchHistory(
    user('main work'),
    assistant('working...'),
    task('Some task.'),
    notification('Task stored. Use `/start-task` or `/auto` to start it.'),
  );
},
```

The `[inherited]` variant passes `true` as second argument to `runPushTask` and asserts the same initial chain plus `task('Some task.', true)`.

### discard-task

Discard the pending task, assert cleared.

```ts
path('discard-task', async (h) => {
  await h.runDiscardTask();
  assert.strictEqual(h.getStatus(), undefined);
  assert.ok(!h.isLlmTriggered());
  h.assertBranchHistory(
    user('main work'),
    assistant('working...'),
    task('Some task.'),
    notification('Task discarded.'),
  );
},
```

### start-task

Start the pending task, assert active state and branch.

```ts
path('start-task', async (h) => {
  await h.runStartTask();
  assert.strictEqual(h.getStatus(), 'current task: some-task');
  assert.ok(h.isLlmTriggered());
  h.assertBranchHistory(
    user('Some task.'),
  );
},
```

Under `push-task [inherited]`, the asserted branch history includes the preserved parent chain instead of starting with a clean `user('Some task.')`.

### finish-task

Work on the current task, finish it, assert result injected.

When it's the only task (outer leaf, under `start-task` directly):

```ts
path('finish-task', async (h) => {
  h.appendAssistantMessage('Done.');
  await h.runFinishTask();
  assert.strictEqual(h.getStatus(), undefined);
  assert.ok(h.isLlmTriggered());
  h.assertBranchHistory(
    user('main work'),
    assistant('working...'),
    task('Some task.'),
    taskResult('some-task', 'Done.'),
    notification('Task finished. Last response attached.'),
  );
},
```

When it's the inner finish (under `start-task → push-task → start-task`), it asserts the outer task is still active and the inner result is injected at the outer branch. The following outer `finish-task` leaf then asserts final return to the main conversation.

### abort-task

Partial work, abort, assert task re-pends.

```ts
path('abort-task', async (h) => {
  h.appendAssistantMessage('Partial...');
  await h.runAbortTask();
  assert.strictEqual(h.getStatus(), 'pending task: some-task');
  assert.ok(!h.isLlmTriggered());
  h.assertBranchHistory(
    user('main work'),
    assistant('working...'),
    task('Some task.'),
    notification('Task aborted. Branch abandoned without summary.'),
  );
},
```

The restart `start-task → finish-task` child pair verifies the re-pended task can be started and completed.

### push-task (inner, from active outer)

When a task is already active, pushing another stacks it on LIFO.

```ts
path('push-task', async (h) => {
  await h.runPushTask('Another task.');
  assert.strictEqual(h.getStatus(), 'pending task: another-task');
  h.assertBranchHistory(
    user('Some task.'),
    task('Another task.'),
    notification('Task stored. Use `/start-task` or `/auto` to start it.'),
  );
},
```

Discard, start, finish, and abort children below it operate on the inner task, then a `finish-task` node completes the outer.

## What stays unchanged

| Section | Reason |
|---|---|
| `automated workflow` describe block | Uses async mechanics (`releaseNextIdle`, `flushMicrotasks`) incompatible with pathSuite's sequential ancestor-fn model |
| `registration` describe block | Single `it()` for command registration — no duplication to eliminate |
| `pathSuite` describe block + integration test | Tests of the utility itself |
| `makeHarness()` and helpers | Unchanged — shared by all test blocks |

## What gets deleted

The entire `describe('manual workflow', ...)` block — all 21 `it()` blocks replaced by the pathSuite call.

## Test coverage

The new pathSuite covers every scenario the existing `it()` blocks cover:

- Single task: push fresh → start → finish (fresh + inherited)
- Single task: push → discard
- Single task: push → start → abort → restart → finish (fresh + inherited)
- Stacked tasks: push two → LIFO start + finish (all 4 context combos)
- Recursive finish: outer push → start → inner push → start → finish inner → finish outer (4 combos)
- Recursive discard: same but discard inner (4 combos)
- Recursive abort: same but abort inner (4 combos)

## Files changed

`index.test.ts` — replace the `describe('manual workflow', ...)` block with the `pathSuite('manual workflow', ...)` call. No other files.
