# AgentSession Test Harness Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `TestHarness` that owns a real Pi `AgentSession`, registers the SuperGSD extension normally, and supports basic command/tool smoke tests while the legacy suite remains green.

**Architecture:** Keep `LegacyTestHarness` untouched and introduce `src/test-helpers/harness.ts` as the new runtime. The new harness uses `createAgentSession()` with an in-memory session manager, an in-memory settings manager, a resource loader with the package extension factory, and `session.bindExtensions()` for UI and command-context actions.

**Tech Stack:** TypeScript ES modules, Pi SDK (`createAgentSession`, `DefaultResourceLoader`, `SessionManager`, `SettingsManager`, `AuthStorage`, `ModelRegistry`), Node test runner.

**Roadmap:** `docs/superpowers/roadmaps/2026-05-31-agent-session-test-harness-roadmap.md`

**Phase:** Phase 2: AgentSession Harness Foundation

---

## File Structure

- `src/test-helpers/ui.ts`: focused UI capture object for notifications, task status, and a plain test theme.
- `src/test-helpers/assertions.ts`: visible-session projection helpers shared by the new harness; initially enough for task/custom-message and notification assertions.
- `src/test-helpers/harness.ts`: new AgentSession-backed `TestHarness` class with lifecycle setup, extension binding, command/tool wrappers, and smoke-only assertions.
- `src/test-helpers/index.ts`: exports both new `TestHarness` and `LegacyTestHarness`.
- `src/test-helpers/test-tree.ts`: remains on `LegacyTestHarness` in this phase to avoid migrating node-based tests.
- `src/test-helpers/harness.test.ts`: new focused smoke tests for the new harness.

### Task 1: Add UI capture helper

**Files:**
- Create: `src/test-helpers/ui.ts`

- [ ] **Step 1: Write `TestUI`**

Create `src/test-helpers/ui.ts`:

```ts
import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent';

export class TestUI {
  private readonly notificationLog: string[] = [];
  private readonly taskStatusHistory: Array<string | undefined> = [];
  private taskStatus: string | undefined;

  readonly theme = {
    fg: (_key: string, text: string) => text,
    bg: (_key: string, text: string) => text,
    bold: (text: string) => text,
  } satisfies Pick<Theme, 'fg' | 'bg' | 'bold'>;

  readonly context: ExtensionUIContext = {
    notify: (message: string) => {
      this.notificationLog.push(message);
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== 'task') return;
      this.taskStatus = value;
      this.taskStatusHistory.push(value);
    },
    theme: this.theme,
  } as ExtensionUIContext;

  getStatus(): string | undefined {
    return this.taskStatus;
  }

  notifications(): readonly string[] {
    return this.notificationLog;
  }

  taskStatuses(): readonly Array<string | undefined> {
    return this.taskStatusHistory;
  }
}
```

- [ ] **Step 2: Type-check the helper**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS or unrelated errors from later uncreated files should not exist yet.

### Task 2: Add visible assertion helpers for real session entries

**Files:**
- Create: `src/test-helpers/assertions.ts`
- Modify: `src/test-helpers/harness.ts` later in this phase

- [ ] **Step 1: Create projection helpers**

Create `src/test-helpers/assertions.ts`:

```ts
import assert from 'node:assert';

import type { SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';

import { extractTextContent } from '../text-content.js';
import type { BranchEntry } from './descriptors.js';

export function assertBranchHistory(
  sessionManager: SessionManager,
  expected: BranchEntry[],
): void {
  const actual = sessionManager.getBranch()
    .map(stripVisibleEntry)
    .filter((entry): entry is BranchEntry => entry !== null);

  assert.deepStrictEqual(actual, expected);
}

export function assertSessionContains(
  sessionManager: SessionManager,
  expected: BranchEntry[],
): void {
  const actual = sessionManager.getEntries()
    .map(stripVisibleEntry)
    .filter((entry): entry is BranchEntry => entry !== null);

  for (const expectedEntry of expected) {
    assert.ok(
      actual.some(entry => entriesEqual(entry, expectedEntry)),
      `Expected session to contain entry: ${JSON.stringify(expectedEntry)}`,
    );
  }
}

function stripVisibleEntry(entry: SessionEntry): BranchEntry | null {
  if (isHiddenEntry(entry)) return null;

  if (entry.type === 'message') {
    if (entry.message.role === 'user') {
      return {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: extractTextContent(entry.message.content, '') }] },
      };
    }

    if (entry.message.role === 'assistant') {
      return {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: extractTextContent(entry.message.content, '') }],
          ...(entry.message.stopReason && entry.message.stopReason !== 'stop'
            ? { stopReason: entry.message.stopReason }
            : {}),
        },
      };
    }

    return null;
  }

  if (entry.type === 'custom') {
    if (entry.customType !== 'task') return null;
    const data = readTaskData(entry.data);
    return data ? { type: 'custom', customType: 'task', data } : null;
  }

  if (entry.type === 'custom_message') {
    if (entry.customType !== 'task-result') return null;
    const slug = readTaskResultSlug(entry.details);
    if (!slug) return null;
    const text = extractTextContent(entry.content, '');
    return {
      type: 'custom_message',
      customType: 'task-result',
      details: { slug },
      ...(text !== '' ? { content: [{ type: 'text', text }] } : {}),
    };
  }

  return null;
}

function isHiddenEntry(entry: SessionEntry): boolean {
  switch (entry.type) {
    case 'thinking_level_change':
    case 'model_change':
    case 'session_info':
    case 'label':
      return true;
    case 'custom':
      return entry.customType === 'task-done' || entry.customType === 'task-start';
    default:
      return false;
  }
}

function readTaskData(data: unknown): { prompt: string; inherit_context: boolean } | null {
  if (!isRecord(data)) return null;
  if (typeof data.prompt !== 'string' || typeof data.inherit_context !== 'boolean') return null;
  return { prompt: data.prompt, inherit_context: data.inherit_context };
}

function readTaskResultSlug(details: unknown): string | null {
  return isRecord(details) && typeof details.slug === 'string' ? details.slug : null;
}

function entriesEqual(actual: BranchEntry, expected: BranchEntry): boolean {
  try {
    assert.deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
```

- [ ] **Step 2: Run type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS after fixing any `extractTextContent` signature mismatch by checking `src/text-content.ts` and using its exported function exactly.

### Task 3: Implement AgentSession-backed harness foundation

**Files:**
- Create: `src/test-helpers/harness.ts`

- [ ] **Step 1: Add the harness skeleton**

Create `src/test-helpers/harness.ts`:

```ts
import assert from 'node:assert';

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';

import registerSuperGsd from '../../index.js';
import { assertBranchHistory, assertSessionContains } from './assertions.js';
import type { BranchEntry } from './descriptors.js';
import { TestUI } from './ui.js';

export class TestHarness {
  private constructor(
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly ui: TestUI,
  ) {}

  static async create(): Promise<TestHarness> {
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const sessionManager = SessionManager.inMemory(cwd);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [registerSuperGsd],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager,
      noTools: 'builtin',
    });

    const ui = new TestUI();
    const harness = new TestHarness(session, sessionManager, ui);
    await session.bindExtensions({
      uiContext: ui.context,
      commandContextActions: harness.commandContextActions(),
      shutdownHandler: () => {},
    });
    return harness;
  }

  dispose(): void {
    this.session.dispose();
  }

  getStatus(): string | undefined {
    return this.ui.getStatus();
  }

  assertBranchHistory(...expected: BranchEntry[]): void {
    assertBranchHistory(this.sessionManager, expected);
  }

  assertSessionContains(...expected: BranchEntry[]): void {
    assertSessionContains(this.sessionManager, expected);
  }

  assertNotifications(...expected: string[]): void {
    for (const text of expected) {
      assert.ok(this.ui.notifications().includes(text), `Expected notification log to include: ${text}`);
    }
  }

  assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      this.ui.taskStatuses().includes(expected),
      `Expected task status history to include ${JSON.stringify(expected)}`,
    );
  }

  async waitForIdle(): Promise<void> {
    await this.session.agent.waitForIdle();
  }

  registeredToolNames(): string[] {
    return this.session.getAllTools().map(tool => tool.name).sort();
  }

  private commandContextActions() {
    return {
      waitForIdle: async () => {
        await this.session.agent.waitForIdle();
      },
      navigateTree: async (targetId: string, options?: Parameters<AgentSession['navigateTree']>[1]) => {
        return this.session.navigateTree(targetId, options);
      },
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      reload: async () => {
        await this.session.reload();
      },
    };
  }
}
```

