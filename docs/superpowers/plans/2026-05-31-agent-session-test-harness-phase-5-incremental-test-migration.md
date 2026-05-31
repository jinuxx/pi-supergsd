# AgentSession Test Harness Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port existing workflow tests from `LegacyTestHarness` to the AgentSession-backed `TestHarness` in small green batches.

**Architecture:** Convert setup from direct message injection to `await h.prompt(...)`, convert reaction matches from visible entries to explicit model-prompt or queued-task matches, and keep assertions at the SuperGSD DSL level. Each batch runs focused tests before moving on.

**Tech Stack:** TypeScript, Node test runner, AgentSession-backed `TestHarness`, faux provider descriptors.

**Roadmap:** `docs/superpowers/roadmaps/2026-05-31-agent-session-test-harness-roadmap.md`

**Phase:** Phase 5: Incremental Test Migration

---

## File Structure

- `src/manual.test.ts`: migrate manual command/tool tree tests from legacy setup to prompt descriptors.
- `src/auto.test.ts`: migrate auto workflow tests to `prompt`, `queuedTask`, `responds`, `aborts`, and `pushTask` descriptors.
- `src/test-helpers/test-tree.ts`: switch node DSL to the async new harness after the first manual batch is ready.
- `src/test-helpers/index.ts`: keep all descriptor exports stable for tests.
- `src/test-helpers/harness.ts`, `assertions.ts`, `reactions.ts`: small fixes found by migration, but no broad new features.

### Task 1: Prepare migration imports

**Files:**
- Modify: `src/manual.test.ts`
- Modify: `src/auto.test.ts`

- [ ] **Step 1: Add new descriptor imports where needed**

In `src/manual.test.ts`, extend imports from `./test-helpers/index.js`:

```ts
import {
  assistant,
  notification,
  node,
  responds,
  task,
  taskResult,
  user,
} from './test-helpers/index.js';
```

In `src/auto.test.ts`, extend imports:

```ts
import {
  aborts,
  assistant,
  notification,
  prompt,
  pushTask,
  queuedTask,
  responds,
  task,
  taskResult,
  user,
  userCtrlC,
  userEsc,
  userRunsAuto,
  TestHarness,
} from './test-helpers/index.js';
```

- [ ] **Step 2: Run type-check before behavior migration**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS or unused import lint warnings only after `npm run lint`; do not run lint until imports are used.

### Task 2: Switch `node()` DSL to async new harness construction

**Files:**
- Modify: `src/test-helpers/test-tree.ts`

- [ ] **Step 1: Import the new harness**

Replace the legacy import with:

```ts
import { TestHarness } from './harness.js';
```

Keep:

```ts
type NodeFn = (h: TestHarness) => Promise<void> | void;
```

- [ ] **Step 2: Construct and dispose the async harness in each test**

Replace the `it` body harness creation with:

```ts
it(name, async () => {
  const h = await TestHarness.create();
  try {
    for (const node of chain) {
      await node.fn?.(h);
    }
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 3: Run manual tests and observe expected failures**

Run:

```bash
npx tsx --test src/manual.test.ts
```

Expected: FAIL because tests still call `appendUserMessage` and `appendAssistantMessage`. Continue to Task 3.

### Task 3: Migrate manual workflow setup from direct injection to real prompts

**Files:**
- Modify: `src/manual.test.ts`

- [ ] **Step 1: Replace root setup prompt**

Replace every adjacent pair:

```ts
h.appendUserMessage('main work');
h.appendAssistantMessage('working...');
```

with:

```ts
await h.prompt('main work', responds('working...'));
```

- [ ] **Step 2: Replace task-branch assistant setup before finish/abort**

Replace:

```ts
h.appendAssistantMessage('Done.');
```

with:

```ts
await h.prompt('continue task', responds('Done.'));
```

Then update expected branch history in the same test to include the new user prompt only when it remains on the visible current branch. For task finish tests that return to the parent branch, keep the final parent assertion focused on `taskResult(..., 'Done.')` because the task branch prompt is not on the parent branch.

- [ ] **Step 3: Replace inner task setup messages**

Replace each assistant-only setup:

```ts
h.appendAssistantMessage('some more work');
```

with:

```ts
await h.prompt('more task work', responds('some more work'));
```

Replace:

```ts
h.appendAssistantMessage('inner done');
```

with:

```ts
await h.prompt('finish inner task', responds('inner done'));
```

Replace:

```ts
h.appendAssistantMessage('partial inner');
```

with:

```ts
await h.prompt('partial inner task', responds('partial inner'));
```

Replace:

```ts
h.appendAssistantMessage('Partial...');
```

with:

```ts
await h.prompt('partial task work', responds('Partial...'));
```

- [ ] **Step 4: Update `isLlmTriggered` expectations if needed**

If real AgentSession no longer exposes legacy triggered-entry flags, replace assertions like:

```ts
assert.ok(h.isLlmTriggered());
```

with explicit branch/session assertions showing the user prompt was sent:

```ts
h.assertSessionContains(user('Task AAA'));
```

Keep `assert.ok(!h.isLlmTriggered())` only if the new harness implements it against real entries. Otherwise remove these legacy implementation assertions and rely on visible history plus status checks.

- [ ] **Step 5: Run manual tests**

Run:

```bash
npx tsx --test src/manual.test.ts
```

Expected: PASS. If failures are only extra task-branch prompts visible in branch history, update expectations to match real AgentSession behavior rather than hiding real prompts.

### Task 4: Migrate auto tests to new prompt/reaction descriptors

**Files:**
- Modify: `src/auto.test.ts`

- [ ] **Step 1: Replace direct root setup**

Replace:

```ts
h.appendUserMessage('main work');
h.appendAssistantMessage('working on main...');
```

with:

```ts
await h.prompt('main work', responds('working on main...'));
```

Replace other direct pairs similarly:

```ts
await h.prompt('main work', responds('working...'));
await h.prompt('start', responds('ready'));
```

- [ ] **Step 2: Replace auto reaction matches**

Apply these exact mappings:

```ts
[user('Analyze performance'), assistant('Found 3 bottlenecks: ...')]
```

becomes:

```ts
[prompt('Analyze performance'), responds('Found 3 bottlenecks: ...')]
```

```ts
[task('Analyze performance.'), userEsc()]
```

becomes:

```ts
[queuedTask('Analyze performance.'), userEsc()]
```

```ts
[user('Implement phase 1'), assistant('Stopped by user.', 'aborted')]
```

becomes:

```ts
[prompt('Implement phase 1'), aborts('Stopped by user.')]
```

```ts
[assistant('working on parent...'), task('subtask')]
```

becomes:

```ts
[assistant('working on parent...'), pushTask('subtask')]
```

- [ ] **Step 3: Convert steering-message reactions**

Replace the legacy user reaction:

```ts
[assistant('thinking...'), user('steer it')]
```

with the new harness helper for steering if implemented in Phase 4. If no helper exists yet, add `userSteers(text)` in `descriptors.ts` and handle it in `reactions.ts` by calling `session.steer(text)`. The test should read:

```ts
[assistant('thinking...'), userSteers('steer it')]
[prompt('steer it'), responds('adjusted response')]
```

- [ ] **Step 4: Run auto tests**

Run:

```bash
npx tsx --test src/auto.test.ts
```

Expected: PASS. If a test still depends on direct `SessionManager` construction and `assumeCommandContext`, leave that low-level command-state test unchanged because it tests `cmdAuto` directly, not the harness migration.

### Task 5: Remove direct message injection use from tests

**Files:**
- Modify: `src/manual.test.ts`
- Modify: `src/auto.test.ts`

- [ ] **Step 1: Search for direct injection calls**

Run:

```bash
rg "appendUserMessage|appendAssistantMessage" src/manual.test.ts src/auto.test.ts
```

Expected: no output.

- [ ] **Step 2: Search for ambiguous reaction descriptors**

Run:

```bash
rg "\[user\(|\[task\(" src/auto.test.ts
```

Expected: no output for reaction arrays. It is fine for `user(...)` and `task(...)` to remain inside assertions.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx tsx --test src/manual.test.ts src/auto.test.ts
```

Expected: PASS.

### Task 6: Verify and commit migration

**Files:**
- All files touched in this phase

- [ ] **Step 1: Run type-check and full test suite**

Run:

```bash
npx tsc --noEmit
npm test
```

Expected: PASS.

- [ ] **Step 2: Run required autofix**

Run:

```bash
npm run fix
```

Expected: PASS.

- [ ] **Step 3: Commit phase 5**

Run:

```bash
git add src/manual.test.ts src/auto.test.ts src/test-helpers

git commit -m "test: migrate workflows to AgentSession harness"
```

Expected: commit succeeds.

## Inline Plan Review

- **Roadmap coverage:** Covers manual and auto test migration, direct injection removal from tests, explicit reaction descriptor replacements, and node DSL switch. Excludes legacy file deletion and final cleanup.
- **Placeholder scan:** The steering helper addition is a concrete conditional with exact API and expected test shape if Phase 4 did not already add it.
- **Type consistency:** `responds` supplies provider responses; `assistant`, `user`, `task`, and `taskResult` remain assertion descriptors.
- **Phase boundary health:** Tests are fully migrated but legacy files still exist, so cleanup can be separate and low risk.
