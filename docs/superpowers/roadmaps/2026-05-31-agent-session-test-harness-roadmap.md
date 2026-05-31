# AgentSession Test Harness Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** Replace the hand-rolled test helper runtime with an AgentSession-backed harness while preserving SuperGSD's compact test DSL and enabling safe incremental migration.

**Design Spec:** [`docs/superpowers/specs/2026-05-31-agent-session-test-harness-design.md`](../specs/2026-05-31-agent-session-test-harness-design.md)

**Planning Strategy:** This refactor touches harness architecture, descriptors, faux model behavior, command context, and many tests, so it should be split into independently verifiable phases that keep the existing suite green while gradually moving tests from the legacy harness to the new AgentSession-backed harness.

---

## Phase 1: Legacy Harness Rename and Module Boundary Prep

**Outcome:** The current harness behavior is preserved under `LegacyTestHarness`, exports remain compatible for existing tests, and the helper modules are ready to host the new harness without mixing old and new responsibilities.

**Why now:** This creates a safe migration baseline before introducing AgentSession behavior, allowing later phases to add a new `TestHarness` without breaking the current suite.

**Scope:**
- Rename the existing `TestHarness` implementation to `LegacyTestHarness` with no intentional behavior changes.
- Keep existing tests running through the legacy harness by default during the transition.
- Establish or prepare the target helper module boundaries for descriptors, assertions, reactions, UI capture, and harness exports.
- Preserve existing descriptors and test-tree ergonomics while making room for new descriptor types.

**Out of scope:**
- Implementing AgentSession-backed prompting or faux provider responses.
- Porting tests to the new harness.
- Removing `pi-stub.ts` or direct message injection helpers.

**Key files/areas likely affected:**
- `src/test-helpers/test-harness.ts`: current implementation to rename or move.
- `src/test-helpers/legacy-harness.ts`: destination for the unchanged legacy harness.
- `src/test-helpers/index.ts`: transitional exports for legacy and future harnesses.
- `src/test-helpers/test-tree.ts`: harness type selection during migration.
- `src/test-helpers/common.ts`: possible descriptor/module split preparation.

**Dependencies:**
- Design spec approval.

**Verification:**
- Existing tests pass with unchanged behavior.
- Type-check confirms the rename/export transition is coherent.
- No semantic drift in branch-history assertions, command wrappers, or auto reaction behavior.

**Phase boundary health:** The project remains fully functional because all tests still use the legacy behavior, only under clearer naming and module organization.

**Risks:**
- Export churn could break many imports; mitigate by preserving compatibility exports during the transition.
- Accidental behavior changes in the rename could obscure later failures; mitigate by keeping this phase deliberately mechanical.

**Context notes:** The detailed plan for this phase should resist adding new AgentSession features; its value is isolating legacy behavior and making later diffs easier to review.

## Phase 2: AgentSession Harness Foundation

**Outcome:** A new `TestHarness` exists that boots a real Pi `AgentSession`, registers the package extension normally, captures UI/status effects, and supports basic command/tool wrappers without yet replacing the full reaction DSL.

**Why now:** The new runtime foundation must exist before prompt descriptors, provider response queues, and migrated tests can rely on real agent turns.

**Scope:**
- Add a fresh AgentSession-backed `TestHarness` separate from `LegacyTestHarness`.
- Register this package's extension entrypoint through Pi's extension APIs instead of `PiStub` behavior where practical.
- Provide minimal command-context bindings for idle waiting, navigation, session switching, fork/new session, and reload.
- Add UI/status capture equivalent to the legacy harness's notification and task status assertions.
- Preserve high-level wrappers for SuperGSD commands and tools where they can run against the real session stack.

**Out of scope:**
- Full response descriptor support for multi-turn model calls.
- Full `/auto` reaction DSL parity.
- Porting the test suite broadly to the new harness.
- Deleting legacy helpers.

**Key files/areas likely affected:**
- `src/test-helpers/harness.ts`: new AgentSession-backed harness.
- `src/test-helpers/ui.ts`: notification and task-status capture.
- `src/test-helpers/index.ts`: export the new harness alongside transitional legacy exports.
- `src/index.ts` and root `index.ts`: extension entrypoint integration points used by tests.
- `package.json` / TypeScript config area: possible dev dependency adjustments if Pi test exports are needed.

**Dependencies:**
- Phase 1 module boundaries.
- Local installed Pi package exports and available test-only dependencies.

**Verification:**
- A small focused test or smoke coverage can create the new harness and run basic SuperGSD command/tool paths.
- Existing legacy-backed suite remains green.
- Type-check verifies AgentSession and extension API usage through exported/public APIs.

**Phase boundary health:** The project remains coherent because the legacy suite still protects current behavior while the new harness is available but not yet required for all tests.

