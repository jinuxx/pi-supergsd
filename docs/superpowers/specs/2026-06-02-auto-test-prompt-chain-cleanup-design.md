# Auto-test prompt chain cleanup

## Summary

Collapse two-prompt “queue then /auto” flows in `src/auto.test.ts` into single realistic turns where the assistant both speaks and pushes a task — matching the pattern already established in `src/manual.test.ts`.

## Context

`manual.test.ts` was refactored (commits `f033f11` through `a3e74d6`) to use concise prompt chains: the assistant responds to a user message with both text *and* a `pushTask` tool call in one turn. Notification entries were removed from `assertSession`, status was moved to `assertStatus`, and assertions were condensed to single-line where possible.

`auto.test.ts` still uses a two-prompt pattern inherited from earlier harness design: a first prompt for the assistant’s text response, then a second “queue X” prompt whose only job is to carry a `pushTask` tool call with empty assistant text. This produces verbose sessions full of `assistant("", "toolUse")` entries and `responds("")` mock rules.

Relevant files:

- `src/auto.test.ts`
- `src/manual.test.ts` (reference for target style)

## Goals

- Collapse “queue X” turns into the first prompt wherever possible
- Eliminate `responds("")` mock rules that existed only to carry the tool call
- Condense `assertSession(...)` to single-line when the entry list fits comfortably
- Group `onPrompt` rules logically: task-execution rules first, leaf-continuation rules last
- Remove dead `onPrompt("", responds(""))` rules that don’t correspond to any prompt in the flow
- Keep empty leaf-continuation responses (`responds("")`) only where genuine (auto re-prompts after finishing a task and the LLM has nothing to add)

## Non-goals

- Changing test structure (`it()` + `TestHarness.create()` + `try/finally` stays)
- Extracting shared setup into helpers or wrappers
- Changing the `/auto` command or any production code
- Modifying `src/manual.test.ts`
- Refactoring scenario-specific hooks (`userPrompts`, `userEsc`, `userCtrlC`, `aborts`)

## Design

### Per-test changes

| Test | Change |
|------|--------|
| 1 (completes push-task → /auto) | Fold “queue analyze” into first prompt. Remove dead `onPrompt("", responds(""))`. Single-line `assertSession`. |
| 2 (branch-context task result to original leaf) | Fold “queue quick-fix” into first prompt. |
| 3 (stops on cancelled navigation) | Fold “queue analyze” into first prompt. |
| 4 (no pending tasks) | Unchanged — already one prompt. |
| 5 (warns when /auto already running) | Fold “queue first” into first prompt. The `userPrompts("/auto")` hook stays. |
| 6 (last assistant message aborted) | Fold “queue implement” into first prompt. The `aborts(...)` rules stay. |
| 7 (subtask during task) | Fold “queue parent” into first prompt. The subtask rules stay. Verify whether `onPrompt("", responds(""))` is dead or serves the subtask chain. |
| 8 (steering message during auto) | Fold “queue quick-fix” into first prompt. `userPrompts("steer it")` hook stays. |
| 9 (session shutdown during auto) | Fold “queue shutdown” into first prompt. `userCtrlC()` hook stays. |

### Session entry ordering

After the collapse, sessions follow this flow:

1. `user("main work")` — the initial prompt
2. `assistant("working...", "toolUse")` — the assistant both speaks and pushes a task
3. `task("Task Name")` — the pushed task (with optional `true` for inherit)
4. `taskResult(...)` — auto’s branch result, injected after auto finishes
5. `assistant("")` — leaf continuation (auto re-prompts; empty when nothing to add)

The “queue X” user message and the standalone `assistant("", "toolUse")` entry disappear.

### Mock rule grouping

Within each test, `onPrompt` rules will be grouped:

```
// Task-execution rules
h.llm.onPrompt("Task AAA", responds("Done."));
h.llm.onPrompt("Done.", responds("Great!"));

// Leaf-continuation rules (used when auto returns to the original leaf)
h.llm.onPrompt("working...", responds(""));
```

### Empty responses

Only two kinds of `responds("")` remain after the cleanup:

1. **Leaf continuations** — when auto returns to the original leaf and the LLM has nothing more to say. Genuine and minimal.
2. **Initial responses in some special scenarios** — e.g., test 6 starts with `onPrompt("start", responds(""))` to set up an immediate abort. These are intentional scenario scaffolding, not artifacts of the queue pattern.

## Data flow

1. Test sets up `onPrompt` rules for the LLM mock
2. Test calls `h.prompt("main work")` — a single user turn
3. Mock LLM responds with text *and* a `pushTask` tool call in one turn
4. Test calls `h.prompt("/auto")` — auto processes the pending task in a branch
5. Auto returns to the original leaf, optionally re-prompts the LLM (empty continuation if nothing to add)
6. `assertSession` verifies the abbreviated visible timeline

## Error handling / edge cases

- **Test 7 subtask chain**: the `onPrompt("", responds(""))` rule needs verification during implementation. If it serves the subtask flow (a prompt with empty content is submitted to the LLM), it stays. If dead, remove.
- **Test 5 double-/auto**: the first prompt now carries the pushTask. The mock user’s `userPrompts("/auto")` fires *during* the auto loop, not before — the collapse doesn’t affect that timing.
- **Order sensitivity**: auto always re-prompts the LLM at the original leaf after finishing a task, so `taskResult` always appears *before* the leaf-continuation `assistant(...)` entry — never after. New assertions follow the pattern `taskResult(...), assistant(...)`.

## Testing

All existing `auto.test.ts` test cases must continue to pass. The collapse is a mechanical refactor that preserves the same scenario coverage with fewer entries per session.

No new test cases are needed — the refactor reduces noise without changing coverage.

## Trade-offs

### Benefits

- Prompt chains read as realistic assistant turns rather than technical scaffolding
- Fewer `responds("")` rules — easier to see which responses matter
- Consistent style with `manual.test.ts`
- Shorter `assertSession` calls in most tests

### Costs

- Some `assertSession` expectations become wider (combined text + toolUse on one turn)
- Test 7 subtask chain needs a one-time verification step during implementation

## Scope check

This is a single test-file refactor. One implementation pass. No decomposition needed.

## Acceptance criteria

- No test calls `h.prompt("queue ...")` — task pushes happen on the same turn as the assistant’s text response
- No `assistant("", "toolUse")` entries in `assertSession` for the common two-prompt pattern
- `responds("")` only remains for genuine leaf continuations or intentional scenario scaffolding
- All auto tests pass
- `assertSession` condensed to single-line where the entry list fits comfortably
