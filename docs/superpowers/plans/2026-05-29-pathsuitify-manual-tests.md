# PathSuite refactor of manual workflow tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `describe('manual workflow', ...)` block (~1320 lines, 21 `it()` blocks) in `index.test.ts` with a single `pathSuite('manual workflow', ...)` tree, eliminating repeated harness-setup boilerplate while preserving all assertions explicit and self-contained per node.

**Architecture:** Build the pathSuite tree bottom-up in 5 tasks. Each task adds a subtree of nodes with exact harness actions and assertions. Nodes reflect state-machine transitions: push-task creates a pending task, start-task activates it, finish/abort/discard resolve it. Two root branches — `push-task` (fresh) and `push-task [inherited]` — mirror each other with different branch-history expectations.

**Tech Stack:** Node.js 20+, `node:test`, `node:assert`, TypeScript (no type changes needed — the file already uses `.ts` with `tsx`)

**Roadmap:** None

**Phase:** Single-plan implementation

---

### Task 1: Delete old block, add root + fresh push-task with simple children

**Files:**
- Modify: `index.test.ts` — delete `describe('manual workflow', ...)` block, insert new `pathSuite` call

- [ ] **Step 1: Delete the old `describe('manual workflow', ...)` block**

Delete lines 69 through 1387 of `index.test.ts` (the entire `describe('manual workflow', () => { ... })` block).

- [ ] **Step 2: Add the root node and `push-task` (fresh) with `discard-task` leaf**

After the existing `pathSuite('pathSuite integration', ...)` block, insert the new `pathSuite('manual workflow', ...)` call with the first subtree:

```ts
pathSuite('manual workflow', (path) =>
  path('root', async (h) => {
    h.appendUserMessage('main work');
    h.appendAssistantMessage('working...');
  },
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
      }),
    ),
  ),
);
```

- [ ] **Step 3: Add `start-task` and `finish-task` under fresh `push-task`**

Insert `start-task` and `finish-task` as additional children of `push-task`:

```ts
      path('start-task', async (h) => {
        await h.runStartTask();
        assert.strictEqual(h.getStatus(), 'current task: some-task');
        assert.ok(h.isLlmTriggered());
        h.assertBranchHistory(
          user('Some task.'),
        );
      },
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
        }),
      ),
```

Make sure the tree structure nests correctly:
```
path('root', ..., 
  path('push-task', ..., 
    path('discard-task', ...),
    path('start-task', ...,
      path('finish-task', ...),
    ),
  ),
)
```

- [ ] **Step 4: Run tests to verify the first subtree passes**

Run: `npx tsx --test index.test.ts`
Expected: The 3 new `pathSuite`-generated tests pass (root → push-task → discard-task, root → push-task → start-task, root → push-task → start-task → finish-task). No other test changes.

- [ ] **Step 5: Lint**

```bash
npm run fix
```

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "test: add root + push-task (fresh) subtree with discard, start, finish"
```

---

### Task 2: Add abort subtree under fresh start-task

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Add `abort-task` → restart `start-task` → `finish-task` under fresh `start-task`**

Insert as an additional child of `start-task` (sibling to the existing `finish-task`):

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
          path('start-task', async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), 'current task: some-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('Some task.'),
            );
          },
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
            }),
          ),
        ),
```

The tree under `push-task` should now be:

```ts
path('push-task', ...,
  path('discard-task', ...),
  path('start-task', ...,
    path('finish-task', ...),
    path('abort-task', ...,
      path('start-task', ...,
        path('finish-task', ...),
      ),
    ),
  ),
),
```

- [ ] **Step 2: Run tests**

Run: `npx tsx --test index.test.ts`
Expected: All 5 tests pass (3 from Task 1 + 2 new: root → push-task → start-task → abort-task, root → push-task → start-task → abort-task → start-task → finish-task).

- [ ] **Step 3: Lint**

```bash
npm run fix
```

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add abort + restart subtree under fresh push-task"
```

---

### Task 3: Add inner push-task (fresh) subtree under fresh start-task

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Add inner `push-task` node under fresh `start-task`**

Insert as an additional child of `start-task` (sibling to `finish-task` and `abort-task`):

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

- [ ] **Step 2: Add `discard-task` → `finish-task` (outer) under inner push**

```ts
          path('discard-task', async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), 'current task: some-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('Some task.'),
              task('Another task.'),
              notification('Task discarded.'),
            );
          },
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
            }),
          ),
