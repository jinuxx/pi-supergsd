# Branch History Test Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented test helpers (`getLlmHistory`, `getLastTaskResultDetails`, `getLastHint`) with unified `assertBranchHistory` that shows complete chronological timeline.

**Architecture:** Single `assertBranchHistory(...expected)` function returned from harness, with free helper functions (`user`, `assistant`, `task`, `taskResult`, `notification`) for constructing expected entries. Notifications tracked via `ui.notify` with leaf ID for chronological placement.

**Tech Stack:** TypeScript, Node test runner, SessionManager API

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File Structure

**Modify:**
- `index.test.ts` — Add types, helpers, `assertBranchHistory`; remove `getLlmHistory`, `getLastTaskResultDetails`, `getLastHint`; update all tests

**No new files** — everything stays in the test file.

---

### Task 1: Add Types and Free Helpers

**Files:**
- Modify: `index.test.ts:1-14` (imports and top area)

- [ ] **Step 1: Add NotificationEntry type and BranchEntry union**

Add after imports, before first `describe`:

```ts
type NotificationEntry = {
  type: 'notification';
  text: string;
  afterEntryId: string | null;
};

type BranchEntry = import('@earendil-works/pi-coding-agent').SessionEntry | NotificationEntry;
```

- [ ] **Step 2: Add free helper functions**

Add after types:

```ts
const user = (content: string) => ({
  type: 'message' as const,
  message: { role: 'user' as const, content }
});

const assistant = (content: string) => ({
  type: 'message' as const,
  message: { role: 'assistant' as const, content: [{ type: 'text' as const, text: content }] }
});

const task = (prompt: string, inherit_context = false) => ({
  type: 'custom' as const,
  customType: 'task',
  data: { prompt, inherit_context }
});

const taskResult = (slug: string, content = '') => ({
  type: 'custom_message' as const,
  customType: 'task-result',
  content,
  details: { slug },
  display: true
});

const notification = (text: string) => ({
  type: 'notification' as const,
  text,
  afterEntryId: null as string | null
});
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add BranchEntry types and free helpers"
```

---

### Task 2: Add assertBranchHistory to Harness

**Files:**
- Modify: `index.test.ts` (makeHarness function)

- [ ] **Step 1: Add trackedHints array and stripIds helper**

Inside `makeHarness()`, after existing state declarations:

```ts
const trackedHints: Array<{ text: string; afterEntryId: string | null }> = [];
```

Add helper function inside makeHarness:

```ts
function stripIds(entries: Partial<BranchEntry>[]): Partial<BranchEntry>[] {
  return entries.map(e => {
    if (!e || !('type' in e)) return e;
    const { id, parentId, timestamp, ...rest } = e as Record<string, unknown>;
    return rest as Partial<BranchEntry>;
  });
}
```

- [ ] **Step 2: Update ui.notify to track hints with leaf ID**

Change `ui.notify` from:

```ts
notify(message: string) {
  hints.push({ text: message });
},
```

To:

```ts
notify(message: string) {
  trackedHints.push({ text: message, afterEntryId: sm.getLeafId() });
},
```

- [ ] **Step 3: Add assertBranchHistory function**

Add to makeHarness return:

```ts
function assertBranchHistory(...expected: Partial<BranchEntry>[]) {
  const entries = sm.getBranch();
  const actual: Partial<BranchEntry>[] = [];
  const consumedHints = new Set<number>();

  for (const entry of entries) {
    // Skip internal bookkeeping
    if (entry.type === 'custom' && entry.customType === 'task-done') continue;

    // Strip IDs for comparison
    const { id, parentId, timestamp, ...rest } = entry as Record<string, unknown>;
    actual.push(rest as Partial<BranchEntry>);

    // Insert tracked hints with matching afterEntryId
    for (let i = 0; i < trackedHints.length; i++) {
      if (trackedHints[i].afterEntryId === entry.id) {
        actual.push(notification(trackedHints[i].text));
        consumedHints.add(i);
      }
    }
  }

  // Unclassified hints (afterEntryId === null) go at start
  for (let i = 0; i < trackedHints.length; i++) {
    if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
      actual.unshift(notification(trackedHints[i].text));
    }
  }

  assert.deepStrictEqual(actual, expected);
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add index.test.ts
git commit -m "test: add assertBranchHistory to harness"
```

---

### Task 3: Remove Old Helpers from Harness

**Files:**
- Modify: `index.test.ts` (makeHarness function and return statement)

- [ ] **Step 1: Remove getLlmHistory function**

Delete the `getLlmHistory` function body (lines ~470-485 in current file).

- [ ] **Step 2: Remove getLastHint function**

Delete the `getLastHint` function (now handled by assertBranchHistory).

- [ ] **Step 3: Remove getLastTaskResultDetails function**

Delete the `getLastTaskResultDetails` function and `lastTaskResultDetails` variable.

- [ ] **Step 4: Update makeHarness return statement**

Change from:

```ts
return {
  getLlmHistory,
  isLlmTriggered,
  getLastHint,
  getStatus,
  getLastTaskResultDetails,
  appendUserMessage,
  appendAssistantMessage,
  // ... rest
};
```

To:

```ts
return {
  assertBranchHistory,
  isLlmTriggered,
  getStatus,
  appendUserMessage,
  appendAssistantMessage,
  // ... rest (keep all other helpers)
};
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Compilation errors in tests (expected - we'll fix them)

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "test: remove old helpers from harness"
```

---

### Task 4: Update "start-task fresh context" Test

**Files:**
- Modify: `index.test.ts` (first describe block)

