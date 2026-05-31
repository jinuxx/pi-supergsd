# AgentSession Test Harness Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy harness and Pi stub so the AgentSession-backed test helper stack is the only active test API.

**Architecture:** Delete transitional compatibility files after repository-wide searches confirm no consumers remain, then tighten exports around the final helper modules. This phase is cleanup only; behavior should already be covered by the migrated suite.

**Tech Stack:** TypeScript, Node test runner, ESLint, project `npm run verify` gate.

**Roadmap:** `docs/superpowers/roadmaps/2026-05-31-agent-session-test-harness-roadmap.md`

**Phase:** Phase 6: Legacy Removal and Final Helper Cleanup

---

## File Structure

- `src/test-helpers/legacy-harness.ts`: delete.
- `src/test-helpers/pi-stub.ts`: delete.
- `src/test-helpers/common.ts`: delete if no external compatibility is needed; otherwise keep as a thin descriptor re-export only.
- `src/test-helpers/index.ts`: final public helper API from `descriptors.ts`, `harness.ts`, and `test-tree.ts`.
- `src/test-helpers/test-tree.ts`: new harness only.
- `src/test-helpers/harness.ts`, `descriptors.ts`, `assertions.ts`, `reactions.ts`, `ui.ts`, `faux-provider.ts`: final ownership cleanup.

### Task 1: Prove there are no remaining legacy consumers

**Files:**
- Inspect: entire repository

- [ ] **Step 1: Search for legacy harness imports**

Run:

```bash
rg "LegacyTestHarness|legacy-harness|PiStub|pi-stub" . --glob '!node_modules'
```

Expected: only `src/test-helpers/index.ts`, `src/test-helpers/legacy-harness.ts`, `src/test-helpers/pi-stub.ts`, and this plan/roadmap mention legacy names. If test files still reference them, stop and finish Phase 5 migration first.

- [ ] **Step 2: Search for direct injection helpers**

Run:

```bash
rg "appendUserMessage|appendAssistantMessage|makeUserMessage|makeAssistantMessage" src
```

Expected: only legacy files mention these names. If active tests or new harness files mention them, replace with `h.prompt(...)` and response descriptors before continuing.

### Task 2: Delete legacy implementation files

**Files:**
- Delete: `src/test-helpers/legacy-harness.ts`
- Delete: `src/test-helpers/pi-stub.ts`
- Modify: `src/test-helpers/index.ts`
- Modify: `src/test-helpers/test-harness.ts` if it still exists

- [ ] **Step 1: Remove legacy files**

Run:

```bash
rm src/test-helpers/legacy-harness.ts src/test-helpers/pi-stub.ts
```

Expected: command exits 0.

- [ ] **Step 2: Remove or repoint `test-harness.ts` shim**

If `src/test-helpers/test-harness.ts` still exists as a compatibility shim, replace it with:

```ts
export { TestHarness } from './harness.js';
```

If no imports use `./test-harness.js`, delete it instead:

```bash
rm src/test-helpers/test-harness.ts
```

Choose deletion only when this command has no output:

```bash
rg "./test-harness\.js|test-helpers/test-harness" src
```

- [ ] **Step 3: Finalize public exports**

Set `src/test-helpers/index.ts` to export only the active helper API:

```ts
export {
  aborts,
  assistant,
  prompt,
  pushTask,
  queuedTask,
  responds,
  task,
  taskResult,
  thinks,
  user,
  userCtrlC,
  userEsc,
  userRunsAuto,
  notification,
  assumeCommandContext,
} from './descriptors.js';

export { TestHarness } from './harness.js';

export { node } from './test-tree.js';
```

Do not export `LegacyTestHarness`.

### Task 3: Remove descriptor compatibility shims if safe

**Files:**
- Delete or modify: `src/test-helpers/common.ts`
- Modify imports in `src/test-helpers/*.ts`

- [ ] **Step 1: Search for common shim consumers**

Run:

```bash
rg "./common\.js|test-helpers/common" src
```

Expected: no output after Phase 5. If only `common.ts` itself appears, delete it:

```bash
rm src/test-helpers/common.ts
```

If one or two active helper files still import it, replace those imports with `./descriptors.js`, then delete `common.ts`.

- [ ] **Step 2: Type-check after deletion**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS. Fix missing imports by pointing to final modules, not by restoring compatibility files.

### Task 4: Tighten final helper module ownership

**Files:**
- Modify: `src/test-helpers/harness.ts`
- Modify: `src/test-helpers/descriptors.ts`
- Modify: `src/test-helpers/reactions.ts`
- Modify: `src/test-helpers/assertions.ts`
- Modify: `src/test-helpers/ui.ts`
- Modify: `src/test-helpers/test-tree.ts`

- [ ] **Step 1: Remove legacy-only types from descriptors**

Delete any type aliases that only existed for `LegacyTestHarness`, such as `LegacyReactionDescriptor` or ambiguous reaction support for `task(...)` as a reaction. Keep only:

```ts
export type AssertionDescriptor = BranchEntry;
export type MatchDescriptor = PromptMatch | AssistantEntry | QueuedTaskMatch;
export type ReactionDescriptor = ControlReactionDescriptor | ResponseDescriptor | ResponseDescriptor[];
```

- [ ] **Step 2: Ensure `test-tree.ts` constructs the new harness only**

Confirm `src/test-helpers/test-tree.ts` imports:

```ts
import { TestHarness } from './harness.js';
```

and disposes it in `finally`:

```ts
const h = await TestHarness.create();
try {
  for (const node of chain) await node.fn?.(h);
} finally {
  h.dispose();
}
```

- [ ] **Step 3: Ensure new harness has no direct injection API**

Run:

```bash
rg "appendUserMessage|appendAssistantMessage" src/test-helpers/harness.ts src/test-helpers/index.ts
```

Expected: no output.

### Task 5: Update tests for final import surface

**Files:**
- Modify: `src/manual.test.ts`
- Modify: `src/auto.test.ts`
- Modify: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Run lint to find unused imports**

Run:

```bash
npm run lint
```

Expected: may FAIL with unused imports after cleanup. Remove unused imports from test files and helper files.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts src/manual.test.ts src/auto.test.ts
```

Expected: PASS.

### Task 6: Final verification and commit

**Files:**
- All files touched in this phase

- [ ] **Step 1: Run required autofix first**

Run:

```bash
npm run fix
```

Expected: PASS.

- [ ] **Step 2: Run full verification gate**

Run:

```bash
npm run verify
```

Expected: PASS, including lint, type-check, tests, updater drift check, and pack dry-run.

- [ ] **Step 3: Confirm cleanup searches are clean**

Run:

```bash
rg "LegacyTestHarness|legacy-harness|PiStub|pi-stub|appendUserMessage|appendAssistantMessage" src
```

Expected: no output.

- [ ] **Step 4: Commit phase 6**

Run:

```bash
git add -A src/test-helpers src/manual.test.ts src/auto.test.ts

git commit -m "test: remove legacy harness"
```

Expected: commit succeeds.

## Inline Plan Review

- **Roadmap coverage:** Covers legacy removal, `pi-stub.ts` deletion, final module organization, direct injection API removal, and full verification.
- **Placeholder scan:** No placeholders remain; each deletion is guarded by exact searches and commands.
- **Type consistency:** Public API exports only active descriptors, `TestHarness`, and `node`.
- **Phase boundary health:** Cleanup happens after all tests are migrated, and `npm run verify` is mandatory before declaring completion.