```

- [ ] **Step 3: Add inner `start-task` → `finish-task` (inner) → `finish-task` (outer)**

```ts
          path('start-task', async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), 'current task: another-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('Another task.'),
            );
          },
            path('finish-task', async (h) => {
              h.appendAssistantMessage('inner done');
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), 'current task: some-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('Some task.'),
                task('Another task.'),
                taskResult('another-task', 'inner done'),
                notification('Task finished. Last response attached.'),
              );
            },
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
              }),
            ),
```

- [ ] **Step 4: Add inner `abort-task` → `finish-task` (outer)**

```ts
            path('abort-task', async (h) => {
              h.appendAssistantMessage('partial inner');
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), 'pending task: another-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('Some task.'),
                task('Another task.'),
                notification('Task aborted. Branch abandoned without summary.'),
              );
            },
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
              }),
            ),
          ),
        ),
```

Full inner push-tree under `start-task`:

```ts
        path('push-task', async (h) => { ... },
          path('discard-task', async (h) => { ... },
            path('finish-task', async (h) => { ... }),
          ),
          path('start-task', async (h) => { ... },
            path('finish-task', async (h) => { ... },
              path('finish-task', async (h) => { ... }),
            ),
            path('abort-task', async (h) => { ... },
              path('finish-task', async (h) => { ... }),
            ),
          ),
        ),
```

- [ ] **Step 5: Run tests**

Run: `npx tsx --test index.test.ts`
Expected: 8 new tests pass (recursive finish fresh→fresh, recursive discard fresh→fresh, recursive abort fresh→fresh, plus the inner push/discard path). Total: 13 tests in `manual workflow`.

- [ ] **Step 6: Lint**

```bash
npm run fix
```

- [ ] **Step 7: Commit**

```bash
git add index.test.ts
git commit -m "test: add inner push-task (fresh) subtree under fresh start-task"
```

---

### Task 4: Add inner push-task [inherited] subtree under fresh start-task

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Add inner `push-task [inherited]` → `discard-task` → `finish-task` (outer)**

Insert as an additional child of `start-task` (sibling to the inner `push-task` fresh node). This mirrors Task 3 but with `inherit_context=true` and adjusted branch-history assertions:

```ts
        path('push-task [inherited]', async (h) => {
          await h.runPushTask('Another task.', true);
          assert.strictEqual(h.getStatus(), 'pending task: another-task');
          h.assertBranchHistory(
            user('Some task.'),
            task('Another task.', true),
            notification('Task stored. Use `/start-task` or `/auto` to start it.'),
          );
        },
          path('discard-task', async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), 'current task: some-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('Some task.'),
              task('Another task.', true),
              notification('Task discarded.'),
            );
          },
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
            }),
          ),
```

- [ ] **Step 2: Add inner inherited `start-task` → `finish-task` (inner) → `finish-task` (outer)**

```ts
          path('start-task', async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), 'current task: another-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('Some task.'),
              task('Another task.', true),
              user('Another task.'),
            );
          },
            path('finish-task', async (h) => {
              h.appendAssistantMessage('inner done');
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), 'current task: some-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('Some task.'),
                task('Another task.', true),
                taskResult('another-task', 'inner done'),
                notification('Task finished. Last response attached.'),
              );
            },
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
              }),
            ),
```

- [ ] **Step 3: Add inner inherited `abort-task` → `finish-task` (outer)**

```ts
            path('abort-task', async (h) => {
              h.appendAssistantMessage('partial inner');
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), 'pending task: another-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('Some task.'),
                task('Another task.', true),
                notification('Task aborted. Branch abandoned without summary.'),
              );
            },
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
              }),
            ),
          ),
        ),
```

The tree under `start-task` (fresh) should now have four children:
```
start-task
├── finish-task
├── abort-task
│   └── start-task → finish-task
├── push-task (inner fresh)
│   ├── discard-task → finish-task
│   └── start-task
│       ├── finish-task → finish-task
│       └── abort-task → finish-task
└── push-task [inherited] (inner inherited)
    ├── discard-task → finish-task
    └── start-task
        ├── finish-task → finish-task
        └── abort-task → finish-task
```

- [ ] **Step 4: Run tests**

Run: `npx tsx --test index.test.ts`
Expected: 6 new tests pass (3 combos of inherited inner under fresh outer). Total: 19 tests in `manual workflow`.

- [ ] **Step 5: Lint**

```bash
npm run fix
```

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "test: add inner push-task [inherited] subtree under fresh start-task"
```

