# AgentSession Test Harness Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current hand-rolled harness as `LegacyTestHarness` and prepare clean helper module boundaries for the new harness.

**Architecture:** This phase is intentionally mechanical. Move the current implementation to `legacy-harness.ts`, keep compatibility exports so existing tests still import `TestHarness`, and split descriptor exports into `descriptors.ts` without changing runtime behavior.

**Tech Stack:** TypeScript ES modules, Node 20 test runner, `@earendil-works/pi-coding-agent` test helpers, ESLint, `tsx`.

**Roadmap:** `docs/superpowers/roadmaps/2026-05-31-agent-session-test-harness-roadmap.md`

**Phase:** Phase 1: Legacy Harness Rename and Module Boundary Prep

---

## File Structure

- `src/test-helpers/legacy-harness.ts`: renamed copy of the current `test-harness.ts`; owns all existing legacy runtime behavior.
- `src/test-helpers/test-harness.ts`: compatibility shim exporting `LegacyTestHarness` as `TestHarness` during migration.
- `src/test-helpers/descriptors.ts`: descriptor builders and descriptor types moved out of `common.ts` without semantic changes.
- `src/test-helpers/common.ts`: compatibility shim re-exporting descriptors and `assumeCommandContext` during migration.
- `src/test-helpers/index.ts`: public helper exports; exports both `LegacyTestHarness` and transitional `TestHarness`.
- `src/test-helpers/test-tree.ts`: keeps constructing the transitional `TestHarness` so existing tree tests continue to pass.

### Task 1: Capture the baseline before mechanical edits

**Files:**
- Inspect: `src/test-helpers/test-harness.ts`
- Inspect: `src/test-helpers/common.ts`
- Inspect: `src/test-helpers/index.ts`
- Inspect: `src/test-helpers/test-tree.ts`

- [ ] **Step 1: Run the focused test suite before editing**

Run:

```bash
npm test
```

Expected: PASS. If this fails, stop and use /skill:systematic-debugging before continuing; this phase depends on a green baseline.

- [ ] **Step 2: Confirm current helper import sites**

Run:

```bash
rg "test-helpers/(test-harness|common)|TestHarness|appendUserMessage|appendAssistantMessage" src -n
```

Expected: output includes current tests and helper files. Use the output to verify that this phase only needs compatibility shims, not test rewrites.

### Task 2: Move the existing harness to `legacy-harness.ts`

**Files:**
- Create: `src/test-helpers/legacy-harness.ts`
- Modify: `src/test-helpers/test-harness.ts`

- [ ] **Step 1: Copy current harness implementation**

Run:

```bash
cp src/test-helpers/test-harness.ts src/test-helpers/legacy-harness.ts
```

Expected: command exits 0 and the new file exists.

- [ ] **Step 2: Rename the class in the copied file**

Edit `src/test-helpers/legacy-harness.ts` so the class declaration is exactly:

```ts
export class LegacyTestHarness {
```

The rest of the file should remain unchanged in this step.

- [ ] **Step 3: Replace `test-harness.ts` with a compatibility shim**

Replace `src/test-helpers/test-harness.ts` with:

```ts
export { LegacyTestHarness as TestHarness } from './legacy-harness.js';
export { LegacyTestHarness } from './legacy-harness.js';
```

- [ ] **Step 4: Type-check the mechanical rename**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS. If TypeScript reports stale class names, fix only import/export names; do not change harness behavior.

### Task 3: Split descriptors into their own module

**Files:**
- Create: `src/test-helpers/descriptors.ts`
- Modify: `src/test-helpers/common.ts`
- Modify: `src/test-helpers/index.ts`

- [ ] **Step 1: Copy descriptor code to `descriptors.ts`**

Create `src/test-helpers/descriptors.ts` by moving the full current contents of `src/test-helpers/common.ts` into it. Keep all exported names unchanged:

```ts
export {
  assistant,
  user,
  task,
  taskResult,
  userEsc,
  userCtrlC,
  userRunsAuto,
  notification,
  assumeCommandContext,
};
```

- [ ] **Step 2: Replace `common.ts` with a compatibility shim**

Replace `src/test-helpers/common.ts` with:

```ts
export type {
  AutoConfig,
  BranchEntry,
  MatchDescriptor,
  NotificationEntry,
  ReactionDescriptor,
} from './descriptors.js';

export {
  assistant,
  user,
  task,
  taskResult,
  userEsc,
  userCtrlC,
  userRunsAuto,
  notification,
  assumeCommandContext,
} from './descriptors.js';
```

- [ ] **Step 3: Export descriptors from the public helper index**

Update `src/test-helpers/index.ts` so descriptor exports come from `descriptors.js`:

```ts
export {
  assistant,
  user,
  task,
  taskResult,
  userEsc,
  userCtrlC,
  userRunsAuto,
  notification,
  assumeCommandContext,
} from './descriptors.js';

export { LegacyTestHarness, TestHarness } from './test-harness.js';

export { node } from './test-tree.js';
```

- [ ] **Step 4: Keep legacy internal imports working**

Do not change `legacy-harness.ts` imports in this phase unless lint requires it. Imports from `./common.js` are allowed because `common.ts` is now a shim.

### Task 4: Make the transitional harness type explicit in test-tree

**Files:**
- Modify: `src/test-helpers/test-tree.ts`

- [ ] **Step 1: Import the transitional harness from the shim**

Ensure `src/test-helpers/test-tree.ts` contains:

```ts
import { TestHarness } from './test-harness.js';
```

This keeps existing tree tests running against the legacy harness through the compatibility shim.

- [ ] **Step 2: Verify the node callback type stays unchanged**

Confirm the callback type remains:

```ts
type NodeFn = (h: TestHarness) => Promise<void> | void;
```

Do not introduce harness selection yet; that belongs to later migration phases.

### Task 5: Verify no behavior changed

**Files:**
- Test: `src/manual.test.ts`
- Test: `src/auto.test.ts`

- [ ] **Step 1: Run focused helper checks**

Run:

```bash
npx tsc --noEmit
npm test
```

Expected: both commands PASS.

- [ ] **Step 2: Run lint and autofix as required by project policy**

Run:

```bash
npm run fix
```

Expected: command exits 0. If files are modified, inspect the diff and keep only formatting/import cleanup.

- [ ] **Step 3: Review the diff for mechanical-only changes**

Run:

```bash
git diff -- src/test-helpers
```

Expected: diff shows a move/copy to `legacy-harness.ts`, compatibility shims, and descriptor extraction only. No logic changes inside the legacy harness except class name.

- [ ] **Step 4: Commit phase 1**

Run:

```bash
git add src/test-helpers

git commit -m "test: rename legacy test harness"
```

Expected: commit succeeds.

## Inline Plan Review

- **Roadmap coverage:** Covers Phase 1 rename, compatibility exports, and module boundary preparation. Excludes AgentSession work, provider queues, test migration, and deletion of `pi-stub.ts` as required.
- **Placeholder scan:** No placeholders or deferred implementation instructions remain.
- **Type consistency:** `LegacyTestHarness` is the concrete class; `TestHarness` is a transitional alias exported from `test-harness.ts`.
- **Phase boundary health:** Existing tests continue using the same behavior through the alias, so the project should remain green after this phase.
