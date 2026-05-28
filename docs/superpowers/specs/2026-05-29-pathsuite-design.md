# pathSuite Design

A thin test helper for composing nested `it()` blocks from path trees, tightly coupled to this project's `makeHarness()`.

## API

```ts
interface PathNode {
  name: string;
  fn?: (h: Harness) => Promise<void> | void;
  children: PathNode[];
}

type PathFn = (name: string, fn?: (h: Harness) => Promise<void> | void, ...children: PathNode[]) => PathNode;

function pathSuite(description: string, fn: (path: PathFn) => PathNode | PathNode[]): void;
```

## Usage

```ts
pathSuite('manual workflow', (path) =>
  path('A', async (h) => {
    await doAndCheckA(h)
  },
    path('B', async (h) => {
      await doAndCheckB(h)
    },
      path('C', async (h) => {
        await doAndCheckC(h)
      }),
      path('D', async (h) => {
        await doAndCheckD(h)
      }),
    ),
    path('E', async (h) => {
      await doAndCheckE(h)
    }),
  )
)
```

Generates these `it()` blocks:

- `A`
- `A → B`
- `A → B → C`
- `A → B → D`
- `A → E`

## Behavior

- `pathSuite` creates a `describe(description, ...)` block
- Every `path` node generates an `it()` block — not just leaves
- Each `it()` calls `makeHarness()` once to create a fresh harness instance
- All ancestor `fn`s run from root to self, receiving the same harness
- `fn` is optional for grouping-only nodes
- Children are passed as rest args after the callback, not nested inside it
- Test names are path names joined with ` → `
- All `fn` calls are awaited (async support)

## Placement

Defined directly in `index.test.ts`, above the existing tests. No separate file.