**Risks:**
- Pi public exports may not expose everything needed; mitigate by using local installed package APIs and adding explicit dev dependencies rather than importing unexported internals.
- Extension registration may have hidden UI or model assumptions; mitigate by keeping command-context and UI shims minimal but real enough for current commands.

**Context notes:** The detailed plan should inspect local Pi APIs before committing to constructor shapes or provider registration details.

## Phase 3: Faux Provider and Prompt Response Descriptors

**Outcome:** Tests can build state through `await h.prompt(...)` and deterministic faux provider responses, including normal text, thinking blocks, aborted responses, tool-use `push-task`, and follow-up model calls that must consume all queued descriptors.

**Why now:** Prompt-driven state creation is the core replacement for direct message injection and is required before meaningful test migration can begin.

**Scope:**
- Add response descriptors: `responds`, `thinks`, `aborts`, and `pushTask`.
- Add match descriptors where needed for model prompts and queued tasks without ambiguity.
- Implement a faux provider/model queue that converts each descriptor into one real model response.
- Implement `h.prompt(...)` so user prompts and assistant outputs flow through real AgentSession turns.
- Enforce unused-descriptor failures after prompt/follow-up work settles.
- Keep existing assertion descriptors such as `user`, `assistant`, `task`, `taskResult`, and `notification` readable.

**Out of scope:**
- Full `/auto` reaction DSL migration.
- Porting every existing test.
- Removing `appendUserMessage` or `appendAssistantMessage` from the legacy harness.

**Key files/areas likely affected:**
- `src/test-helpers/descriptors.ts`: assertion, match, and response descriptor builders.
- `src/test-helpers/harness.ts`: prompt helper and faux provider integration.
- `src/test-helpers/assertions.ts`: visible branch/session projection for real AgentSession entries.
- `src/test-helpers/reactions.ts`: shared descriptor matching and response queue plumbing foundations.
- `src/test-helpers/common.ts`: migration source for descriptors before it can shrink or disappear.

**Dependencies:**
- Phase 2 AgentSession-backed harness foundation.

**Verification:**
- Focused tests demonstrate prompt-to-assistant history, thinking/aborted stop reasons, real `push-task` tool calls, and failure on unused queued descriptors.
- Legacy suite remains green.
- Type-check catches descriptor naming and overload ambiguity.

**Phase boundary health:** The new harness becomes useful for prompt-based tests without forcing the entire suite to migrate, so both old and new paths can remain expected-green.

**Risks:**
- Descriptor names may become ambiguous across assertion, match, and response contexts; mitigate with explicit builders such as `prompt`, `queuedTask`, and `pushTask`.
- Follow-up turns may be timing-sensitive; mitigate by centralizing idle settlement and descriptor consumption checks.

**Context notes:** The detailed plan should define descriptor types before implementation to keep TypeScript as the guardrail for valid DSL usage.

## Phase 4: AgentSession-Backed Auto Reactions

**Outcome:** `runAuto()` works against the real AgentSession and faux provider while preserving the compact reaction DSL for prompts, queued tasks, assistant messages, navigation cancellation, shutdown, and nested auto invocation.

**Why now:** Auto workflow tests are the most behavior-rich consumers of the harness and require the prompt/provider foundation before they can be ported safely.

**Scope:**
- Implement reaction matching for real model prompts via `prompt(...)`.
- Implement pre-navigation pending task matching via `queuedTask(...)`.
- Queue one or more response descriptors per reaction for real provider calls.
- Preserve control reactions: `userEsc`, `userCtrlC`, and `userRunsAuto`.
- Preserve high-level assertions over visible branch history, session contents, notifications, and task status.

**Out of scope:**
- Porting all tests if the DSL still needs incremental validation.
- Removing the legacy auto reaction implementation.
- Expanding tests into raw Pi E2E event assertions.

**Key files/areas likely affected:**
- `src/test-helpers/reactions.ts`: real-session reaction scanner and queueing behavior.
- `src/test-helpers/harness.ts`: `runAuto`, idle handling, navigation cancellation, and shutdown integration.
- `src/test-helpers/assertions.ts`: branch/session projections for entries produced by real auto runs.
- `src/auto.test.ts`: initial migrated coverage for representative auto workflows.
- `src/test-helpers/legacy-harness.ts`: retained as fallback for tests not yet ported.

**Dependencies:**
- Phase 3 prompt descriptors and faux provider queue.

**Verification:**
- Representative auto tests pass on the new harness for normal subtasks, queued task cancellation, nested auto invocation, and shutdown handling.
- Existing legacy tests remain green until migrated.
- No queued response descriptors are left unconsumed after auto settles.

**Phase boundary health:** The project remains functional because auto DSL parity is established for representative cases while unmigrated edge cases can still use the legacy harness.

