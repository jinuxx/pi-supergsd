# AgentSession Test Harness Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let new-harness tests create conversation state through real `AgentSession` prompts and deterministic faux provider responses.

**Architecture:** Add typed response and match descriptors, a faux provider queue that implements Pi's `streamSimple` protocol, and `h.prompt()` as the only new-harness way to create user/assistant turns. The faux provider is registered through `pi.registerProvider()` from a test-only inline extension so AgentSession uses normal provider plumbing.

**Tech Stack:** TypeScript, Pi SDK `registerProvider` custom `streamSimple`, `@earendil-works/pi-ai` `createAssistantMessageEventStream`, Node test runner.

**Roadmap:** `docs/superpowers/roadmaps/2026-05-31-agent-session-test-harness-roadmap.md`

**Phase:** Phase 3: Faux Provider and Prompt Response Descriptors

---

## File Structure

- `src/test-helpers/descriptors.ts`: add `prompt`, `queuedTask`, `responds`, `thinks`, `aborts`, and `pushTask` descriptors plus separate `AssertionDescriptor`, `MatchDescriptor`, and `ResponseDescriptor` types.
- `src/test-helpers/faux-provider.ts`: queue-backed custom provider stream implementation.
- `src/test-helpers/harness.ts`: registers faux provider, selects faux model, implements `prompt()`, and checks unused descriptors.
- `src/test-helpers/harness.test.ts`: focused prompt/provider tests.
- `src/test-helpers/index.ts`: exports new descriptor builders.

### Task 1: Add descriptor types and builders

**Files:**
- Modify: `src/test-helpers/descriptors.ts`
- Modify: `src/test-helpers/index.ts`

- [ ] **Step 1: Add explicit descriptor unions**

Add these exported types to `src/test-helpers/descriptors.ts` after existing entry types:

```ts
export type AssertionDescriptor = BranchEntry;
export type MatchDescriptor = PromptMatch | AssistantEntry | QueuedTaskMatch;
export type ResponseDescriptor = RespondsDescriptor | ThinksDescriptor | AbortsDescriptor | PushTaskDescriptor;

export type PromptMatch = { type: 'match:prompt'; text: string };
export type QueuedTaskMatch = {
  type: 'match:queued-task';
  prompt: string;
  inherit_context: boolean;
};
export type RespondsDescriptor = { type: 'response:text'; text: string };
export type ThinksDescriptor = { type: 'response:thinking'; text: string };
export type AbortsDescriptor = { type: 'response:aborted'; text: string };
export type PushTaskDescriptor = {
  type: 'response:push-task';
  prompt: string;
  inherit_context: boolean;
};
```

- [ ] **Step 2: Add builder functions**

Add:

```ts
const prompt = (text: string): PromptMatch => ({ type: 'match:prompt', text });

const queuedTask = (prompt: string, inherit_context = false): QueuedTaskMatch => ({
  type: 'match:queued-task',
  prompt,
  inherit_context,
});

const responds = (text: string): RespondsDescriptor => ({ type: 'response:text', text });

const thinks = (text: string): ThinksDescriptor => ({ type: 'response:thinking', text });

const aborts = (text: string): AbortsDescriptor => ({ type: 'response:aborted', text });

const pushTask = (prompt: string, inherit_context = false): PushTaskDescriptor => ({
  type: 'response:push-task',
  prompt,
  inherit_context,
});
```

Add these names to the existing export block.

- [ ] **Step 3: Re-export new builders**

Update `src/test-helpers/index.ts` and `src/test-helpers/common.ts` to re-export `prompt`, `queuedTask`, `responds`, `thinks`, `aborts`, and `pushTask`.

- [ ] **Step 4: Type-check descriptors**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS. Fix duplicate `MatchDescriptor`/`ReactionDescriptor` names by making legacy reaction descriptors import the new union only where needed.

### Task 2: Implement faux provider response queue

**Files:**
- Create: `src/test-helpers/faux-provider.ts`

- [ ] **Step 1: Add stream helpers and usage constants**

Create `src/test-helpers/faux-provider.ts`:

```ts
import type { AssistantMessage, Context, Model, TextContent, ToolCall } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

import type { ResponseDescriptor } from './descriptors.js';

const TEST_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const FAUX_PROVIDER = 'supergsd-test';
export const FAUX_MODEL_ID = 'deterministic';

export const FAUX_MODEL = {
  id: FAUX_MODEL_ID,
  name: 'Deterministic Test Model',
  api: 'supergsd-test-api',
  provider: FAUX_PROVIDER,
  baseUrl: 'memory://supergsd-test',
  reasoning: true,
  thinkingLevelMap: { off: null, low: 'low', medium: 'medium', high: 'high' },
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 4096,
} satisfies Model<any>;
```

