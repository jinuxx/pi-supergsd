# Path Builder Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `pathSuite(...)` test helper with a fluent `path(...).children(...).run()` API.

**Architecture:** `path()` becomes a pure builder that returns a `PathNode` with `.children()` and `.run()` methods. `.run()` is the explicit registration boundary, so the helper does not need microtasks, root detection, or child-claim bookkeeping. The existing traversal behavior moves into private implementation inside `src/test-helpers/path-suite.ts`.

**Tech Stack:** TypeScript, ES modules, Node built-in test runner, existing `TestHarness` test helper.

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File Structure

- Modify `src/test-helpers/path-suite.ts`
  - Remove exported `pathSuite`.
  - Keep exporting `path`, `PathFn`, and `PathNode`.
  - Add a builder implementation that stores child paths and registers tests when `.run()` is called.
- Modify `src/test-helpers/index.ts`
  - Stop exporting `pathSuite`.
  - Keep exporting `path` and path-related types.
- Modify `src/manual.test.ts`
  - Remove `pathSuite` from imports.
  - Convert top-level `pathSuite(path(...), path(...))` usage to separate top-level `path(...).children(...).run()` calls.
  - Convert nested variadic child arguments to `.children(...)` calls.

---

## Design Details

### Current API

```ts
pathSuite(
  path('AAA', async h => {
    // step
  },
    path('discard AAA', async h => {
      // child step
    }),
    path('start AAA', async h => {
      // child step
    }),
  ),
);
```

### Target API

```ts
path('AAA', async h => {
  // step
}).children(
  path('discard AAA', async h => {
    // child step
  }),
  path('start AAA', async h => {
    // child step
  }),
).run();
```

### Behavior to preserve

For every path node, registration should create one `node:test` test whose name is the full path chain joined by ` → `.

For example:

```ts
path('AAA', aaa).children(
  path('start AAA', startAaa).children(
    path('finish AAA', finishAaa),
  ),
).run();
```

registers tests named:

- `AAA`
- `AAA → start AAA`
- `AAA → start AAA → finish AAA`

Each registered test creates a fresh `TestHarness` and runs every step in the chain in order.

---

## Tasks

### Task 1: Refactor `path-suite.ts` to a builder API

**Files:**
- Modify: `src/test-helpers/path-suite.ts`

- [ ] **Step 1: Replace the explicit `pathSuite` API with a fluent builder**

Replace the file contents with:

```ts
import { it } from 'node:test';

import { TestHarness } from './test-harness.js';

type PathStep = (h: TestHarness) => Promise<void> | void;

export const path: PathFn = (name, fn) => new PathBuilder(name, fn);

export type PathFn = (name: string, fn?: PathStep) => PathNode;

export interface PathNode {
  children(...children: PathNode[]): PathNode;
  run(): void;
}

class PathBuilder implements PathNode {
  private readonly childPaths: PathBuilder[] = [];
  private registered = false;

  constructor(
    private readonly name: string,
    private readonly fn?: PathStep,
  ) {}

  children(...children: PathNode[]): PathNode {
    this.childPaths.push(...children.map(asPathBuilder));
    return this;
  }

  run(): void {
    this.register([]);
  }

  private register(ancestors: PathBuilder[]): void {
    if (this.registered) {
      throw new Error(`Path "${this.name}" has already been registered`);
    }

    this.registered = true;

    const chain = [...ancestors, this];
    const name = chain.map(node => node.name).join(' → ');

    it(name, async () => {
      const h = new TestHarness();

      for (const node of chain) {
        await node.fn?.(h);
      }
    });

    for (const child of this.childPaths) {
      child.register(chain);
    }
  }
}

function asPathBuilder(node: PathNode): PathBuilder {
  if (!(node instanceof PathBuilder)) {
    throw new TypeError('path().children() only accepts nodes returned by path()');
  }

  return node;
}
```

