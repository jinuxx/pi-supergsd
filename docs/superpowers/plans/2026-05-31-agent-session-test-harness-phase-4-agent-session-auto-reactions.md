# AgentSession Test Harness Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `runAuto()` work on the new AgentSession-backed harness with descriptor-driven provider responses and control reactions.

**Architecture:** Extract reaction matching into `reactions.ts`, drive responses by queueing faux provider descriptors when matching real prompts or pending task entries, and keep deterministic wait loops around real `session.agent.waitForIdle()` plus command execution. Legacy auto support remains untouched for unmigrated tests.

**Tech Stack:** TypeScript, Pi `AgentSession`, SuperGSD `/auto` command, faux provider queue, Node test runner.

**Roadmap:** `docs/superpowers/roadmaps/2026-05-31-agent-session-test-harness-roadmap.md`

**Phase:** Phase 4: AgentSession-Backed Auto Reactions

---

## File Structure

- `src/test-helpers/reactions.ts`: real-session reaction scanner, match logic, and control reaction execution.
- `src/test-helpers/descriptors.ts`: update `AutoConfig` and `ReactionDescriptor` so reactions can contain multiple response descriptors.
- `src/test-helpers/harness.ts`: implement `runAuto()`, cancellation flag, shutdown trigger, and shared auto handler for the new harness.
- `src/test-helpers/harness.test.ts`: representative new-harness auto tests.
- `src/test-helpers/legacy-harness.ts`: unchanged fallback.

### Task 1: Update reaction descriptor typing

**Files:**
- Modify: `src/test-helpers/descriptors.ts`
- Modify: `src/test-helpers/common.ts`

- [ ] **Step 1: Replace legacy reaction tuple type with response arrays**

In `src/test-helpers/descriptors.ts`, define:

```ts
export interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor | ResponseDescriptor | ResponseDescriptor[]]>;
}

export type ControlReactionDescriptor =
  | { type: 'user-esc' }
  | { type: 'user-ctrl-c' }
  | { type: 'user-runs-auto' };

export type ReactionDescriptor = ControlReactionDescriptor | ResponseDescriptor | ResponseDescriptor[];
```

Keep legacy compatibility by allowing old `assistant(...)`, `user(...)`, and `task(...)` only in `legacy-harness.ts` local types if TypeScript requires it. Do not weaken the new exported reaction types back to ambiguous `task` reactions.

- [ ] **Step 2: Type-check descriptor consumers**

Run:

```bash
npx tsc --noEmit
```

Expected: any failures point to legacy-harness reaction types. Fix by importing old aliases locally in `legacy-harness.ts` or defining `type LegacyReactionDescriptor = UserEntry | AssistantEntry | TaskEntry | ControlReactionDescriptor` there.

### Task 2: Implement reaction matcher utilities

**Files:**
- Create: `src/test-helpers/reactions.ts`

- [ ] **Step 1: Create matcher helpers**

Create `src/test-helpers/reactions.ts`:

```ts
import type { SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';

import { extractTextContent } from '../text-content.js';
import type { MatchDescriptor, ReactionDescriptor, ResponseDescriptor } from './descriptors.js';

export interface ReactionRuntime {
  enqueueResponses(responses: ResponseDescriptor[]): void;
  cancelNextNavigation(): void;
  triggerShutdown(): void;
  runAutoAgain(): void;
}

export function scanAndReact(
  sessionManager: SessionManager,
  reactions: Array<[MatchDescriptor, ReactionDescriptor | ResponseDescriptor | ResponseDescriptor[]]>,
  seenIds: Set<string>,
  runtime: ReactionRuntime,
): boolean {
  let reacted = false;
  for (const entry of sessionManager.getBranch()) {
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    for (const [match, reaction] of reactions) {
      if (!entryMatches(entry, match)) continue;
      applyReaction(reaction, runtime);
      reacted = true;
      break;
    }
  }
  return reacted;
}
```

- [ ] **Step 2: Add `entryMatches()`**

Append:

```ts
function entryMatches(entry: SessionEntry, match: MatchDescriptor): boolean {
  if (match.type === 'match:prompt') {
    if (entry.type !== 'message' || entry.message.role !== 'user') return false;
    return extractTextContent(entry.message.content, '').includes(match.text);
  }

  if (match.type === 'match:queued-task') {
    if (entry.type !== 'custom' || entry.customType !== 'task') return false;
    const data = readTaskData(entry.data);
    return data !== null
      && data.prompt.includes(match.prompt)
      && data.inherit_context === match.inherit_context;
  }

  if (match.type === 'message') {
    if (entry.type !== 'message') return false;
    if (entry.message.role !== match.message.role) return false;
    return extractTextContent(entry.message.content, '').includes(extractTextContent(match.message.content, ''));
  }

  return false;
}

function readTaskData(data: unknown): { prompt: string; inherit_context: boolean } | null {
  if (!isRecord(data)) return null;
  if (typeof data.prompt !== 'string' || typeof data.inherit_context !== 'boolean') return null;
  return { prompt: data.prompt, inherit_context: data.inherit_context };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
```

- [ ] **Step 3: Add `applyReaction()`**

Append:

```ts
function applyReaction(
  reaction: ReactionDescriptor | ResponseDescriptor | ResponseDescriptor[],
  runtime: ReactionRuntime,
): void {
  const reactions = Array.isArray(reaction) ? reaction : [reaction];

  for (const item of reactions) {
    switch (item.type) {
      case 'user-esc':
        runtime.cancelNextNavigation();
        break;
      case 'user-ctrl-c':
        runtime.triggerShutdown();
        break;
      case 'user-runs-auto':
        runtime.runAutoAgain();
        break;
      default:
        runtime.enqueueResponses([item]);
        break;
    }
  }
}
```

### Task 3: Wire new harness `runAuto()` to real `/auto`

**Files:**
- Modify: `src/test-helpers/harness.ts`

- [ ] **Step 1: Add state fields**

Add to `TestHarness`:

```ts
private cancelNextNav = false;
private readonly autoHandler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
```

Initialize `autoHandler` from the registered `/auto` command in `create()` after extension binding. If Pi exposes commands through the extension runner, use that. If not, import `cmdAuto` and pass a small adapter that delegates to the same `session` APIs:

```ts
const autoHandler = cmdAuto(harness.extensionApiAdapter()).handler;
```

The adapter must implement `appendEntry`, `sendMessage`, `sendUserMessage`, and `on('session_shutdown', ...)` by delegating to `sessionManager`, `session.sendCustomMessage`, `session.sendUserMessage`, and a local shutdown handler list.

- [ ] **Step 2: Add navigation cancellation in command actions**

In `commandContextActions().navigateTree`, check the one-shot flag:

```ts
if (this.cancelNextNav) {
  this.cancelNextNav = false;
  return { cancelled: true };
}
return this.session.navigateTree(targetId, options);
```

- [ ] **Step 3: Implement `runAuto()`**

Add:

```ts
async runAuto(config: AutoConfig): Promise<void> {
  const reactions = config.reactions ?? [];
  const seenIds = new Set<string>();
  let settled = false;
  const runtime = {
    enqueueResponses: (responses: ResponseDescriptor[]) => this.fauxResponses.enqueue(...responses),
    cancelNextNavigation: () => { this.cancelNextNav = true; },
    triggerShutdown: () => { this.triggerSessionShutdown(); },
    runAutoAgain: () => { this.autoHandler('', this.commandContext()).catch(() => {}); },
  };

  const promise = this.autoHandler('', this.commandContext()).finally(() => {
    settled = true;
  });

  for (let step = 0; step < 100 && !settled; step++) {
    let reacted: boolean;
    do {
      reacted = scanAndReact(this.sessionManager, reactions, seenIds, runtime);
      await flushMicrotasks();
    } while (reacted);
    await this.session.agent.waitForIdle();
    await flushMicrotasks();
  }

  if (!settled) throw new Error('runAuto did not complete within step cap');
  await promise;
  this.assertNoQueuedResponses('runAuto');
}
```

Add `flushMicrotasks()` local helper as in the legacy harness.

### Task 4: Add representative auto tests on the new harness

**Files:**
- Modify: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Test normal auto task completion**

Add:

```ts
import { prompt, queuedTask, responds } from './index.js';

it('runs /auto with a prompt reaction and attaches the branch result', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('main work', responds('working...'));
    await h.runPushTask('Analyze performance.');
    await h.runAuto({
      reactions: [[prompt('Analyze performance.'), responds('Found 3 bottlenecks: ...')]],
    });
    h.assertSessionContains(taskResult('analyze-performance', 'Found 3 bottlenecks: ...'));
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 2: Test queued task navigation cancellation**

Add:

```ts
it('cancels navigation before sending a queued task prompt', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('main work', responds('working...'));
    await h.runPushTask('Cancel before navigation.');
    await h.runAuto({ reactions: [[queuedTask('Cancel before navigation.'), userEsc()]] });
    h.assertSessionContains(task('Cancel before navigation.'));
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 3: Test nested auto and shutdown controls**

Add tests mirroring the legacy cases:

```ts
it('warns when auto is invoked while already running', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('start', responds('ready'));
    await h.runPushTask('first task', true);
    await h.runAuto({
      reactions: [
        [prompt('first task'), responds('done')],
        [assistant('done'), userRunsAuto()],
      ],
    });
    h.assertNotifications('Auto is already running.');
  } finally {
    h.dispose();
  }
});

it('stops when session shutdown fires during auto', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('start', responds('ready'));
    await h.runPushTask('Shutdown task', true);
    await h.runAuto({
      reactions: [
        [prompt('Shutdown task'), responds('working...')],
        [assistant('working...'), userCtrlC()],
      ],
    });
    h.assertSessionContains(user('Shutdown task'), assistant('working...'));
  } finally {
    h.dispose();
  }
});
```

### Task 5: Verify and commit

**Files:**
- All files touched in this phase

- [ ] **Step 1: Run focused and full tests**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts
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

- [ ] **Step 3: Commit**

Run:

```bash
git add src/test-helpers

git commit -m "test: drive auto reactions through AgentSession"
```

Expected: commit succeeds.

## Inline Plan Review

- **Roadmap coverage:** Covers prompt matches, queued task matches, response queueing, navigation cancellation, shutdown, and nested auto behavior. Excludes broad migration and legacy removal.
- **Placeholder scan:** The only API-dependent branch is explicit about using registered commands when exposed or the same `cmdAuto` adapter used by production code; final code must type-check.
- **Type consistency:** `prompt(...)` is the match descriptor, `queuedTask(...)` is pre-navigation matching, and response descriptors are queued into the faux provider.
- **Phase boundary health:** Representative auto tests run on the new harness while old tests remain legacy-backed, keeping the suite green.
