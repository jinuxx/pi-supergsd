# /auto Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `/auto` extension command that starts and finishes pushed tasks automatically while reusing the existing Pi task navigation flow.

**Architecture:** Keep the extension in `index.ts`, but split the current command bodies into shared helper functions that both manual commands and `/auto` can call. Move task lookup logic to branch-scoped helpers based on `sessionManager.getBranch()` so `/auto` only reacts to entries on the active branch and treats `task-start` as a barrier. Extend the existing in-memory test harness in `index.test.ts` so it can drive `waitForIdle()`, simulate session shutdown, and prove the loop exits only at the right times.

**Tech Stack:** TypeScript, Node 20, `tsx --test`, Pi Extension API (`ExtensionAPI`, `ExtensionCommandContext`, session events)

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File Structure

- **Modify `index.ts`** — register `/auto`, change `push-task` termination behavior, rename and fix lookup helpers, export shared task helpers, add `lastAssistantWasAborted()`, and keep module-level `/auto` loop state plus shutdown cleanup.
- **Modify `index.test.ts`** — add unit and integration coverage for `push-task`, branch-scoped lookups, helper reuse, `/auto` loop behavior, and expand the harness with idle waiters, pending-message toggles, and session event emission.
- **No new source files** — the extension is still small enough to keep in one source file plus one test file.

## Task 1: Lock down branch-scoped lookup semantics and `push-task` termination

**Files:**
- Modify: `index.test.ts:15-48`
- Modify: `index.test.ts:450-622`
- Modify: `index.ts:21-44`
- Modify: `index.ts:195-242`

- [ ] **Step 1: Write the failing tests for `push-task`, `pendingTask()`, and `currentTask()`**

```ts
import {
  TASK_START_ENTRY_TYPE,
  TASK_DONE_ENTRY_TYPE,
  TASK_ENTRY_TYPE,
  currentTask,
  pendingTask,
  type TaskStartData,
  type TaskData,
} from './index.js';

describe('createPushTaskTool', () => {
  it('returns terminate=true with the /auto-aware instruction text', async () => {
    const { pi, ctx, sm } = makeHarness();
    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    const tool = createPushTaskTool(pi);
    const result = await tool.execute('call-1', { prompt: 'Review the spec.' }, undefined, undefined, ctx);

    assert.strictEqual(result.terminate, true);
    assert.deepStrictEqual(result.content, [
      { type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' },
    ]);
  });
});

describe('pendingTask', () => {
  it('returns null once a task-start exists on the current branch', () => {
    const { sm } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'root', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Branch task', context: 'branch' });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });
    sm.appendMessage({ role: 'user', content: 'task work', timestamp: 0 });

    assert.strictEqual(pendingTask(sm), null);
  });

  it('ignores task entries on sibling forks', () => {
    const { sm } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'root', timestamp: 0 });
    const rootId = sm.getLeafId()!;

    sm.branch(rootId);
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Sibling task', context: 'branch' });

    sm.branch(rootId);
    sm.appendMessage(assistantMessage('active branch'));

    assert.strictEqual(pendingTask(sm), null);
    assert.strictEqual(currentTask(sm), null);
  });
});

describe('currentTask', () => {
  it('returns the task-start on the active branch', () => {
    const { sm } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'root', timestamp: 0 });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });

    const taskStart = currentTask(sm);
    assert.ok(taskStart);
    assert.strictEqual(taskStart.data.returnTo, returnTo);
  });
});
```

- [ ] **Step 2: Run the focused tests to confirm they fail first**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "createPushTaskTool|pendingTask|currentTask"
```

Expected: FAIL because `pendingTask` and `currentTask` are not exported yet, and `createPushTaskTool()` still returns the old text without `terminate: true`.

- [ ] **Step 3: Implement the minimal source changes for renamed branch-scoped lookups and `push-task` termination**

```ts
export function createPushTaskTool(pi: ExtensionAPI): ToolDefinition {
  return defineTool({
    name: 'push-task',
    label: 'Push Task',
    description: 'Store a task prompt for a user-started navigation branch.',
    promptSnippet: 'Store a focused task prompt for a user-started navigation branch.',
    promptGuidelines: [
      'Use push-task when a skill needs the user to start a focused branch workflow with /start-task or /auto.',
      'Use push-task by itself when the intent is to hand control to /auto, because terminate:true only takes effect when every tool in the batch also terminates.',
    ],
    parameters: pushTaskParameters,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('Task storage aborted.');
      }

      pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, context: params.context ?? 'fresh' });

      return {
        content: [{ type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' }],
        details: {},
        terminate: true,
      };
    },
  });
}

