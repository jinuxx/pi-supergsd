# AgentSession-Backed Test Harness Design

## Summary

Refactor `src/test-helpers/` to reduce hand-rolled Pi behavior while preserving the current compact test style. The existing `TestHarness` will first be renamed to `LegacyTestHarness`; a new `TestHarness` will then be implemented afresh and tests will be ported one by one.

The new harness will use a real Pi `AgentSession`, real extension registration, and a faux provider for deterministic assistant responses. Direct message injection helpers will be removed so tests build state through real prompts and real agent turns.

## Goals

- Replace `PiStub` and manual message/session mutation with Pi runtime code where practical.
- Preserve high-level test ergonomics such as `runPushTask`, `runAuto`, and `assertBranchHistory`.
- Drive assistant output through real `AgentSession` turns and faux responses, including `sendMessage(..., { triggerTurn: true })` follow-up turns.
- Remove direct message injection helpers: `appendUserMessage` and `appendAssistantMessage`.
- Reorganize stubs/helpers into clear modules with focused responsibilities.
- Allow incremental migration by renaming the current harness to `LegacyTestHarness` and introducing a fresh `TestHarness`.

## Non-goals

- Do not rewrite tests into raw Pi E2E style that directly asserts mostly on events.
- Do not remove SuperGSD-specific DSL pieces such as branch-history assertions or auto reactions.
- Do not depend on web-fetched Pi source; use the local cloned Pi repo and installed/test-only dependencies.

## Architecture

The new `TestHarness` will own a real Pi session stack:

- `AgentSession` for session lifecycle, prompts, extension APIs, tool calls, custom messages, and `triggerTurn` behavior.
- Pi extension registration through this package's default extension entrypoint (`index.ts`) so commands, tools, renderers, and event handlers are registered normally.
- A faux provider/model for deterministic assistant responses.
- Mode-like command-context bindings required by Pi:
  - `waitForIdle` delegates to `session.agent.waitForIdle()`.
  - `navigateTree` delegates to `session.navigateTree(...)`, with a test flag for one-shot cancellation.
  - `newSession`, `fork`, `switchSession`, and `reload` use minimal successful test implementations unless a test needs more behavior.
- Minimal UI context captures notifications and task status updates.

The current `LegacyTestHarness` remains available during migration so tests can move gradually.

## Test DSL

### Prompt helper

Tests create conversation state with real prompts:

```ts
await h.prompt('main work', responds('working...'));
```

`prompt()` accepts a user prompt plus zero or more response descriptors. Response descriptors are queued into the faux provider and consumed by real agent turns. Each response descriptor represents one provider response for one model call, not another content block in the same assistant message.

### Response descriptors

- `responds(text)` — normal assistant text response.
- `thinks(text)` — assistant thinking block response.
- `aborts(text)` — assistant response with `stopReason: 'aborted'`.
- `pushTask(prompt, inherit_context?)` — assistant tool call to the real `push-task` tool.

Multiple descriptors can be supplied when one user prompt is expected to cause multiple model calls, such as a response that queues a follow-up turn or a later `sendMessage(..., { triggerTurn: true })` continuation. `prompt()` fails if any queued descriptors remain unused after the prompt and its follow-up work settle:

```ts
await h.prompt(
  'main work',
  thinks('checking context...'),
  responds('done after continuation'),
);
```

`pushTask(...)` produces an assistant tool-use response that calls the real `push-task` tool. Because the tool returns `terminate: true`, it should normally be the last descriptor for the current prompt. If later descriptors are provided, the harness should require a later real model call to consume them and fail the test if they remain unused.

### Assertion descriptors

Existing visible-history descriptors remain for assertions:

- `user(text)`
- `assistant(text, stopReason?)`
- `task(prompt, inherit_context?)`
- `taskResult(slug, content?)`
- `notification(text)`

`task(...)` remains an expected branch entry descriptor. `pushTask(...)` is only a response descriptor that calls the real tool.

### Match descriptors

Reaction matches use explicit match descriptors so control reactions can target entries before navigation:

- `prompt(text)` — matches a real user prompt sent to the model.
- `assistant(text, stopReason?)` — matches a completed assistant message.
- `queuedTask(prompt, inherit_context?)` — matches a stored pending task custom entry before `/auto` navigates to run it.

`queuedTask(...)` exists for cases such as navigation cancellation, where the test needs to react before the task prompt is sent to the model.

### Reaction descriptors

`runAuto()` keeps a reaction DSL, but reactions drive real Pi turns:

```ts
await h.runAuto({
  reactions: [
    [prompt('Analyze performance'), responds('Found 3 bottlenecks')],
    [queuedTask('Cancel before navigation'), userEsc()],
    [prompt('subtask'), thinks('checking'), responds('sub done')],
  ],
});
```

- `prompt(text)` matches a real user prompt sent to the model.
- `queuedTask(text)` matches a pending task entry before `/auto` starts navigation.
- One reaction may include multiple response descriptors; each response descriptor supplies one provider response for one real model call.
- `assistant(...)` may still be used as a match descriptor when reacting to completed assistant messages.
- `userEsc()`, `userCtrlC()`, and `userRunsAuto()` remain control reactions:
  - `userEsc()` cancels the next navigation.
  - `userCtrlC()` triggers the session shutdown path.
  - `userRunsAuto()` invokes `/auto` while the current auto run is active.

## Reorganization

Refactor `src/test-helpers/` toward these modules:

```text
src/test-helpers/
  index.ts
  descriptors.ts      # assertion, match, and response descriptor builders
  harness.ts          # AgentSession-backed TestHarness
  legacy-harness.ts   # renamed old TestHarness during migration
  reactions.ts        # reaction matching and faux-response queueing
  assertions.ts       # visible branch/session projection and comparisons
  ui.ts               # minimal UI context/status/notification capture
  test-tree.ts        # existing node() DSL, adjusted to choose harness type during migration
```

`pi-stub.ts` should disappear once the new harness no longer needs a fake `ExtensionAPI`.

## Migration plan

1. Rename existing `TestHarness` to `LegacyTestHarness` without behavior changes.
2. Add the new AgentSession-backed `TestHarness` in a separate file.
3. Add response/match descriptors: `prompt`, `queuedTask`, `responds`, `thinks`, `aborts`, `pushTask`.
4. Port tests one by one from `LegacyTestHarness` to the new `TestHarness`.
5. Replace direct message setup:
   - `h.appendUserMessage(...)` becomes `await h.prompt(...)` or a no-response real prompt helper if needed.
   - `h.appendAssistantMessage(...)` becomes response descriptors.
6. Replace model-prompt reaction matches from `user(...)` to `prompt(...)`.
7. Replace pre-navigation task-entry reaction matches from `task(...)` to `queuedTask(...)`.
8. Replace subtask-producing reactions from `task(...)` to `pushTask(...)`.
9. Remove `LegacyTestHarness` and `pi-stub.ts` after all tests are ported.

## Testing and verification

- Keep tests focused on public package behavior through tools and commands.
- Prefer real `AgentSession` prompts and faux provider responses over direct session mutation.
- Preserve `assertBranchHistory` and `assertSessionContains` to keep workflow tests readable.
- Run `npm run fix` before final verification.
- Run `npm run verify` as the full gate.

## Open implementation notes

- Test-only dependencies on Pi packages are allowed, especially for the faux provider.
- If current installed Pi exports are insufficient, prefer adding explicit dev dependencies over importing from unexported internal files.
- The faux response factory can inspect model context to support shared/common reactions.
- The harness should avoid overloading descriptor names in ambiguous contexts: `task` is for expected entries; `pushTask` triggers the real tool.
