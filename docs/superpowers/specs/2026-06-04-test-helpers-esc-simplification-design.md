# Simplify `src/test-helpers/` ESC handling

## Summary

Simplify `src/test-helpers/` so `userEsc()` no longer simulates a live abort of a streaming assistant response.

Instead, when a test registers `h.user.onAssistant(..., userEsc())`, the faux provider should build the normal final assistant message, detect the matching ESC rule against that final visible text, and rewrite the message before it is streamed to the session.

The rewritten message should:

- keep only the first half of the final visible text
  - here, "final visible assistant text" means the text a user would see after flattening the assistant message's visible text content and ignoring non-visible structure such as thinking blocks and tool-call metadata
- use `Math.floor(text.length / 2)` for truncation
- set `stopReason: "aborted"`

Queued-task ESC behavior should not be supported in `src/test-helpers/`.

## Problem

The current helpers contain extra machinery to simulate an in-flight abort:

- `FauxProvider` proxies the stream and tracks partial text
- `TestHarness` wires partial text callbacks to `session.abort()`
- `userEsc()` has two meanings depending on context
  - assistant reaction: abort generated output
  - queued-task reaction: cancel navigation

This makes the helpers harder to understand and maintain than necessary for the tests they serve.

It also models the wrong thing. Research into Pi runtime behavior shows that Esc aborts the active agent run, not navigation. By the time a queued task exists for `onQueuedTask(...)` to match, the `push-task` tool call has already completed enough to append the task entry, so queued-task ESC cannot faithfully represent "Esc during tool call".

## Goals

- Make assistant-side ESC behavior deterministic and simple
- Preserve the ability to assert an aborted assistant result with partial text
- Remove invalid queued-task ESC behavior
- Reduce helper complexity in `src/test-helpers/`

## Non-goals

- Simulating real-time token-by-token user interruption
- Preserving exact streamed partial boundaries
- Modeling Esc during `push-task` via queued-task reactions

## Considered approaches

### 1. Keep stream simulation

Continue to proxy the stream and simulate aborts while text is being emitted.

- Pros: closest to live behavior
- Cons: highest complexity, keeps the exact machinery under suspicion

### 2. Rewrite the final assistant message before streaming (**chosen**)

Build the normal assistant message first, then rewrite it when an assistant ESC rule matches.

- Pros: simple, deterministic, easy to test
- Cons: no true streaming-abort simulation

### 3. Introduce a new explicit helper instead of `userEsc()`

Replace assistant-side ESC semantics with a dedicated helper for aborted-half-text behavior.

- Pros: very explicit API
- Cons: unnecessary churn; current `userEsc()` is good enough once narrowed

## Decision

Adopt approach 2.

`userEsc()` in test helpers will only apply to assistant-message matching. When it matches, the faux provider will rewrite the assistant result to a truncated aborted message before handing it to the session.

`onQueuedTask(..., userEsc())` will be rejected because queued-task matching happens after `push-task` has already completed enough to create the task entry, which is too late to model Esc during the tool call itself.

## Detailed design

### Behavior

For a would-be assistant text response `text`:

- compute `cutoff = Math.floor(text.length / 2)`
- replace the visible assistant text with `text.slice(0, cutoff)`
- set `stopReason: "aborted"`

Example:

- `"ABCDEFGHIJ"` → `assistant("ABCDE", "aborted")`
- `"ABCDEFGHI"` → `assistant("ABCD", "aborted")`

No live abort or partial-stream simulation is required.

### `src/test-helpers/faux-provider.ts`

Responsibilities after the change:

- build the normal assistant message from `MockLLM` descriptors
- extract final visible assistant text
- ask whether an assistant ESC rule matches that text
- if matched, rewrite the assistant message to truncated text + `stopReason: "aborted"`
- stream the rewritten final message normally through the faux provider

Responsibilities removed:

- custom stream proxying
- partial text accumulation
- abort-signal observation for test-driven assistant ESC behavior
- special error-event synthesis for assistant ESC simulation

Implementation note:

- In the aborted rewrite path, rebuild the assistant output as a plain text assistant message containing only the truncated visible text.
- This intentionally drops any thinking/tool-call structure from the original response in the aborted case.
- This is acceptable because the feature is for deterministic test assertions, not faithful UI replay.

### `src/test-helpers/mock-user.ts`

`userEsc()` remains part of the public helper API, but its scope narrows:

- valid: `onAssistant(..., userEsc())`
- invalid: `onQueuedTask(..., userEsc())`

To make misuse obvious, `MockUser.onQueuedTask(...)` should throw at registration time when any supplied action is `userEsc()`, with a clear error from the test helper, for example: `userEsc() is only supported for onAssistant(...), not onQueuedTask(...)`.

### `src/test-helpers/harness.ts`

Remove ESC-specific live-abort plumbing:

- remove `fauxProvider.setOnPartialText(...)`
- remove `session.abort()` wiring for assistant partial text
- remove navigation-cancel state used for queued-task ESC

`TestHarness.scanAndReactLoop()` should continue to process non-ESC assistant actions such as `userPrompts(...)`.

### Queued tasks

Queued-task ESC support is rejected as invalid.

The helpers should not simulate cancelling navigation between queued-task creation and navigation. That path is a tree-navigation concern, not the runtime meaning of Esc.

If a test attempts to register `onQueuedTask(..., userEsc())`, it should fail immediately rather than silently keep legacy semantics.

## Data flow

1. Test registers a mock LLM response in `MockLLM`
2. Test optionally registers an assistant ESC rule in `MockUser`
3. `FauxProvider.stream(...)` builds the normal assistant message
4. `FauxProvider` extracts final visible assistant text
5. If an assistant ESC rule matches, `FauxProvider` rewrites the message to half-text + `stopReason: "aborted"`
6. The session records the rewritten assistant message
7. `TestHarness` may still react to later assistant actions such as follow-up prompts

Queued-task matching remains available for non-ESC reactions only.

## Error handling

- If no assistant ESC rule matches, behavior is unchanged
- If `userEsc()` is used with `onQueuedTask(...)`, throw a descriptive helper error immediately because queued-task matching occurs after `push-task` has already produced the task entry
- If assistant output contains non-text structure, the aborted rewrite path should still collapse to a plain text assistant message

Example: if the original assistant message contains thinking blocks plus visible text, derive the rewrite input from the final visible assistant text only, truncate that text, and emit a plain text aborted assistant message without the thinking blocks.

## Testing changes

Update tests to assert deterministic rewritten aborted messages rather than streamed partial preservation.

### Keep coverage for

- assistant ESC truncates even-length text to half
- assistant ESC truncates odd-length text using `Math.floor`
- assistant ESC sets `stopReason: "aborted"`
- non-ESC assistant reactions such as `userPrompts(...)` still work

### Remove coverage for

- queued-task ESC cancelling navigation
- stream-level partial-text preservation mechanics

### Add coverage for

- `onQueuedTask(..., userEsc())` throws a clear error

## Impact

Expected benefits:

- smaller and easier-to-read test helper stack
- fewer moving parts in `FauxProvider` and `TestHarness`
- deterministic aborted-message assertions
- removal of invalid queued-task ESC semantics that do not match Pi runtime behavior

Expected trade-off:

- tests no longer model a truly in-flight user abort

This trade-off is intentional and acceptable because the goal of these helpers is stable test ergonomics, not a perfect simulation of runtime timing.

## Planning scope

This is small enough for a single implementation plan. No roadmap phase is needed.
