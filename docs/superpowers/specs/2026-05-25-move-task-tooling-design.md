# Move task-based tooling from pi-navigator to pi-supergsd

## Motivation

pi-navigator's recent changes decoupled task-based tooling (`push-task`, `/start-task`, `/discard-task`) from user-driven navigation (`/start-branch`, `/start-fresh`, `/return`, `/cancel`). Task-based workflows are the core orchestration mechanism for pi-supergsd's skills — brainstorming, writing-plans, requesting-code-review, and writing-skills all use `push-task`. Moving task tooling into pi-supergsd makes it self-contained: skills and the tooling they depend on live in one extension.

## Design

### pi-supergsd gains two files: `index.ts` + `index.test.ts`

Flat structure matching pi-navigator's pattern. Implementation in `index.ts`, black-box tests in `index.test.ts` importing through `./index.js`:

```
// ── Entry types ──
TASK_ENTRY_TYPE = 'task'
TASK_DONE_ENTRY_TYPE = 'task-done'
TASK_START_ENTRY_TYPE = 'task-start'    // renamed from 'checkpoint' to avoid collision
TaskData { prompt, context }
TaskStartData { returnTo, handoff }
ReadonlySessionLike (minimal session interface)

// ── Lookup utilities ──
findActiveTask(session)     → walks parent chain, respects task-done stacking
findTaskStart(session)      → walks parent chain for task-start entries

// ── Navigation utilities (duplicated from pi-navigator) ──
findFreshTargetId(session)
findPreConversationEntry(session)
isAssistantMessageEntry(entry)

// ── push-task tool ──
createPushTaskTool(pi) → stores TASK_ENTRY_TYPE entry

// ── Commands ──
createStartTaskCommand(pi)     → finds active task, creates task-start checkpoint,
                                  injects prompt, fresh/branch navigation
createDiscardTaskCommand(pi)   → appends TASK_DONE, consumes task
createFinishTaskCommand(pi)    → navigates to task-start checkpoint (summary or
                                  last-response handoff), appends TASK_DONE
createAbortTaskCommand(pi)     → navigates to task-start checkpoint (no summary),
                                  appends TASK_DONE

// ── Registration ──
export default function register(pi) → 1 tool + 4 commands
```

Commands: `/start-task`, `/discard-task`, `/finish-task`, `/abort-task`

Entry types use `'task-start'` instead of `'checkpoint'` — no collision with pi-navigator's CHECKPOINT_ENTRY_TYPE. Both extensions are independent.

### pi-supergsd config changes

**`package.json`:**
- Add `peerDependencies`: `"@earendil-works/pi-coding-agent": "*"`, `"typebox": "*"`
- Add `pi.extensions: ["./index.ts"]`
- Add `"index.ts"`, `"index.test.ts"` to `files`

**`tsconfig.json`:**
- Add `"index.ts"`, `"index.test.ts"` to includes

### pi-navigator changes

Remove from `index.ts`:
- `createPushTaskTool`, `createStartTaskCommand`, `createDiscardTaskCommand`
- `TASK_ENTRY_TYPE`, `TASK_DONE_ENTRY_TYPE`, `TaskData`, `findActiveTask`
- Task consumption from `createReturnCommand` and `createCancelCommand`
- Task-related imports in registration

Remove from `index.test.ts`:
- All task-specific test suites (push-task, start-task, discard-task, task integration)
- Task assertions from return/cancel tests
- `assertActiveTask`, `assertNoActiveTask`, `getActiveTask` helpers
- `TASK_ENTRY_TYPE`, `TASK_DONE_ENTRY_TYPE`, `TaskData` imports

### Test coverage

`index.test.ts` for pi-supergsd ports all task-related tests from pi-navigator's `index.test.ts`, adapted for:
- Renamed commands: `/finish-task` instead of `/return`, `/abort-task` instead of `/cancel`
- Renamed entry type: `TASK_START_ENTRY_TYPE` instead of `CHECKPOINT_ENTRY_TYPE`
- Same `makeHarness` test infrastructure

### Skill patch updates

All `updater/skills/*.json` patches that add `push-task` conditionals are updated to remove the conditional — `push-task` is unconditionally available. References to `/return` are updated to `/finish-task` since navigator's `/return` won't find `task-start` entries.

**brainstorming → SKILL.md:** Remove `**If the push-task tool is available:**` header and `**Otherwise:**\nRun the Spec Self-Review checklist inline (see below.)` fallback. Update `/return` → `/finish-task` in step 3.

**writing-plans → SKILL.md:** Remove `**If the push-task tool is available:**` header and `**Otherwise:**\nRun the Self-Review checklist inline.` fallback. Update `/return` → `/finish-task`.

**requesting-code-review → SKILL.md:** Remove `**If the push-task tool is available:**` header and `**Otherwise:**\nUse the code-reviewer.md template for your review process.` fallback. Update `/return` → `/finish-task`.

**writing-skills → SKILL.md:** Three conditional blocks (RED, GREEN, REFACTOR sections). Remove `**If the push-task tool is available:**` headers and `**Otherwise:**` fallbacks from all three. Update `/return` → `/finish-task`.

Reviewer prompt templates (`spec-document-reviewer-prompt.md`, `plan-document-reviewer-prompt.md`, `code-reviewer.md`) remain unchanged — their content is already unconditional.

### Common-patch.json

No changes needed — does not reference push-task.

## Non-goals

- pi-navigator's `/return` and `/cancel` are not renamed. They remain user-driven commands.
- pi-supergsd does not add `/start-branch` or `/start-fresh`. Task branches are only started via `/start-task`.
- No shared dependency between the two extensions. Entry type strings are the only implicit contract.

## Implementation order

1. pi-navigator: remove task code (decouple first)
2. pi-supergsd: add `index.ts` + `index.test.ts`, update config
3. pi-supergsd: update skill patches, run updater
4. Verify: `npm run verify` in both projects