export function pendingTask(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskData }) | null {
  const branch = session.getBranch();
  let skip = 0;

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === 'custom' && entry.customType === TASK_START_ENTRY_TYPE) {
      return null;
    }
    if (entry.type === 'custom' && entry.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
      continue;
    }
    if (entry.type === 'custom' && entry.customType === TASK_ENTRY_TYPE) {
      if (skip === 0) return entry as SessionEntry & { data: TaskData };
      skip--;
    }
  }

  return null;
}

export function currentTask(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskStartData }) | null {
  const branch = session.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === 'custom' && entry.customType === TASK_START_ENTRY_TYPE) {
      return entry as SessionEntry & { data: TaskStartData };
    }
  }

  return null;
}
```

- [ ] **Step 4: Replace the old helper call sites with the new names**

```diff
-      const activeTask = findActiveTask(ctx.sessionManager);
+      const activeTask = pendingTask(ctx.sessionManager);

-      const taskStart = findTaskStart(ctx.sessionManager);
+      const taskStart = currentTask(ctx.sessionManager);

-      const activeTask = findActiveTask(ctx.sessionManager);
+      const activeTask = pendingTask(ctx.sessionManager);

-      if (findActiveTask(ctx.sessionManager)) {
+      if (pendingTask(ctx.sessionManager)) {
         pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
       }
```

- [ ] **Step 5: Re-run the focused tests until they pass**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "createPushTaskTool|pendingTask|currentTask"
```

Expected: PASS for the new `push-task` return contract and the branch-scoped lookup behavior.

- [ ] **Step 6: Commit the finished slice**

```bash
git add index.ts index.test.ts
git commit -m "test: lock task lookup semantics"
```

## Task 2: Extract shared task helpers and keep manual commands as thin wrappers

**Files:**
- Modify: `index.ts:46-186`
- Modify: `index.test.ts:50-369`
- Modify: `index.test.ts:477-622`

- [ ] **Step 1: Write the failing tests for exported helpers and duplicate-start protection**

```ts
import {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
  startTask,
  finishTask,
} from './index.js';

describe('startTask', () => {
  it('returns cancelled when fresh navigation is cancelled', async () => {
    const { pi, ctx, sm, setCancelNextNav, sentMessages } = makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Review spec.' });

    const result = await startTask(pi, ctx);

    assert.strictEqual(result, 'cancelled');
    assert.deepStrictEqual(sentMessages, []);
    assertNoTaskStart(ctx.sessionManager);
  });

  it('returns without duplicating task-start when a task is already in progress', async () => {
    const { pi, ctx, sm, sentMessages } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Review spec.', context: 'branch' });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });

    const result = await startTask(pi, ctx);

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(sentMessages, []);
    assert.strictEqual(countCustomEntries(sm, TASK_START_ENTRY_TYPE), 1);
  });
});

describe('finishTask', () => {
  it('returns cancelled when navigation back to the return point is cancelled', async () => {
    const { pi, ctx, sm, setCancelNextNav, sentCustomMessages } = makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    const rootId = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    sm.branch(sm.getLeafId()!);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: rootId });

    const result = await finishTask(pi, ctx);

    assert.strictEqual(result, 'cancelled');
    assert.strictEqual(sentCustomMessages.length, 0);
  });
});
```

- [ ] **Step 2: Run the helper-focused tests and confirm they fail**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "startTask|finishTask"
```

Expected: FAIL because the shared helpers are not exported yet and the current `start-task` logic still creates a new `task-start` even when one already exists.

- [ ] **Step 3: Introduce the shared helper functions with the exact return contract from the spec**

```ts
export type TaskActionResult = 'cancelled' | void;

export async function startTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  if (currentTask(ctx.sessionManager)) return;

  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify('No pending task. Use push-task first.', 'warning');
    return;
  }

  const taskContext = activeTask.data.context ?? 'fresh';

  if (taskContext === 'fresh') {
    const departureLeafId = ctx.sessionManager.getLeafId()!;
    const freshTargetId = findFreshTargetId(ctx.sessionManager);
    if (!freshTargetId) {
      ctx.ui.notify('No starting point found on current branch.', 'warning');
      return;
    }

    const result = await ctx.navigateTree(freshTargetId, { summarize: false });
    if (result.cancelled) return 'cancelled';

    pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
  } else {
    pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: ctx.sessionManager.getLeafId()! });
  }

  pi.sendUserMessage(activeTask.data.prompt);
}