- [ ] **Step 2: Run TypeScript on the helper only through the project typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: this may fail because `index.ts` and `manual.test.ts` still import or use `pathSuite`. Continue to Task 2 and Task 3 before treating the typecheck as a final signal.

---

### Task 2: Remove `pathSuite` from test helper exports

**Files:**
- Modify: `src/test-helpers/index.ts`

- [ ] **Step 1: Update the value export**

Change:

```ts
export { path, pathSuite } from './path-suite.js';
```

to:

```ts
export { path } from './path-suite.js';
```

Keep the existing type export:

```ts
export type { PathNode, PathFn } from './path-suite.js';
```

- [ ] **Step 2: Run a focused search for remaining `pathSuite` references**

Run:

```bash
rg "pathSuite" src
```

Expected: only `src/manual.test.ts` should still reference `pathSuite` at this point.

---

### Task 3: Convert `manual.test.ts` to `.children(...).run()`

**Files:**
- Modify: `src/manual.test.ts`

- [ ] **Step 1: Remove `pathSuite` from the import**

Change:

```ts
import {
  assistant,
  notification,
  path,
  pathSuite,
  task,
  taskResult,
  user,
} from './test-helpers/index.js';
```

to:

```ts
import {
  assistant,
  notification,
  path,
  task,
  taskResult,
  user,
} from './test-helpers/index.js';
```

- [ ] **Step 2: Convert the outer suite wrapper**

Inside:

```ts
describe('manual workflow', () => {
  pathSuite(
    // roots
  );
});
```

remove `pathSuite(` and its closing `);`. Each root-level `path(...)` expression must become its own statement ending in `.run();`.

- [ ] **Step 3: Convert each path with children**

For every current nested form:

```ts
path('name', async h => {
  // body
},
  path('child one', async h => {
    // body
  }),
  path('child two', async h => {
    // body
  }),
)
```

convert to:

```ts
path('name', async h => {
  // body
}).children(
  path('child one', async h => {
    // body
  }),
  path('child two', async h => {
    // body
  }),
)
```

For root nodes, add `.run()` after the final `.children(...)` or directly after `path(...)` when the root has no children:

```ts
path('start [no task]', async h => {
  // body
}).run();
```

- [ ] **Step 4: Format with ESLint autofix**

Run:

```bash
npm run fix
```

Expected: ESLint formats the converted fluent chains and reports no remaining lint errors.

---

### Task 4: Verify behavior with focused tests

**Files:**
- Test: `src/manual.test.ts`

- [ ] **Step 1: Run the manual workflow test file**

Run:

```bash
npx tsx --test src/manual.test.ts
```

Expected: all manual workflow tests pass. Test names should still contain the same ` → ` path chains as before.

- [ ] **Step 2: Search for removed API usage**

Run:

```bash
rg "pathSuite" src
```

Expected: no matches.

---

### Task 5: Run full project verification

**Files:**
- All touched files

- [ ] **Step 1: Run the required autofix command first**

Run:

```bash
npm run fix
```

Expected: command succeeds.

- [ ] **Step 2: Run the full gate**

Run:

```bash
npm run verify
```

Expected: lint, typecheck, tests, updater drift check, and pack dry-run all pass.

---

### Task 6: Commit the change

**Files:**
- Modify: `src/test-helpers/path-suite.ts`
- Modify: `src/test-helpers/index.ts`
- Modify: `src/manual.test.ts`

- [ ] **Step 1: Review the diff**

Run:

```bash
git diff -- src/test-helpers/path-suite.ts src/test-helpers/index.ts src/manual.test.ts
```

Expected: diff only contains the helper API change and the manual test migration.

- [ ] **Step 2: Commit**

Run:

```bash
git add src/test-helpers/path-suite.ts src/test-helpers/index.ts src/manual.test.ts docs/superpowers/plans/2026-05-30-path-builder-run.md
git commit -m "test: fold pathSuite into path builder"
```

Expected: commit succeeds.
