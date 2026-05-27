# Test harness refactoring: user-perspective API

## Goal

Rewrite the `push-task` extension test harness and tests to use a "user perspective" API: tests verify what the LLM would see and whether it would be triggered, instead of asserting on internal message-sending mechanics (`sentMessages`, `sentCustomMessages`).

## Removals

### From tests

- Entire `describe('registration', ...)` block
- Test: "warns and returns when /auto is already running" — rewritten (no `pi`/`notifications` exposure needed)
- Test: "stops instead of finishing the task when the last assistant message was aborted" — removed (abortion edge case)

### From harness

- `sentMessages[]`, `sentCustomMessages[]`, `navigations[]` arrays (replaced by `lastTriggered` boolean)
- `abortedAssistantMessage()` helper (removed with its test)
- `runAbortTask()`, `runDiscardTask()` (already unused)
- `assertNoActiveTask()`, `getActiveTask()`, `countCustomEntries()` (task-internal, not user-visible)
- `assertLastNotification()`, old `getLastNotification()`, `Notification` interface
- `TaskShape` interface, `TASK_DONE_ENTRY_TYPE` constant
- `pi`, `ctx`, `sm` — no longer exposed; harness owns them fully. Commands are auto-registered internally.

### Retained from harness

- `releaseNextIdle()`, `flushMicrotasks()`, `emitSessionShutdown()`
- `setPendingMessages()`, `setCancelNextNav()`
- `runPushTask()`, `runStartTask()`, `runFinishTask()`, `runAuto()`

## New public API (`makeHarness()` return)

```ts
// Message builders — append directly to session
appendUserMessage(text: string): void
appendAssistantMessage(text: string): void

// LLM perspective
getLlmHistory(): string[]         // buildSessionContext at current leaf, text blocks only
isLlmTriggered(): boolean         // would the last entry trigger the LLM?

// Notifications
getLastNotification(): string | undefined  // last notify() text, or undefined
```

## Implementation details

### Mock `pi` / `ctx` — internal only

The harness creates `pi` and `ctx` mocks internally and calls `registerTaskCommands(pi)` during construction. Tests never touch `pi`, `ctx`, or `sm` directly.

### `pi.sendUserMessage()` mock behavior

```ts
pi.sendUserMessage = (content, _options) => {
  const text = typeof content === 'string' ? content : content.map(b => b.text).join('');
  sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  lastTriggered = true;  // user messages always trigger
};
```

### `pi.sendMessage()` mock behavior

```ts
pi.sendMessage = (message, options) => {
  sm.appendCustomMessageEntry(
    message.customType,
    message.content as string,
    message.display ?? true,
    message.details,
  );
  lastTriggered = options?.triggerTurn === true;
};
```

### `appendUserMessage(text)`

Appends `{ role: 'user', content: text, timestamp: 0 }` via `sm.appendMessage()`. Sets `lastTriggered = true`.

### `appendAssistantMessage(text)`

Appends `{ role: 'assistant', content: [{ type: 'text', text }], timestamp: 0, model: 'test', provider: 'test' }` via `sm.appendMessage()`. Sets `lastTriggered = false`.

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

`buildSessionContext` converts `custom_message` entries (branch results) to messages via `createCustomMessage()`, so they appear in the output. The function is live — each call reads the current branch's entries and leaf.

Initial state: `[]` (no messages in empty session).

### `isLlmTriggered()`

Returns `lastTriggered` — a boolean in harness closure:

- `pi.sendUserMessage()` → `true`
- `pi.sendMessage(msg, opts)` → `opts.triggerTurn === true`
- `appendUserMessage()` → `true`
- `appendAssistantMessage()` → `false`

Initial state: `false`.

### `getLastNotification()`

Returns the text of the most recent `ctx.ui.notify(message, _type)` call, or `undefined` if none. Notification type (`'info'`/`'warning'`/`'error'`) is not exposed — the message text alone distinguishes scenarios.

Initial state: `undefined`.

## Test rewrite strategy

### Task lifecycle verification — intentionally dropped

Task entries (`task`, `task-start`, `task-done`) are `custom` type entries that `buildSessionContext` ignores. They are implementation details, not user-visible. Tests that previously verified task state (e.g., `assertNoActiveTask`, `countCustomEntries`) now verify LLM-visible outcomes instead:

| What was asserted | What is asserted now |
|---|---|
| Task prompt sent to LLM | `getLlmHistory()` contains the prompt text |
| Task finished & branch result injected | `isLlmTriggered()` is `true`; `getLlmHistory()` ends with result text |
| Task not done after cancelled nav | `isLlmTriggered()` is `false` (no branch result sent) |
| Task cleared after finish | Notification contains "Task finished" |

### Per-test rewrite plan

**1. `integration: /start-task fresh context` → `'completes /start-task → work → /finish-task'`**
- `sm.appendMessage({ role: 'user', ... })` → `appendUserMessage('main work')`
- `sm.appendMessage(assistantMessage(...))` → `appendAssistantMessage('working on main...')`
- `assert.deepStrictEqual(sentMessages, [...])` → `assert.ok(isLlmTriggered()); assert.ok(getLlmHistory().some(m => m.includes('Analyze performance.')))`
- `assert.strictEqual(sentCustomMessages.length, 1)` etc. → `assert.ok(isLlmTriggered()); const h = getLlmHistory(); assert.ok(h[h.length-1].includes('Found 3 bottlenecks'))`
- `assertLastNotification(...)` → `assert.ok(getLastNotification()?.includes('Task finished'))`
- `assertNoActiveTask(sm)` → dropped (task lifecycle is internal)

**2. `integration: /start-task branch context` → `'completes /start-task branch → work → /finish-task'`**
- Same pattern as test 1, with `'branch'` context

**3. `integration: /auto fresh context` → `'completes push-task → /auto → finish-task'`**
- Same rewrite pattern
- `assertNoActiveTask(sm)` → replaced by notification assertion

**4. `integration: /auto branch context` → `'returns branch result to original leaf'`**
- Same rewrite pattern

**5. `integration: /auto branch context` → `'stops when navigation is cancelled'`**
- `countCustomEntries(sm, TASK_DONE_ENTRY_TYPE)` → `assert.ok(!isLlmTriggered())` (no branch result injected)
- `assert.ok(getActiveTask(sm))` → dropped (task lifecycle is internal)

**6. `createAutoCommand` → `'waits when started with no task'`**
- No assertions change (this test only verifies flow completes)

**7. `createAutoCommand` → `'warns and returns when /auto is already running'`**
- `pi` + `registerTaskCommands(pi)` → removed (harness auto-registers)
- `assertLastNotification(notifications, 'warning', 'Auto is already running.')` → `assert.strictEqual(getLastNotification(), 'Auto is already running.')`
- `emitSessionShutdown()` stays (needed to unblock first auto)

**8. `createAutoCommand` → `'stops instead of finishing the task when the last assistant message was aborted'`**
- Entire test removed

**9. `createAutoCommand` → `'keeps waiting while follow-up work is pending after finishTask'`**
- `sentCustomMessages.length` assertion → `isLlmTriggered()` check
- Remainder unchanged (flow control assertions)

## Files changed

- `index.test.ts` — harness rewrite + all tests rewritten
- `index.ts` — no changes

## Things intentionally not covered

- `discardTask` / `abortTask` have no tests (pre-existing, out of scope)
- `lastAssistantWasAborted` logic untested after its test is removed (low-value edge case; the function remains in production code)
- Notification type (`info`/`warning`) not distinguished in `getLastNotification()` — message text alone suffices for current test scenarios