export async function discardTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify('No pending task.', 'warning');
    return;
  }

  pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  ctx.ui.notify('Task discarded.', 'info');
}

export async function finishTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify('No task start point.', 'warning');
    return;
  }

  let lastAssistantContent: unknown;
  let lastAssistantId: string | undefined;
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!isAssistantMessageEntry(entry)) continue;

    const rawContent = entry.message.content;
    lastAssistantContent = Array.isArray(rawContent)
      ? rawContent.filter(
          (block): block is { type: 'text'; text: string } =>
            typeof block === 'object' && block !== null && 'type' in block && block.type === 'text',
        )
      : rawContent;
    lastAssistantId = entry.id;
    break;
  }

  const result = await ctx.navigateTree(taskStart.data.returnTo, { summarize: false });
  if (result.cancelled) return 'cancelled';

  if (lastAssistantId) {
    pi.sendMessage(
      {
        customType: 'branch-result',
        content: lastAssistantContent as string,
        display: true,
        details: { sourceEntryId: lastAssistantId },
      },
      { triggerTurn: true },
    );
  }

  if (pendingTask(ctx.sessionManager)) {
    pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  }

  const label = lastAssistantId ? 'Last response attached.' : 'No last response to attach.';
  ctx.ui.notify(`Task finished. ${label}`, 'info');
}

export async function abortTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify('No task start point.', 'warning');
    return;
  }

  const result = await ctx.navigateTree(taskStart.data.returnTo, { summarize: false });
  if (result.cancelled) return 'cancelled';

  if (pendingTask(ctx.sessionManager)) {
    pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  }

  ctx.ui.notify('Task aborted. Branch abandoned without summary.', 'info');
}
```

- [ ] **Step 4: Convert each command factory into a thin wrapper that waits for idle, then calls the shared helper**

```ts
export function createStartTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Navigate to a fresh context and inject the active task prompt',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await startTask(pi, ctx);
    },
  };
}

export function createDiscardTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Discard the active task without executing it',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await discardTask(pi, ctx);
    },
  };
}

export function createFinishTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Finish the current task and return to the task start point',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await finishTask(pi, ctx);
    },
  };
}

export function createAbortTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Abort the current task without finishing',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await abortTask(pi, ctx);
    },
  };
}
```

- [ ] **Step 5: Add the small harness helper needed by the new tests**

```ts
function countCustomEntries(sm: SessionManager, customType: string): number {
  return sm
    .getEntries()
    .filter((entry) => entry.type === 'custom' && entry.customType === customType)
    .length;
}
```

- [ ] **Step 6: Re-run the helper and legacy command tests**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "startTask|finishTask|createStartTaskCommand|createFinishTaskCommand|createAbortTaskCommand|createDiscardTaskCommand"
```

Expected: PASS for both the direct helper tests and the older command-wrapper tests.

- [ ] **Step 7: Commit the refactor before adding `/auto`**

```bash
git add index.ts index.test.ts
git commit -m "refactor: extract task command helpers"
```

## Task 3: Add the `/auto` command loop, abort detection, and shutdown reset

**Files:**
- Modify: `index.ts:13-19`
- Modify: `index.ts:188-319`
- Modify: `index.test.ts:7-13`
- Modify: `index.test.ts:371-392`
- Modify: `index.test.ts:477-622`

- [ ] **Step 1: Write the failing `/auto` unit tests before touching the source**

