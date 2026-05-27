# Test harness refactoring: user-perspective API

## Goal

Rewrite the `push-task` extension test harness and tests to use a "user perspective" API: tests verify the full LLM-visible message history and whether the last entry would trigger the LLM, instead of asserting on internal message-sending mechanics.

## Removals

### From tests

- Entire `describe('registration', ...)` block
- Test: "stops instead of finishing the task when the last assistant message was aborted" — removed

### From harness

- `sentMessages[]`, `sentCustomMessages[]`, `navigations[]` arrays
- `abortedAssistantMessage()` helper
- `assertNoActiveTask()`, `getActiveTask()`, `countCustomEntries()` — task-internal, not user-visible
- `assertLastNotification()`, old `getLastNotification()`, `Notification` interface
- `TaskShape` interface, `TASK_DONE_ENTRY_TYPE` constant
- `pi`, `ctx`, `sm` — no longer exposed; harness owns them fully

### Retained from harness

- `releaseNextIdle()`, `flushMicrotasks()`, `emitSessionShutdown()`
- `setPendingMessages()`, `setCancelNextNav()`
- `runPushTask()`, `runStartTask()`, `runFinishTask()`, `runDiscardTask()`, `runAbortTask()`, `runAuto()`

## New public API (`makeHarness()` return)

```ts
// Message builders — append directly to session
appendUserMessage(text: string): void
appendAssistantMessage(text: string): void

// LLM perspective
getLlmHistory(): string[]       // buildSessionContext at current leaf, text blocks only
isLlmTriggered(): boolean       // would the last entry on the branch trigger the LLM?

// Notifications
getLastNotification(): string | undefined
```

## Implementation details

### Mock `pi` / `ctx` — internal only

The harness creates `pi` and `ctx` mocks internally and calls `registerTaskCommands(pi)` during construction. Tests never touch `pi`, `ctx`, or `sm` directly.

### `pi.sendUserMessage()` mock behavior

```ts
pi.sendUserMessage = (content, _options) => {
  const text = typeof content === 'string' ? content : content.map(b => b.text).join('');
  sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  // No trigger tracking needed — user messages always trigger (derived from entry type)
};
```

### `pi.sendMessage()` mock behavior

```ts
const triggeredCustomMessages = new Set<string>();

pi.sendMessage = (message, options) => {
  const entryId = sm.appendCustomMessageEntry(
    message.customType,
    message.content as string,
    message.display ?? true,
    message.details,
  );
  if (options?.triggerTurn) {
    triggeredCustomMessages.add(entryId);
  }
};
```

### `appendUserMessage(text)`

Appends `{ role: 'user', content: text, timestamp: 0 }` via `sm.appendMessage()`.

### `appendAssistantMessage(text)`

Appends `{ role: 'assistant', content: [{ type: 'text', text }], timestamp: 0, model: 'test', provider: 'test' }` via `sm.appendMessage()`.

### `getLlmHistory()`

Uses `buildSessionContext` imported from `@earendil-works/pi-coding-agent`:

```ts
import { buildSessionContext } from '@earendil-works/pi-coding-agent';

function getLlmHistory(): string[] {
  const ctx = buildSessionContext(sm.getEntries(), sm.getLeafId());
  return ctx.messages.map(m => {
    if (typeof m.content === 'string') return m.content;
    if (!Array.isArray(m.content)) return '';
    return m.content
      .filter((b): b is { type: 'text'; text: string } =>
        typeof b === 'object' && b !== null && 'type' in b && b.type === 'text'
      )
      .map(b => b.text)
      .join('');
  });
}
```

`buildSessionContext` converts `custom_message` entries (branch results) to messages, so they appear in the output. The function is live — each call reads the current branch's entries and leaf.

Initial state: `[]` (no messages in empty session).

### `isLlmTriggered()`

Derives trigger state from the last entry on the branch, not a global flag. This correctly reflects state after commands that branch or navigate:

```ts
function isLlmTriggered(): boolean {
  const branch = sm.getBranch();
  const last = branch[branch.length - 1];
  if (!last) return false;
  if (last.type === 'message' && last.message.role === 'user') return true;
  if (last.type === 'message' && last.message.role === 'assistant') return false;
  if (last.type === 'custom_message') return triggeredCustomMessages.has(last.id);
  return false; // custom, compaction, branch_summary, etc.
}
```

| Last entry type | Triggered? |
|---|---|
| User message | `true` |
| Assistant message | `false` |
| Custom message (with `triggerTurn`) | `true` |
| Custom message (without `triggerTurn`) | `false` |
| Custom entry (`task`, `task-start`, `task-done`) | `false` |
| Compaction, branch_summary, etc. | `false` |
| Empty branch | `false` |

### `getLastNotification()`

Returns the text of the most recent `ctx.ui.notify(message, _type)` call, or `undefined` if none. Type is not exposed — message text alone distinguishes scenarios.

Initial state: `undefined`.

## Test rewrite strategy

### Assertion philosophy

Tests assert the **full** `getLlmHistory()` array to validate branching behavior — a fresh-context task shows only the task prompt, a branch-context task includes prior messages, and a finished task shows the original branch with the branch result injected.

