# Manual workflow tests — recursive & multi-task coverage

## Motivation

The manual workflow test suite currently has 4 tests covering basic push/start/finish/discard/abort flows. It lacks coverage for:

- **Aborting with inherited context** (only fresh-context abort is tested)
- **Recursive/nested tasks** — pushing a task from within an active task
- **Multiple stacked tasks** — pushing several tasks upfront then consuming them sequentially (LIFO: most recent first)

These are valid real-world patterns. The task lookup functions (`pendingTask`, `currentTask`) walk backward through branch entries and already handle nesting via skip counters, but this is untested.

## Additions

All additions go under the existing `describe('manual workflow')` block in `index.test.ts`. The harness (`makeHarness`) and assertion helpers are unchanged.

### 1. Abort with inherited context — 1 test

| # | Outer ctx | Flow |
|---|-----------|------|
| 1 | inherited | push-task(branch) → start-task → assistant("Partial") → abort-task → assert pending → start-task → assistant("Full") |

Same shape as the existing fresh-context abort test but uses `pushTask('Quick fix.', true)`. After abort, the task is still pending and can be restarted.

### 2. Recursive tasks — 12 tests

Three scenarios, each with all 4 combos of `inherit_context` for outer and inner push-task calls.

| # | Scenario | Outer ctx | Inner ctx |
|---|----------|-----------|-----------|
| 2a1 | finish → finish | fresh | fresh |
| 2a2 | finish → finish | fresh | inherited |
| 2a3 | finish → finish | inherited | fresh |
| 2a4 | finish → finish | inherited | inherited |
| 2b1 | discard → finish | fresh | fresh |
| 2b2 | discard → finish | fresh | inherited |
| 2b3 | discard → finish | inherited | fresh |
| 2b4 | discard → finish | inherited | inherited |
| 2c1 | abort → finish | fresh | fresh |
| 2c2 | abort → finish | fresh | inherited |
| 2c3 | abort → finish | inherited | fresh |
| 2c4 | abort → finish | inherited | inherited |

**Common prefix for each test:**

```
appendUserMessage('main')
appendAssistantMessage('working...')
pushTask('Outer task.', <outer_ctx>)     → pending task: outer-task
startTask()                              → current task: outer-task
// Now inside the outer task branch
pushTask('Inner task.', <inner_ctx>)     → pending task: inner-task
```

**Per-scenario suffix:**

- **finish → finish (2a*):** `startTask()` → assistant("inner done") → `finishTask()` → (task-result injected, outer still current) → assistant("outer done") → `finishTask()` → (task-result injected at root, status cleared)

- **discard → finish (2b*):** `discardTask()` → (status clear, back to outer being current) → assistant("outer done") → `finishTask()` → (task-result injected at root)

- **abort → finish (2c*):** `startTask()` → assistant("partial inner") → `abortTask()` → (inner task pending again, outer still current) → assistant("outer done") → `finishTask()` → (task-result injected at root)

### 3. Multiple stacked tasks — 4 tests

| # | Task 1 ctx | Task 2 ctx | Flow |
|---|-----------|-----------|------|
| 3a | fresh | fresh | push → push → start → finish → start → finish |
| 3b | fresh | inherited | push → push → start → finish → start → finish |
| 3c | inherited | fresh | push → push → start → finish → start → finish |
| 3d | inherited | inherited | push → push → start → finish → start → finish |

```
appendUserMessage('main')
appendAssistantMessage('working...')
pushTask('Task one.', <ctx1>)        → pending task: task-one
pushTask('Task two.', <ctx2>)        → pending task: task-two (most recent, LIFO)
startTask()                          → current task: task-two
assistant("two done")
finishTask()                         → task-result injected, pending task: task-one
startTask()                          → current task: task-one
assistant("one done")
finishTask()                         → task-result injected, status cleared
```

## Implementation notes

- All tests use the existing harness wrappers (`runPushTask`, `runStartTask`, `runFinishTask`, `runDiscardTask`, `runAbortTask`)
- `assertBranchHistory` already handles nested task-start/task-done entries (they're skipped in the HIDDEN_TYPES set)
- The harness's `getStatus()` reads from `taskStatus` which is set by `updateTaskStatus` — this correctly reflects the innermost pending/current task after each operation
- No changes to harness, helpers, or source code