---

### Task 5: Add push-task [inherited] root with mirrored subtree

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Add `push-task [inherited]` root sibling**

Insert as a sibling of `push-task` (fresh) under `root`. Start with `discard-task` and `start-task` → `finish-task`:

```ts
    path('push-task [inherited]', async (h) => {
      await h.runPushTask('Some task.', true);
      assert.strictEqual(h.getStatus(), 'pending task: some-task');
      assert.ok(!h.isLlmTriggered());
      h.assertBranchHistory(
        user('main work'),
        assistant('working...'),
        task('Some task.', true),
        notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      );
    },
      path('discard-task', async (h) => {
        await h.runDiscardTask();
        assert.strictEqual(h.getStatus(), undefined);
        assert.ok(!h.isLlmTriggered());
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Some task.', true),
          notification('Task discarded.'),
        );
      }),
      path('start-task', async (h) => {
        await h.runStartTask();
        assert.strictEqual(h.getStatus(), 'current task: some-task');
        assert.ok(h.isLlmTriggered());
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Some task.', true),
          user('Some task.'),
        );
      },
        path('finish-task', async (h) => {
          h.appendAssistantMessage('Done.');
          await h.runFinishTask();
          assert.strictEqual(h.getStatus(), undefined);
          assert.ok(h.isLlmTriggered());
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Some task.', true),
            taskResult('some-task', 'Done.'),
            notification('Task finished. Last response attached.'),
          );
        }),
```

- [ ] **Step 2: Add abort subtree under inherited start-task**

```ts
        path('abort-task', async (h) => {
          h.appendAssistantMessage('Partial...');
          await h.runAbortTask();
          assert.strictEqual(h.getStatus(), 'pending task: some-task');
          assert.ok(!h.isLlmTriggered());
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Some task.', true),
            notification('Task aborted. Branch abandoned without summary.'),
          );
        },
          path('start-task', async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), 'current task: some-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Some task.', true),
              user('Some task.'),
            );
          },
            path('finish-task', async (h) => {
              h.appendAssistantMessage('Done.');
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Some task.', true),
                taskResult('some-task', 'Done.'),
                notification('Task finished. Last response attached.'),
              );
            }),
          ),
        ),
```

- [ ] **Step 3: Add inner push-task (fresh) under inherited start-task**

Mirrors Task 3 but with inherited outer context. The inner push (fresh) nodes under inherited outer use different branch-history assertions because the outer's branch preserves the main conversation chain:

```ts
        path('push-task', async (h) => {
          await h.runPushTask('Another task.');
          assert.strictEqual(h.getStatus(), 'pending task: another-task');
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Some task.', true),
            user('Some task.'),
            task('Another task.'),
            notification('Task stored. Use `/start-task` or `/auto` to start it.'),
          );
        },
          path('discard-task', async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), 'current task: some-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Some task.', true),
              user('Some task.'),
              task('Another task.'),
              notification('Task discarded.'),
            );
          },
            path('finish-task', async (h) => {
              h.appendAssistantMessage('Done.');
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Some task.', true),
                taskResult('some-task', 'Done.'),
                notification('Task finished. Last response attached.'),
              );
            }),
          ),
          path('start-task', async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), 'current task: another-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('Another task.'),
            );
          },
            path('finish-task', async (h) => {
              h.appendAssistantMessage('inner done');
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), 'current task: some-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Some task.', true),
                user('Some task.'),
                task('Another task.'),
                taskResult('another-task', 'inner done'),
                notification('Task finished. Last response attached.'),
              );
            },
              path('finish-task', async (h) => {
                h.appendAssistantMessage('Done.');
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user('main work'),
                  assistant('working...'),
                  task('Some task.', true),
                  taskResult('some-task', 'Done.'),
                  notification('Task finished. Last response attached.'),
                );
              }),
            ),
            path('abort-task', async (h) => {
              h.appendAssistantMessage('partial inner');
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), 'pending task: another-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Some task.', true),
                user('Some task.'),
                task('Another task.'),
                notification('Task aborted. Branch abandoned without summary.'),
              );
            },
              path('finish-task', async (h) => {
                h.appendAssistantMessage('Done.');
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user('main work'),
                  assistant('working...'),
                  task('Some task.', true),
                  taskResult('some-task', 'Done.'),
                  notification('Task finished. Last response attached.'),
                );
              }),
            ),
          ),
        ),
```