**Risks:**
- Real AgentSession turn scheduling can differ from the legacy fixed-point scanner; mitigate by reacting at stable idle/session event points and keeping deterministic step caps.
- Navigation cancellation must occur before the task prompt is sent; mitigate with explicit `queuedTask(...)` matching.

**Context notes:** The detailed plan should identify the minimum representative auto cases before porting broad coverage, so DSL bugs are fixed early.

## Phase 5: Incremental Test Migration

**Outcome:** Existing tests are ported from `LegacyTestHarness` to the new `TestHarness` one coherent group at a time, replacing direct message setup with real prompts and descriptor-driven responses.

**Why now:** Once the new harness supports prompts and auto reactions, the suite can migrate gradually while preserving readable SuperGSD-specific assertions.

**Scope:**
- Port manual command/tool tests to prompt-driven setup where needed.
- Port auto workflow tests from legacy reaction matches to explicit `prompt(...)`, `queuedTask(...)`, and `pushTask(...)` descriptors.
- Replace `appendUserMessage` and `appendAssistantMessage` usage in migrated tests.
- Keep or adjust `node()` DSL behavior so migrated tests instantiate the intended harness.
- Preserve `assertBranchHistory` and `assertSessionContains` style assertions.

**Out of scope:**
- Removing legacy harness files before all tests are migrated.
- Large rewrites into low-level Pi event assertions.
- Behavior changes to SuperGSD commands or tools beyond what is necessary for real session compatibility.

**Key files/areas likely affected:**
- `src/manual.test.ts`: command/tool tests and direct setup replacement.
- `src/auto.test.ts`: reaction DSL and subtask-producing behavior migration.
- `src/test-helpers/test-tree.ts`: transitional selection of legacy versus new harness if needed.
- `src/test-helpers/index.ts`: imports consumed by migrated tests.
- `src/test-helpers/assertions.ts`: fixes for real session projection discovered during migration.

**Dependencies:**
- Phase 4 auto reaction support.

**Verification:**
- Each migrated test group passes before moving to the next group.
- The full test suite remains green throughout migration.
- Direct message injection helpers are absent from migrated tests.

**Phase boundary health:** After each migration batch, the suite remains coherent because tests either fully use the new harness or still intentionally use the legacy harness.

**Risks:**
- Migration may reveal behavior differences between PiStub and real AgentSession; mitigate by distinguishing harness defects from actual SuperGSD behavior changes before editing production code.
- Bulk migration could make failures hard to localize; mitigate by moving one coherent test group at a time.

**Context notes:** The detailed plan should choose a small first migration target that exercises basic prompt/response behavior before broader auto workflows.

## Phase 6: Legacy Removal and Final Helper Cleanup

**Outcome:** The test helper stack uses the AgentSession-backed `TestHarness` exclusively, `LegacyTestHarness` and `pi-stub.ts` are removed, and helper modules match the target organization from the design.

**Why now:** Cleanup should wait until all tests are ported so removal is a low-risk deletion rather than a forced migration under uncertainty.

**Scope:**
- Remove `LegacyTestHarness` and any compatibility exports that were only needed during migration.
- Remove `pi-stub.ts` once no fake `ExtensionAPI` behavior remains.
- Finalize module organization across descriptors, harness, reactions, assertions, UI, and test-tree helpers.
- Remove direct message injection helpers from the public test helper API.
- Update imports and type names to make the new harness the only default path.

**Out of scope:**
- New harness features beyond the approved design.
- Further production behavior changes unrelated to harness realism.
- Test style rewrites after migration is complete.

**Key files/areas likely affected:**
- `src/test-helpers/legacy-harness.ts`: deletion.
- `src/test-helpers/pi-stub.ts`: deletion.
- `src/test-helpers/index.ts`: final public helper API.
- `src/test-helpers/test-tree.ts`: new harness-only typing.
- `src/test-helpers/descriptors.ts`, `reactions.ts`, `assertions.ts`, `ui.ts`, `harness.ts`: final cleanup and ownership alignment.

**Dependencies:**
- Phase 5 completion with no remaining legacy-harness consumers.

**Verification:**
- Search confirms no imports or references to `LegacyTestHarness`, `pi-stub`, `appendUserMessage`, or `appendAssistantMessage` remain in the active test helper API.
- `npm run fix` completes before final verification.
- `npm run verify` passes as the full gate.

**Phase boundary health:** The project is left in its final coherent state with one real-session test harness and no transitional duplication.

**Risks:**
- Removing compatibility exports may uncover stray consumers; mitigate with repository-wide search and type-checking.
- Cleanup may accidentally change tested behavior; mitigate by keeping final edits focused on deletion and module consolidation.

**Context notes:** The detailed plan should run repository searches before deletion and treat `npm run verify` as mandatory before declaring completion.