- [ ] **Step 1: Update destructuring**

Change from:

```ts
const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, getLastTaskResultDetails, runPushTask, runStartTask, runFinishTask } =
  makeHarness();
```

To:

```ts
const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
  makeHarness();
```

- [ ] **Step 2: Replace first assertion block**

Change from:

```ts
await runPushTask('Analyze performance.');
assert.strictEqual(getStatus(), 'pending task: analyze-performance');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');
```

To:

```ts
await runPushTask('Analyze performance.');
assert.strictEqual(getStatus(), 'pending task: analyze-performance');
assertBranchHistory(
  user('main work'),
  assistant('working on main...'),
  task('Analyze performance.'),
  notification('Task stored. Use `/start-task` or `/auto` to start it.'),
);
```

- [ ] **Step 3: Replace second assertion block**

Change from:

```ts
await runStartTask();
assert.strictEqual(getStatus(), 'current task: analyze-performance');
assert.deepStrictEqual(getLlmHistory(), ['main work', 'Analyze performance.']);
assert.ok(isLlmTriggered());
assert.strictEqual(getLastHint(), undefined);
```

To:

```ts
await runStartTask();
assert.strictEqual(getStatus(), 'current task: analyze-performance');
assertBranchHistory(
  user('main work'),
  task('Analyze performance.'),
);
assert.ok(isLlmTriggered());
```

- [ ] **Step 4: Replace third assertion block**

Change from:

```ts
appendAssistantMessage('Found 3 bottlenecks: ...');

await runFinishTask();
assert.strictEqual(getStatus(), undefined);
assert.deepStrictEqual(getLlmHistory(), [
  'main work',
  'working on main...',
  'Found 3 bottlenecks: ...',
]);
assert.ok(isLlmTriggered());
assert.ok(getLastHint()?.includes('Task finished'));

const details = getLastTaskResultDetails();
assert.ok(details, 'Expected task-result details');
assert.strictEqual(details?.slug, 'analyze-performance', 'task-result label should include slug');
```

To:

```ts
appendAssistantMessage('Found 3 bottlenecks: ...');

await runFinishTask();
assert.strictEqual(getStatus(), undefined);
assertBranchHistory(
  user('main work'),
  assistant('working on main...'),
  assistant('Found 3 bottlenecks: ...'),
  taskResult('analyze-performance'),
  notification('Task finished. Last response attached.'),
);
assert.ok(isLlmTriggered());
```

- [ ] **Step 5: Run this specific test**

Run: `node --test --test-name-pattern "completes /start-task → work → /finish-task with last-response injection" index.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "test: update start-task fresh context test"
```

---

### Task 5: Update "start-task branch context" Test

**Files:**
- Modify: `index.test.ts` (second describe block)

- [ ] **Step 1: Update destructuring**

Change from:

```ts
const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, getLastTaskResultDetails, runPushTask, runStartTask, runFinishTask } =
  makeHarness();
```

To:

```ts
const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
  makeHarness();
```

- [ ] **Step 2: Replace assertion blocks**

Replace all `getLlmHistory`, `getLastHint`, `getLastTaskResultDetails` calls with `assertBranchHistory` using appropriate entries.

- [ ] **Step 3: Run this specific test**

Run: `node --test --test-name-pattern "completes /start-task branch → work → /finish-task" index.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: update start-task branch context test"
```

---

### Task 6: Update "auto fresh context" Test

**Files:**
- Modify: `index.test.ts` (auto fresh context describe block)

- [ ] **Step 1: Update destructuring and assertions**

Replace `getLlmHistory`, `getLastHint`, `getLastTaskResultDetails` with `assertBranchHistory`.

- [ ] **Step 2: Run this specific test**

Run: `node --test --test-name-pattern "completes push-task -> /auto -> finish-task" index.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: update auto fresh context test"
```

---

### Task 7: Update "auto branch context" Tests

**Files:**
- Modify: `index.test.ts` (auto branch context describe block - 2 tests)

- [ ] **Step 1: Update "returns the branch result" test**

Replace old helpers with `assertBranchHistory`.

- [ ] **Step 2: Update "stops when navigation is cancelled" test**

Replace old helpers with `assertBranchHistory`.

- [ ] **Step 3: Run these specific tests**

Run: `node --test --test-name-pattern "auto branch context" index.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: update auto branch context tests"
```

---

### Task 8: Update Remaining Tests

**Files:**
- Modify: `index.test.ts` (discardTask, abortTask, createAutoCommand tests)

- [ ] **Step 1: Update discardTask test**

Replace `getLlmHistory`, `getLastHint` with `assertBranchHistory`.

- [ ] **Step 2: Update abortTask test**

Replace `getLlmHistory`, `getLastHint` with `assertBranchHistory`.

- [ ] **Step 3: Update createAutoCommand tests (4 tests)**

Replace `getLlmHistory`, `getLastHint` with `assertBranchHistory`.

- [ ] **Step 4: Run all tests**

Run: `node --test index.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add index.test.ts
git commit -m "test: update remaining tests to use assertBranchHistory"
```

---

### Task 9: Cleanup and Verification

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Remove unused hints array**

If `hints` array is no longer used, remove it from makeHarness.

- [ ] **Step 2: Remove unused buildSessionContext import**

If `getLlmHistory` was the only user, remove the import.

- [ ] **Step 3: Run full verification**

Run: `npm run verify`
Expected: All checks pass (lint, tsc, test, etc.)

- [ ] **Step 4: Final commit**

```bash
git add index.test.ts
git commit -m "test: cleanup unused imports and state"
```