- [ ] **Step 2: Verify the foundation with TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS. Keep this phase limited to public `AgentSession` APIs; command execution is verified later through the `/auto` harness work.

### Task 4: Export the new harness without moving existing tests

**Files:**
- Modify: `src/test-helpers/index.ts`
- Modify: `src/test-helpers/test-tree.ts`

- [ ] **Step 1: Export both harnesses**

Update `src/test-helpers/index.ts`:

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

export { TestHarness } from './harness.js';
export { LegacyTestHarness } from './legacy-harness.js';

export { node } from './test-tree.js';
```

- [ ] **Step 2: Keep `test-tree.ts` on legacy**

Update `src/test-helpers/test-tree.ts` to import legacy explicitly:

```ts
import { LegacyTestHarness } from './legacy-harness.js';
```

and set:

```ts
type NodeFn = (h: LegacyTestHarness) => Promise<void> | void;
```

and instantiate:

```ts
const h = new LegacyTestHarness();
```

### Task 5: Add smoke tests for the new harness foundation

**Files:**
- Create: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Add construction and tool-registration smoke tests**

Create `src/test-helpers/harness.test.ts`:

```ts
import { describe, it } from 'node:test';

import assert from 'node:assert';

import { TestHarness } from './index.js';

describe('AgentSession-backed TestHarness foundation', () => {
  it('creates a real session and registers push-task through the extension', async () => {
    const h = await TestHarness.create();
    try {
      assert.ok(h.registeredToolNames().includes('push-task'));
      assert.strictEqual(h.getStatus(), undefined);
    } finally {
      h.dispose();
    }
  });
});
```

- [ ] **Step 2: Run the focused smoke test**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts
```

Expected: PASS. This phase only proves the new AgentSession can load the package extension and expose its tool definition; prompt-driven tool execution is covered in Phase 3.

### Task 6: Verify the phase boundary

**Files:**
- All helper files touched in this phase

- [ ] **Step 1: Run full type-check and tests**

Run:

```bash
npx tsc --noEmit
npm test
```

Expected: PASS. Existing manual/auto tests must still pass through `LegacyTestHarness`.

- [ ] **Step 2: Run required autofix**

Run:

```bash
npm run fix
```

Expected: PASS. Inspect any changes.

- [ ] **Step 3: Commit phase 2**

Run:

```bash
git add src/test-helpers

git commit -m "test: add AgentSession harness foundation"
```

Expected: commit succeeds.

## Inline Plan Review

- **Roadmap coverage:** Covers new AgentSession harness foundation, extension registration, UI capture, and registered tool smoke testing. Excludes prompt response descriptors, auto reactions, broad migration, and cleanup.
- **Placeholder scan:** No placeholders remain; API-dependent command execution is intentionally deferred to Phase 4 where the `/auto` adapter is planned.
- **Type consistency:** `TestHarness.create()` is async; `LegacyTestHarness` remains synchronous for existing tests.
- **Phase boundary health:** Existing tests remain legacy-backed, and the new smoke test proves the new harness can load the extension without destabilizing the suite.