```ts
import registerTaskCommands, {
  createAutoCommand,
  lastAssistantWasAborted,
} from './index.js';

describe('lastAssistantWasAborted', () => {
  it('detects an aborted assistant message only when it is the last branch entry', () => {
    const { sm } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendMessage(abortedAssistantMessage('Stopped by user.'));

    assert.strictEqual(lastAssistantWasAborted(sm), true);
  });
});

describe('createAutoCommand', () => {
  it('waits when started with no task, then starts work after a later push-task', async () => {
    const { pi, ctx, sm, sentMessages, releaseNextIdle, flushMicrotasks } = makeHarness();

    const auto = createAutoCommand(pi);
    const running = auto.handler('', ctx);

    await flushMicrotasks();
    await releaseNextIdle();

    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Review spec.' });
    await releaseNextIdle();

    assert.deepStrictEqual(sentMessages, ['Review spec.']);

    sm.appendMessage(assistantMessage('Done.'));
    await releaseNextIdle();
    await releaseNextIdle();
    await running;
  });

  it('warns and returns when /auto is already running', async () => {
    const { pi, ctx, notifications, releaseNextIdle, flushMicrotasks, emitSessionShutdown } = makeHarness();
    registerTaskCommands(pi);

    const auto = createAutoCommand(pi);
    const firstRun = auto.handler('', ctx);
    await flushMicrotasks();

    await auto.handler('', ctx);
    assertLastNotification(notifications, 'warning', 'Auto is already running.');

    await emitSessionShutdown();
    await releaseNextIdle();
    await firstRun;
  });

  it('stops instead of finishing the task when the last assistant message was aborted', async () => {
    const { pi, ctx, sm, sentCustomMessages, releaseNextIdle, flushMicrotasks } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.', context: 'branch' });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });
    sm.appendMessage(abortedAssistantMessage('Stopped by user.'));

    const auto = createAutoCommand(pi);
    const running = auto.handler('', ctx);

    await flushMicrotasks();
    await releaseNextIdle();
    await running;

    assert.strictEqual(sentCustomMessages.length, 0);
    assert.strictEqual(countCustomEntries(sm, TASK_DONE_ENTRY_TYPE), 0);
  });

  it('keeps waiting while follow-up work is pending after finishTask', async () => {
    const { pi, ctx, sm, setPendingMessages, sentCustomMessages, releaseNextIdle, flushMicrotasks } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Quick fix.', context: 'branch' });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });
    sm.appendMessage(assistantMessage('Fixed the bug.'));

    const auto = createAutoCommand(pi);
    let resolved = false;
    const running = auto.handler('', ctx).then(() => {
      resolved = true;
    });

    await flushMicrotasks();
    setPendingMessages(true);
    await releaseNextIdle();
    await releaseNextIdle();

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(resolved, false);

    setPendingMessages(false);
    await releaseNextIdle();
    await running;
    assert.strictEqual(resolved, true);
  });
});
```

- [ ] **Step 2: Run the `/auto` tests to confirm they fail**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "createAutoCommand|lastAssistantWasAborted"
```

Expected: FAIL because `/auto` is not registered yet, `createAutoCommand()` and `lastAssistantWasAborted()` do not exist, and the harness cannot drive `waitForIdle()`.

- [ ] **Step 3: Register `/auto`, add module-level loop state, and clear it on `session_shutdown`**

```ts
const autoState = { running: false };

export default function registerTaskCommands(pi: ExtensionAPI): void {
  pi.registerTool(createPushTaskTool(pi));
  pi.registerCommand('start-task', createStartTaskCommand(pi));
  pi.registerCommand('discard-task', createDiscardTaskCommand(pi));
  pi.registerCommand('finish-task', createFinishTaskCommand(pi));
  pi.registerCommand('abort-task', createAbortTaskCommand(pi));
  pi.registerCommand('auto', createAutoCommand(pi));

  pi.on('session_shutdown', async () => {
    autoState.running = false;
  });
}