- [ ] **Step 4: Add inner push-task [inherited] under inherited start-task**

Mirrors Task 4 but under the inherited outer. Both outer and inner use inherited context:

```ts
        path('push-task [inherited]', async (h) => {
          await h.runPushTask('Another task.', true);
          assert.strictEqual(h.getStatus(), 'pending task: another-task');
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Some task.', true),
            user('Some task.'),
            task('Another task.', true),
            notification('Task stored. Use `/start-task` or `/auto` to start it.'),
          );
        },
          path('discard-task', async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), 'current task: some-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Some task.', true),
              user('Some task.'),
              task('Another task.', true),
              notification('Task discarded.'),
            );
          },
            path('finish-task', async (h) => {
              h.appendAssistantMessage('Done.');
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Some task.', true),
                taskResult('some-task', 'Done.'),
                notification('Task finished. Last response attached.'),
              );
            }),
          ),
          path('start-task', async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), 'current task: another-task');
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Some task.', true),
              user('Some task.'),
              task('Another task.', true),
              user('Another task.'),
            );
          },
            path('finish-task', async (h) => {
              h.appendAssistantMessage('inner done');
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), 'current task: some-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Some task.', true),
                user('Some task.'),
                task('Another task.', true),
                taskResult('another-task', 'inner done'),
                notification('Task finished. Last response attached.'),
              );
            },
              path('finish-task', async (h) => {
                h.appendAssistantMessage('Done.');
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user('main work'),
                  assistant('working...'),
                  task('Some task.', true),
                  taskResult('some-task', 'Done.'),
                  notification('Task finished. Last response attached.'),
                );
              }),
            ),
            path('abort-task', async (h) => {
              h.appendAssistantMessage('partial inner');
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), 'pending task: another-task');
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Some task.', true),
                user('Some task.'),
                task('Another task.', true),
                notification('Task aborted. Branch abandoned without summary.'),
              );
            },
              path('finish-task', async (h) => {
                h.appendAssistantMessage('Done.');
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user('main work'),
                  assistant('working...'),
                  task('Some task.', true),
                  taskResult('some-task', 'Done.'),
                  notification('Task finished. Last response attached.'),
                );
              }),
            ),
          ),
        ),
      ),
    ),
  ),
);
```

- [ ] **Step 5: Run full test suite**

Run: `npx tsx --test index.test.ts`
Expected: All new tests pass. The `automated workflow`, `registration`, and `pathSuite` tests remain unchanged.

- [ ] **Step 6: Lint**

```bash
npm run fix
```

- [ ] **Step 7: Run the full verify gate**

```bash
npm run verify
```

Expected: All checks pass (lint → tsc → test → updater → skill drift → pack).

- [ ] **Step 8: Commit**

```bash
git add index.test.ts
git commit -m "test: add push-task [inherited] root with full mirrored subtree"
```

---

## Summary of test coverage

The `pathSuite` tree covers 17 of the 21 original scenarios plus extended edge cases (e.g., finish after abort→restart).

| Original tests | PathSuite path |
|---|---|
| Simple fresh finish (test 1) | root → push-task → start-task → finish-task |
| Simple inherited finish (test 2) | root → push-task [inherited] → start-task → finish-task |
| Discard (test 3) | root → push-task → discard-task |
| Abort fresh + restart (test 4) | root → push-task → start-task → abort-task → start-task → finish-task |
| Abort inherited + restart (test 5) | root → push-task [inherited] → start-task → abort-task → start-task → finish-task |
| Recursive finish 4 combos (tests 10-13) | 4 inner-push path combos under fresh/inherited roots |
| Recursive discard 4 combos (tests 14-17) | 4 discard→finish paths |
| Recursive abort 4 combos (tests 18-21) | 4 abort→finish paths |

**Stacked pending tasks (tests 6-9) removed:** The 4 tests that push two tasks before starting either (`push A → push B → start B → finish B → start A → finish A`) are intentionally omitted per user approval during brainstorming. Those tests exercise the pending-on-pending LIFO state, which is distinct from the pending-from-active state covered by the recursive paths. The plan follows the approved tree structure; if coverage for the stacked-pending state is needed, a follow-up task can add `push-task` siblings directly under root `push-task` nodes before `start-task`.