Task lifecycle (task entries, task-done count) is not asserted — those are implementation details invisible to the LLM.

### New tests added

**`discardTask` — discards a pending task without triggering the LLM**

```ts
appendUserMessage('main work');
await runPushTask('Quick fix.');
await runDiscardTask();
assert.strictEqual(getLastNotification(), 'Task discarded.');
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work']);
```

**`abortTask` — aborts an in-progress task and returns to the original branch**

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');
await runStartTask();
appendAssistantMessage('Partial work...');
await runAbortTask();
assert.strictEqual(getLastNotification(), 'Task aborted. Branch abandoned without summary.');
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...']);
```

### Existing tests rewritten

**1. `integration: /start-task fresh context` — completes start → work → finish**

```ts
appendUserMessage('main work');
appendAssistantMessage('working on main...');
await runPushTask('Analyze performance.');   // default 'fresh'
await runStartTask();
// Fresh context: navigated to new root, only the task prompt is visible
assert.deepStrictEqual(getLlmHistory(), ['Analyze performance.']);
assert.ok(isLlmTriggered());

appendAssistantMessage('Found 3 bottlenecks: ...');
await runFinishTask();
// Navigated back + branch result injected
assert.deepStrictEqual(getLlmHistory(), [
  'main work',
  'working on main...',
  'Found 3 bottlenecks: ...',
]);
assert.ok(isLlmTriggered());
assert.ok(getLastNotification()?.includes('Task finished'));
```

**2. `integration: /start-task branch context` — completes start → work → finish**

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');
await runStartTask();
// Branch context: stays on current branch, history includes prior messages
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
assert.ok(isLlmTriggered());

appendAssistantMessage('Fixed the bug.');
await runFinishTask();
// Navigated back + branch result injected (prior task-branch messages not visible)
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Fixed the bug.']);
assert.ok(isLlmTriggered());
```

**3. `integration: /auto fresh context` — completes push-task → auto → finish**

```ts
appendUserMessage('main work');
appendAssistantMessage('working on main...');
await runPushTask('Analyze performance.');

const running = runAuto();
await flushMicrotasks();
await releaseNextIdle();
// Auto ran start-task: fresh navigation, only task prompt visible
assert.deepStrictEqual(getLlmHistory(), ['Analyze performance.']);

appendAssistantMessage('Found 3 bottlenecks: ...');
await releaseNextIdle();
await releaseNextIdle();
await running;
// Auto ran finish-task: navigated back + branch result
assert.deepStrictEqual(getLlmHistory(), [
  'main work',
  'working on main...',
  'Found 3 bottlenecks: ...',
]);
assert.ok(isLlmTriggered());
assert.ok(getLastNotification()?.includes('Task finished'));
```

**4. `integration: /auto branch context` — returns branch result to original leaf**

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');

const running = runAuto();
await flushMicrotasks();
await releaseNextIdle();
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);

appendAssistantMessage('Fixed the bug.');
await releaseNextIdle();
await releaseNextIdle();
await running;
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Fixed the bug.']);
assert.ok(isLlmTriggered());
```

**5. `integration: /auto branch context` — stops when navigation is cancelled**

```ts
appendUserMessage('main work');
await runPushTask('Analyze performance.');
setCancelNextNav(true);

const running = runAuto();
await flushMicrotasks();
await releaseNextIdle();
await running;
// Navigation cancelled: no messages added, history unchanged
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work']);
```

**6. `createAutoCommand` — waits when started with no task, then starts after push**

```ts
const running = runAuto();
await flushMicrotasks();
await releaseNextIdle();
// Auto is waiting — no task yet

await runPushTask('Review spec.');
await releaseNextIdle();
// Auto picked up the task, sent user message
assert.deepStrictEqual(getLlmHistory(), ['Review spec.']);

appendAssistantMessage('Done.');
await releaseNextIdle();
await releaseNextIdle();
await running;
```

**7. `createAutoCommand` — warns when /auto is already running**

```ts
const firstRun = runAuto();
await flushMicrotasks();

await runAuto();
assert.strictEqual(getLastNotification(), 'Auto is already running.');

await emitSessionShutdown();
await releaseNextIdle();
await firstRun;
```

**8. `createAutoCommand` — keeps waiting while follow-up work is pending**

```ts
appendUserMessage('start');
await runPushTask('Quick fix.', 'branch');
await runStartTask();
appendAssistantMessage('Fixed the bug.');

let resolved = false;
const running = runAuto().then(() => { resolved = true; });

await flushMicrotasks();
setPendingMessages(true);
await releaseNextIdle();
await releaseNextIdle();
// Finish happened but pending messages prevent auto from stopping
assert.ok(isLlmTriggered());
assert.strictEqual(resolved, false);

setPendingMessages(false);
await releaseNextIdle();
await running;
assert.strictEqual(resolved, true);
```

## Files changed

- `index.test.ts` — harness rewrite + tests rewritten + 2 new tests
- `index.ts` — no changes

## Things intentionally not covered

- `lastAssistantWasAborted` logic untested after test removal (low-value edge case; function remains in production code)
- Notification type (`info`/`warning`) not distinguished in `getLastNotification()` — message text alone suffices