export function lastAssistantWasAborted(session: ReadonlySessionLike): boolean {
  const branch = session.getBranch();
  const last = branch[branch.length - 1];
  return last?.type === 'message'
    && last.message.role === 'assistant'
    && last.message.stopReason === 'aborted';
}
```

- [ ] **Step 4: Implement the `/auto` loop with the spec’s start/finish ordering and a natural exit after observed work drains**

```ts
export function createAutoCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Automatically run pushed task branches',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (autoState.running) {
        ctx.ui.notify('Auto is already running.', 'warning');
        return;
      }

      autoState.running = true;
      let sawTaskActivity = false;

      try {
        while (autoState.running) {
          await ctx.waitForIdle();

          if (lastAssistantWasAborted(ctx.sessionManager)) break;

          if (pendingTask(ctx.sessionManager)) {
            const result = await startTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          if (currentTask(ctx.sessionManager)) {
            const result = await finishTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          if (sawTaskActivity && !ctx.hasPendingMessages()) {
            break;
          }
        }
      } finally {
        autoState.running = false;
      }
    },
  };
}
```

- [ ] **Step 5: Upgrade the harness so `/auto` tests can drive idle transitions and emit session events**

```ts
function makeHarness() {
  const sm = SessionManager.inMemory();
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ customType: string; content: unknown; options?: unknown }> = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  const navigations: Array<{ targetId: string; opts?: unknown }> = [];
  const idleWaiters: Array<() => void> = [];
  const sessionShutdownHandlers: Array<() => unknown> = [];
  let cancelNextNav = false;
  let pendingMessages = false;

  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
      sentMessages.push(text);
    },
    sendMessage(message: { customType: string; content: unknown; display?: boolean; details?: unknown }, options?: { triggerTurn?: boolean }) {
      sentCustomMessages.push({ customType: message.customType, content: message.content, options });
      sm.appendCustomMessageEntry(message.customType, message.content as string, message.display ?? true, message.details);
    },
    on(eventName: string, handler: () => unknown) {
      if (eventName === 'session_shutdown') sessionShutdownHandlers.push(handler);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    waitForIdle: async () => {
      await new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    hasPendingMessages: () => pendingMessages,
    sessionManager: sm,
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
    navigateTree: async (targetId: string, opts?: unknown) => {
      navigations.push({ targetId, opts });
      if (cancelNextNav) {
        cancelNextNav = false;
        return { cancelled: true };
      }
      sm.branch(targetId);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext & { sessionManager: SessionManager };

  return {
    sm,
    pi,
    ctx,
    sentMessages,
    sentCustomMessages,
    notifications,
    navigations,
    async releaseNextIdle() {
      const next = idleWaiters.shift();
      assert.ok(next, 'Expected /auto to be waiting for idle.');
      next();
      await Promise.resolve();
    },
    async flushMicrotasks() {
      await Promise.resolve();
      await Promise.resolve();
    },
    async emitSessionShutdown() {
      for (const handler of sessionShutdownHandlers) {
        await handler();
      }
    },
    setPendingMessages(value: boolean) {
      pendingMessages = value;
    },
    setCancelNextNav(v: boolean) {
      cancelNextNav = v;
    },
  };
}

function abortedAssistantMessage(text: string): AppendMessageInput {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
    model: 'test',
    provider: 'test',
    stopReason: 'aborted',
  } as AppendMessageInput;
}
```

- [ ] **Step 6: Update the registration expectation so it includes `/auto`**

```ts
assert.deepStrictEqual(registered, [
  { type: 'tool', name: 'push-task', description: 'Store a task prompt for a user-started navigation branch.' },
  { type: 'command', name: 'start-task', description: 'Navigate to a fresh context and inject the active task prompt' },
  { type: 'command', name: 'discard-task', description: 'Discard the active task without executing it' },
  { type: 'command', name: 'finish-task', description: 'Finish the current task and return to the task start point' },
  { type: 'command', name: 'abort-task', description: 'Abort the current task without finishing' },
  { type: 'command', name: 'auto', description: 'Automatically run pushed task branches' },
]);
```

- [ ] **Step 7: Re-run the `/auto` and registration coverage**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "createAutoCommand|lastAssistantWasAborted|registration"
```

Expected: PASS for the new loop, abort detection, concurrency guard, and `/auto` registration.

- [ ] **Step 8: Commit the feature once the core loop is green**

```bash
git add index.ts index.test.ts
git commit -m "feat: add auto task command"
```

## Task 4: Prove the full `/auto` roundtrip and run the project gate

**Files:**
- Modify: `index.test.ts:394-473`
- Modify: `index.test.ts:477-622`

- [ ] **Step 1: Add the failing integration-style tests for full `/auto` flows**

```ts
describe('integration: /auto fresh context', () => {
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const { pi, ctx, sm, sentCustomMessages, releaseNextIdle, flushMicrotasks } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendMessage(assistantMessage('working on main...'));

    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt: 'Analyze performance.' }, undefined, undefined, ctx);

    const auto = createAutoCommand(pi);
    const running = auto.handler('', ctx);

    await flushMicrotasks();
    await releaseNextIdle();

    sm.appendMessage(assistantMessage('Found 3 bottlenecks: ...'));
    await releaseNextIdle();
    await releaseNextIdle();
    await running;

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Found 3 bottlenecks: ...');
    assertNoActiveTask(ctx.sessionManager);
  });
});

describe('integration: /auto branch context', () => {
  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const { pi, ctx, sm, sentCustomMessages, releaseNextIdle, flushMicrotasks } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendMessage(assistantMessage('working...'));

    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt: 'Quick fix.', context: 'branch' }, undefined, undefined, ctx);

    const auto = createAutoCommand(pi);
    const running = auto.handler('', ctx);

    await flushMicrotasks();
    await releaseNextIdle();

    sm.appendMessage(assistantMessage('Fixed the bug.'));
    await releaseNextIdle();
    await releaseNextIdle();
    await running;

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Fixed the bug.');
  });

  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const { pi, ctx, sm, setCancelNextNav, releaseNextIdle, flushMicrotasks } = makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Analyze performance.' });

    const auto = createAutoCommand(pi);
    const running = auto.handler('', ctx);

    await flushMicrotasks();
    await releaseNextIdle();
    await running;

    assert.strictEqual(countCustomEntries(sm, TASK_DONE_ENTRY_TYPE), 0);
    assert.ok(pendingTask(sm));
  });
});
```

- [ ] **Step 2: Run only the new integration-style tests and watch them fail**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "integration: /auto"
```

Expected: FAIL until the harness and `/auto` exit behavior match the full roundtrip cases.

- [ ] **Step 3: Make the smallest code or harness adjustment needed so `/auto` exits cleanly after real work but keeps waiting on an empty startup**

```ts
if (pendingTask(ctx.sessionManager)) {
  const result = await startTask(pi, ctx);
  if (result === 'cancelled') break;
  sawTaskActivity = true;
  continue;
}

if (currentTask(ctx.sessionManager)) {
  const result = await finishTask(pi, ctx);
  if (result === 'cancelled') break;
  sawTaskActivity = true;
  continue;
}

if (sawTaskActivity && !ctx.hasPendingMessages()) {
  break;
}
```

This is the key boundary check: `/auto` should keep waiting before it has processed any task work, but after it has started or finished at least one task, the next idle state with no `pendingTask()`, no `currentTask()`, and no pending Pi follow-up messages is the natural stop point.

- [ ] **Step 4: Re-run the integration-style tests until they pass**

Run:
```bash
npx tsx --test index.test.ts --test-name-pattern "integration: /auto"
```

Expected: PASS for fresh-context, branch-context, and cancelled-navigation `/auto` flows.

- [ ] **Step 5: Run the fast local gate before the full project gate**

Run:
```bash
npm run fix
npx tsc --noEmit
npm test
```

Expected: PASS. `npm run fix` may rewrite formatting; if it does, re-run `npx tsc --noEmit` and `npm test` immediately afterward.

- [ ] **Step 6: Run the required project-wide verification command from `AGENTS.md`**

Run:
```bash
npm run verify
```

Expected: PASS for lint, type-checking, tests, updater drift check, and `npm pack --dry-run`.

- [ ] **Step 7: Commit the verified test coverage and final polish**

```bash
git add index.ts index.test.ts
git commit -m "test: cover auto task roundtrip"
```

## Spec Coverage Check

- **Start an active task automatically when `push-task` appears** — Task 1 updates `push-task`; Task 3 adds `/auto` start logic.
- **Finish automatically at a natural stop point** — Task 2 preserves finish behavior through helpers; Task 4 locks the loop exit condition.
- **Reuse existing task navigation behavior** — Task 2 extracts shared helpers instead of sending slash commands as text.
- **Scope checks to the current branch and stop `pendingTask()` at `task-start`** — Task 1 rewrites the lookup helpers around `getBranch()`.
- **Stop on cancelled navigation, user abort, or drained work** — Task 3 adds cancelled-return handling and `lastAssistantWasAborted()`; Task 4 locks the drained-work exit.
- **Prevent concurrent `/auto` loops** — Task 3 adds `autoState.running` and the warning path.
- **Reset module-level state on session replacement** — Task 3 adds the `session_shutdown` handler.

Plan complete and saved to `docs/superpowers/plans/2026-05-26-auto-task-command.md`. Ready to execute it using /skill:executing-plans?