- [ ] **Step 2: Add queue class**

Append:

```ts
export class FauxResponseQueue {
  private readonly queued: ResponseDescriptor[] = [];
  private callCount = 0;
  private readonly seenPrompts: string[] = [];

  enqueue(...responses: ResponseDescriptor[]): void {
    this.queued.push(...responses);
  }

  remaining(): readonly ResponseDescriptor[] {
    return this.queued;
  }

  prompts(): readonly string[] {
    return this.seenPrompts;
  }

  stream = (_model: Model<any>, context: Context) => {
    const stream = createAssistantMessageEventStream();
    const descriptor = this.queued.shift();
    const lastUser = [...context.messages].reverse().find(message => message.role === 'user');
    if (lastUser) this.seenPrompts.push(readUserText(lastUser.content));

    queueMicrotask(() => {
      if (!descriptor) {
        const error = makeAssistantMessage([], 'error', `No faux response queued for provider call ${this.callCount + 1}`);
        stream.push({ type: 'error', reason: 'error', error });
        stream.end(error);
        return;
      }

      this.callCount++;
      emitDescriptor(stream, descriptor, this.callCount);
    });

    return stream;
  };
}

function readUserText(content: string | TextContent[]): string {
  if (typeof content === 'string') return content;
  return content.filter((block): block is TextContent => block.type === 'text').map(block => block.text).join('\n');
}
```

- [ ] **Step 3: Convert descriptors into assistant events**

Append:

```ts
function emitDescriptor(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  descriptor: ResponseDescriptor,
  callNumber: number,
): void {
  if (descriptor.type === 'response:text') {
    const block: TextContent = { type: 'text', text: descriptor.text };
    const message = makeAssistantMessage([block], 'stop');
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'text_start', contentIndex: 0, partial: message });
    stream.push({ type: 'text_delta', contentIndex: 0, delta: descriptor.text, partial: message });
    stream.push({ type: 'text_end', contentIndex: 0, content: descriptor.text, partial: message });
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    return;
  }

  if (descriptor.type === 'response:thinking') {
    const message = makeAssistantMessage([{ type: 'thinking', thinking: descriptor.text }], 'stop');
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'thinking_start', contentIndex: 0, partial: message });
    stream.push({ type: 'thinking_delta', contentIndex: 0, delta: descriptor.text, partial: message });
    stream.push({ type: 'thinking_end', contentIndex: 0, content: descriptor.text, partial: message });
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    return;
  }

  if (descriptor.type === 'response:aborted') {
    const message = makeAssistantMessage([{ type: 'text', text: descriptor.text }], 'aborted', 'Aborted by test descriptor');
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'error', reason: 'aborted', error: message });
    stream.end(message);
    return;
  }

  const toolCall: ToolCall = {
    type: 'toolCall',
    id: `call-${callNumber}`,
    name: 'push-task',
    arguments: { prompt: descriptor.prompt, inherit_context: descriptor.inherit_context },
  };
  const message = makeAssistantMessage([toolCall], 'toolUse');
  stream.push({ type: 'start', partial: message });
  stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
  stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
  stream.push({ type: 'done', reason: 'toolUse', message });
  stream.end(message);
}

function makeAssistantMessage(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: FAUX_MODEL.api,
    provider: FAUX_PROVIDER,
    model: FAUX_MODEL_ID,
    usage: TEST_USAGE,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}
```

- [ ] **Step 4: Run type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS. If `createAssistantMessageEventStream` is not exported at top level, import it from `@earendil-works/pi-ai/dist/utils/event-stream.js` only if package exports allow it; otherwise use `AssistantMessageEventStream` from the public `@earendil-works/pi-ai` export shown by TypeScript.

### Task 3: Register faux provider in the new harness

**Files:**
- Modify: `src/test-helpers/harness.ts`

- [ ] **Step 1: Add faux provider queue field**

In `TestHarness`, add:

```ts
private readonly fauxResponses: FauxResponseQueue;
```

and import:

```ts
import { FAUX_MODEL, FAUX_PROVIDER, FauxResponseQueue } from './faux-provider.js';
```

- [ ] **Step 2: Register the provider through an inline extension factory**

Inside `TestHarness.create()`, create the queue before `DefaultResourceLoader`:

```ts
const fauxResponses = new FauxResponseQueue();
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  extensionFactories: [
    (pi) => {
      pi.registerProvider(FAUX_PROVIDER, {
        api: FAUX_MODEL.api,
        baseUrl: FAUX_MODEL.baseUrl,
        apiKey: 'test-key',
        streamSimple: fauxResponses.stream,
        models: [{
          id: FAUX_MODEL.id,
          name: FAUX_MODEL.name,
          api: FAUX_MODEL.api,
          baseUrl: FAUX_MODEL.baseUrl,
          reasoning: FAUX_MODEL.reasoning,
          thinkingLevelMap: FAUX_MODEL.thinkingLevelMap,
          input: [...FAUX_MODEL.input],
          cost: FAUX_MODEL.cost,
          contextWindow: FAUX_MODEL.contextWindow,
          maxTokens: FAUX_MODEL.maxTokens,
        }],
      });
    },
    registerSuperGsd,
  ],
});
```

Pass `model: FAUX_MODEL` and `thinkingLevel: 'off'` to `createAgentSession()`, and store `fauxResponses` in the harness constructor.

- [ ] **Step 3: Verify model selection**

Add this assertion to the foundation smoke test:

```ts
assert.strictEqual(h.modelName(), 'supergsd-test/deterministic');
```

Add to `TestHarness`:

```ts
modelName(): string | undefined {
  const model = this.session.model;
  return model ? `${model.provider}/${model.id}` : undefined;
}
```

### Task 4: Implement `h.prompt()` and unused-descriptor checks

**Files:**
- Modify: `src/test-helpers/harness.ts`
- Test: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Add `prompt()` method**

Add:

```ts
async prompt(text: string, ...responses: ResponseDescriptor[]): Promise<void> {
  this.fauxResponses.enqueue(...responses);
  await this.session.prompt(text, { expandPromptTemplates: false, source: 'test' as never });
  await this.session.agent.waitForIdle();
  this.assertNoQueuedResponses(`prompt(${JSON.stringify(text)})`);
}

private assertNoQueuedResponses(label: string): void {
  const remaining = this.fauxResponses.remaining();
  assert.deepStrictEqual(remaining, [], `${label} left unused faux responses queued`);
}
```

Import `ResponseDescriptor` from `descriptors.ts`.

- [ ] **Step 2: Test normal prompt response**

Add to `harness.test.ts`:

```ts
import { assistant, responds, user } from './index.js';

it('records a user prompt and deterministic assistant response', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('main work', responds('working...'));
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
    );
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 3: Test unused descriptor failure**

Add:

```ts
await assert.rejects(
  async () => h.prompt('main work', responds('used'), responds('unused')),
  /left unused faux responses queued/,
);
```

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts
```

Expected: PASS.

### Task 5: Test thinking, aborted, and real push-task tool use

**Files:**
- Modify: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Add thinking/aborted tests**

Add:

```ts
import { aborts, thinks } from './index.js';

it('supports thinking and aborted response descriptors', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('think', thinks('checking context'));
    h.assertBranchHistory(
      user('think'),
      assistant(''),
    );

    await h.prompt('stop', aborts('Stopped by user.'));
    h.assertSessionContains(
      user('stop'),
      assistant('Stopped by user.', 'aborted'),
    );
  } finally {
    h.dispose();
  }
});
```

If Pi does not persist pure thinking as an empty assistant text in branch projection, update only the assertion helper projection so thinking-only assistant messages appear as `assistant('')` consistently.

- [ ] **Step 2: Add push-task descriptor test**

Add:

```ts
import { pushTask, task } from './index.js';

it('calls the real push-task tool from a faux provider tool call', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('delegate work', pushTask('subtask', true));
    h.assertSessionContains(
      user('delegate work'),
      task('subtask', true),
    );
    h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 3: Verify phase 3 tests**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts
npx tsc --noEmit
npm test
```

Expected: all PASS.

### Task 6: Commit phase 3

**Files:**
- All files touched in this phase

- [ ] **Step 1: Run required autofix**

Run:

```bash
npm run fix
```

Expected: PASS.

- [ ] **Step 2: Commit**

Run:

```bash
git add src/test-helpers

git commit -m "test: add faux provider prompt descriptors"
```

Expected: commit succeeds.

## Inline Plan Review

- **Roadmap coverage:** Covers prompt helper, response descriptors, faux provider model calls, real `push-task` tool calls, and unused descriptor enforcement. Excludes full auto reaction DSL and broad test migration.
- **Placeholder scan:** No unbounded placeholders; API export fallback is limited to the exact event-stream import and must be resolved by TypeScript before completion.
- **Type consistency:** `pushTask` is a response descriptor; `task` remains an assertion descriptor; `prompt` and `queuedTask` are match descriptors.
- **Phase boundary health:** New harness prompt tests pass while legacy tests still run unchanged, leaving the project coherent and expected-green.
