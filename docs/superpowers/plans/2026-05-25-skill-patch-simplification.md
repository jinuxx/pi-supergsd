# Skill Patch Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the task-tooling patches for four skills so generated skills stay closer to upstream structure and wording while still using `push-task` reliably.

**Architecture:** Update only the declarative patch definitions in `updater/skills/*.json`, keeping changes as targeted replacements against the real upstream review/subagent sections. Then regenerate `skills/`, inspect the resulting diffs in the four main `SKILL.md` files and any still-patched template files, and verify the output removes redundant command coaching and overly specific pseudo-API text.

**Tech Stack:** TypeScript-based updater workflow, JSON patch definitions, markdown skill files, Node tooling (`tsx`, `rg`, `git`)

**Roadmap:** None

**Phase:** Single-plan implementation

---

### Task 1: Re-anchor the `brainstorming` patch to the real review section

**Files:**
- Modify: `updater/skills/brainstorming.json`
- Inspect after regeneration: `skills/brainstorming/SKILL.md`
- Inspect after regeneration: `skills/brainstorming/spec-document-reviewer-prompt.md`

- [ ] **Step 1: Read the current brainstorming patch definition and confirm the exact oversized replacement block**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
p = Path('updater/skills/brainstorming.json')
data = json.loads(p.read_text())
for f in data['files']:
    if f['path'] == 'SKILL.md':
        for patch in f['patches']:
            if 'Spec self-review' in patch.get('find', '') or 'Spec self-review' in patch.get('replace', ''):
                print(patch)
PY
```
Expected: output showing the current patch that injects a numbered `push-task` workflow into checklist item 7.

- [ ] **Step 2: Replace the checklist-item patch with a minimal checklist-text patch**

Edit `updater/skills/brainstorming.json` so the current `find` / `replace` for:
```text
7. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)
```
becomes:
```text
7. **Spec self-review** — check the spec for completeness and consistency before user review
```
Do not leave any inserted numbered `push-task` steps in the checklist block.

- [ ] **Step 3: Add a second targeted patch against the real `**Spec Self-Review:**` section**

In `updater/skills/brainstorming.json`, add a `replace` patch whose `find` text is exactly:
```markdown
**Spec Self-Review:**
After writing the spec document, look at it with fresh eyes:
```
and whose `replace` text is exactly:
```markdown
**Spec Self-Review:**
After writing the spec document, use the `push-task` tool with `spec-document-reviewer-prompt.md` to request a fresh-context spec review. Act on the returned task result when you get it, then look at the spec with fresh eyes:
```
This keeps the existing checklist intact and moves task-tool guidance to the actual review section.

- [ ] **Step 4: Minimize template-file patching for the spec reviewer prompt**

In `updater/skills/brainstorming.json`, reduce `spec-document-reviewer-prompt.md` patching to the smallest set that still removes stale task/subagent wrapper wording. Preserve the current filename and the body structure unless a specific stale wrapper line must change.

Use this target as the decision rule while editing:
```text
- keep terminology clean enough for push-task use
- avoid broad structural rewrites that are not required by the simplification spec
```

- [ ] **Step 5: Regenerate just enough to inspect the result**

Run:
```bash
npm run updater
```
Expected: updater completes successfully with no unmatched patch failures.

- [ ] **Step 6: Inspect the regenerated brainstorming skill output**

Run:
```bash
rg -n 'Spec self-review|Spec Self-Review|Run `/start-task`|/finish-task' \
  skills/brainstorming/SKILL.md \
  skills/brainstorming/spec-document-reviewer-prompt.md
```
Expected:
- checklist item 7 is a short sentence only
- the real `Spec Self-Review` section now carries the task-tool guidance
- no `Run /start-task` or `/finish-task` text remains in `skills/brainstorming/SKILL.md`

- [ ] **Step 7: Checkpoint the brainstorming simplification without committing yet**

Run:
```bash
git diff -- updater/skills/brainstorming.json skills/brainstorming/SKILL.md skills/brainstorming/spec-document-reviewer-prompt.md
```
Expected: the diff is limited to the intended checklist fix, real review-section re-anchoring, and any still-justified minimal prompt-template cleanup.

### Task 2: Simplify the `writing-plans` self-review patch without rewriting the checklist

**Files:**
- Modify: `updater/skills/writing-plans.json`
- Inspect after regeneration: `skills/writing-plans/SKILL.md`
- Inspect after regeneration: `skills/writing-plans/plan-document-reviewer-prompt.md`

- [ ] **Step 1: Inspect the current `writing-plans` self-review patch**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
p = Path('updater/skills/writing-plans.json')
data = json.loads(p.read_text())
for f in data['files']:
    if f['path'] == 'SKILL.md':
        for patch in f['patches']:
            if '## Self-Review' in patch.get('find', '') or '## Self-Review' in patch.get('replace', ''):
                print(patch)
PY
```
Expected: output showing the current replacement that injects explicit `push-task(...)`, `/start-task`, and `/finish-task` instructions.

- [ ] **Step 2: Replace that patch with a prose-level intro replacement**

In `updater/skills/writing-plans.json`, change the `replace` text for the `## Self-Review` intro so it becomes exactly:
```markdown
## Self-Review

After writing the complete plan, use the `push-task` tool with `plan-document-reviewer-prompt.md` to request a fresh-context plan review. Act on the returned task result when you get it, then check the plan against the spec.
```
This must replace only the original intro paragraph, not the checklist that follows.

- [ ] **Step 3: Reduce template-file patching for the plan reviewer prompt**

In `updater/skills/writing-plans.json`, trim `plan-document-reviewer-prompt.md` patching to the smallest set needed to remove stale task/subagent wrapper wording while preserving the upstream document structure as much as possible.

- [ ] **Step 4: Regenerate the skills**

Run:
```bash
npm run updater
```
Expected: updater completes successfully with no unmatched patch failures.

- [ ] **Step 5: Inspect the regenerated `writing-plans` outputs**

Run:
```bash
rg -n 'Self-Review|Run `/start-task`|/finish-task|branch summary' \
  skills/writing-plans/SKILL.md \
  skills/writing-plans/plan-document-reviewer-prompt.md
```
Expected:
- `skills/writing-plans/SKILL.md` has prose-level task-tool guidance in the intro only
- the checklist remains intact below it
- no `Run /start-task`, `/finish-task`, or `branch summary` text remains in the main `SKILL.md`

- [ ] **Step 6: Checkpoint the `writing-plans` simplification without committing yet**

Run:
```bash
git diff -- updater/skills/writing-plans.json skills/writing-plans/SKILL.md skills/writing-plans/plan-document-reviewer-prompt.md
```
Expected: the diff shows a prose-level intro replacement in `SKILL.md` and only minimal, still-justified cleanup in the generated plan-reviewer prompt.

### Task 3: Simplify `requesting-code-review` to prose-level `push-task` wording

**Files:**
- Modify: `updater/skills/requesting-code-review.json`
- Inspect after regeneration: `skills/requesting-code-review/SKILL.md`
- Inspect after regeneration: `skills/requesting-code-review/code-reviewer.md`

- [ ] **Step 1: Inspect the current explicit workflow replacements**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
p = Path('updater/skills/requesting-code-review.json')
data = json.loads(p.read_text())
for f in data['files']:
    print('\nFILE:', f['path'])
    for patch in f['patches']:
        if any(key in str(patch) for key in ['push-task', '/start-task', '/finish-task', 'subagent', 'Task tool']):
            print(patch)
PY
```
Expected: output showing the current large replacements in both `SKILL.md` and `code-reviewer.md`.

- [ ] **Step 2: Rewrite the main review-request patch at the same abstraction level as upstream**

In `updater/skills/requesting-code-review.json`, replace the current large `replace` text for:
```text
**2. Dispatch code reviewer subagent:**

Use Task tool with `general-purpose` type, fill template at `code-reviewer.md`

**Placeholders:**
- `{DESCRIPTION}` - Brief summary of what you built
- `{PLAN_OR_REQUIREMENTS}` - What it should do
- `{BASE_SHA}` - Starting commit
- `{HEAD_SHA}` - Ending commit
```
with this exact replacement:
```text
**2. Request code review:**

Use the `push-task` tool, filling the prompt from `code-reviewer.md`.

**Placeholders:**
- `{DESCRIPTION}` - Brief summary of what you built
- `{PLAN_OR_REQUIREMENTS}` - What it should do
- `{BASE_SHA}` - Starting commit
- `{HEAD_SHA}` - Ending commit
```
This preserves upstream structure and keeps the placeholder block.

- [ ] **Step 3: Simplify the example labels and returned-result wording**

In `updater/skills/requesting-code-review.json`, replace the example block so these exact phrases are used:
```text
[Use push-task tool with review prompt]
```
instead of the current dispatch label, and:
```text
[Returned task result]:
```
instead of any subagent or `/finish-task` wording.

Keep the rest of the example body as close to upstream as possible. Do not require explicit `push-task({ ... })` pseudo-code unless the exact upstream example already operates at that level of detail.

- [ ] **Step 4: Reduce `code-reviewer.md` patching to minimal terminology cleanup**

In `updater/skills/requesting-code-review.json`, shrink `code-reviewer.md` edits so they only remove or rename stale task/subagent wrapper terminology that would be misleading after the simplification. Preserve structure wherever possible.

- [ ] **Step 5: Regenerate the skills**

Run:
```bash
npm run updater
```
Expected: updater completes successfully with no unmatched patch failures.

- [ ] **Step 6: Inspect the regenerated review-request outputs**

Run:
```bash
rg -n 'Run `/start-task`|/finish-task|branch summary|Subagent returns|Dispatch code reviewer subagent|push-task\(\{' \
  skills/requesting-code-review/SKILL.md \
  skills/requesting-code-review/code-reviewer.md
```
Expected:
- no `Run /start-task` or `/finish-task` in `skills/requesting-code-review/SKILL.md`
- no `branch summary` phrasing
- the main flow says to use the `push-task` tool, not to dispatch a subagent
- explicit `push-task({` syntax is gone unless upstream already required that level of detail somewhere else you intentionally preserved

- [ ] **Step 7: Checkpoint the `requesting-code-review` simplification without committing yet**

Run:
```bash
git diff -- updater/skills/requesting-code-review.json skills/requesting-code-review/SKILL.md skills/requesting-code-review/code-reviewer.md
```
Expected: the diff keeps the review flow at prose level, removes redundant command coaching, and avoids unnecessary structure churn in the generated reviewer prompt.

### Task 4: Simplify `writing-skills` RED/GREEN/REFACTOR wording and supporting terminology

**Files:**
- Modify: `updater/skills/writing-skills.json`
- Inspect after regeneration: `skills/writing-skills/SKILL.md`
- Inspect after regeneration: `skills/writing-skills/testing-skills-with-subagents.md`
- Inspect after regeneration: `skills/writing-skills/examples/CLAUDE_MD_TESTING.md`

- [ ] **Step 1: Inspect the current RED/GREEN/REFACTOR replacements**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
p = Path('updater/skills/writing-skills.json')
data = json.loads(p.read_text())
for f in data['files']:
    if f['path'] == 'SKILL.md':
        for patch in f['patches']:
            if any(key in str(patch) for key in ['RED:', 'REFACTOR:', 'push-task', '/start-task', '/finish-task']):
                print(patch)
PY
```
Expected: output showing the current explicit `push-task({ ... })` and command-coaching replacements.

- [ ] **Step 2: Rewrite RED to prose-level task-tool guidance**

In `updater/skills/writing-skills.json`, replace the current RED replacement with this exact text:
```markdown
### RED: Write Failing Test (Baseline)

Use the `push-task` tool to run the pressure scenario without the skill. Act on the returned task result when you get it. Document exact behavior:
- What choices did they make?
- What rationalizations did they use (verbatim)?
- Which pressures triggered violations?
```
This keeps the original checklist shape and removes API-level syntax.

- [ ] **Step 3: Rewrite GREEN and REFACTOR to the same abstraction level**

Use these exact replacement texts in `updater/skills/writing-skills.json`:

For the current `Run same scenarios WITH skill. Agent should now comply.` replacement:
```markdown
Run same scenarios WITH skill. Agent should now comply.

Use the `push-task` tool to run the same scenario with the skill loaded. Act on the returned task result when you get it, then confirm compliance.
```

For the current `### REFACTOR: Close Loopholes` replacement:
```markdown
### REFACTOR: Close Loopholes

Agent found a new rationalization? Add an explicit counter. Use the `push-task` tool to re-test with the updated scenario and skill, then act on the returned task result when you get it. Re-test until bulletproof.
```

- [ ] **Step 4: Keep supporting-file cleanup minimal**

Review the existing `testing-skills-with-subagents.md` and `examples/CLAUDE_MD_TESTING.md` patches. Keep only terminology changes that are still justified by the simplification spec. Do not expand their scope.

- [ ] **Step 5: Regenerate the skills**

Run:
```bash
npm run updater
```
Expected: updater completes successfully with no unmatched patch failures.

- [ ] **Step 6: Inspect the regenerated `writing-skills` outputs**

Run:
```bash
rg -n 'Run `/start-task`|/finish-task|push-task\(\{|subagent WITHOUT the skill|subagent returns' \
  skills/writing-skills/SKILL.md \
  skills/writing-skills/testing-skills-with-subagents.md \
  skills/writing-skills/examples/CLAUDE_MD_TESTING.md
```
Expected:
- no `Run /start-task`, `/finish-task`, or explicit `push-task({` syntax in `skills/writing-skills/SKILL.md`
- RED/GREEN/REFACTOR now use prose-level task-tool instructions
- supporting files only changed where terminology cleanup was still needed

- [ ] **Step 7: Checkpoint the `writing-skills` simplification without committing yet**

Run:
```bash
git diff -- updater/skills/writing-skills.json skills/writing-skills/SKILL.md skills/writing-skills/testing-skills-with-subagents.md skills/writing-skills/examples/CLAUDE_MD_TESTING.md
```
Expected: the diff shows RED/GREEN/REFACTOR simplified to prose-level task-tool guidance and keeps supporting-file churn limited to justified terminology cleanup.

### Task 5: Final verification of regenerated outputs and patch drift goals

**Files:**
- Modify if needed: `updater/skills/brainstorming.json`
- Modify if needed: `updater/skills/writing-plans.json`
- Modify if needed: `updater/skills/requesting-code-review.json`
- Modify if needed: `updater/skills/writing-skills.json`
- Verify: `skills/brainstorming/SKILL.md`
- Verify: `skills/writing-plans/SKILL.md`
- Verify: `skills/requesting-code-review/SKILL.md`
- Verify: `skills/writing-skills/SKILL.md`
- Verify: `skills/brainstorming/spec-document-reviewer-prompt.md`
- Verify: `skills/writing-plans/plan-document-reviewer-prompt.md`
- Verify: `skills/requesting-code-review/code-reviewer.md`
- Verify: `skills/writing-skills/testing-skills-with-subagents.md`
- Verify: `skills/writing-skills/examples/CLAUDE_MD_TESTING.md`

- [ ] **Step 1: Run the focused grep checks from the approved spec**

Run:
```bash
rg -n 'Run `/start-task`|/finish-task|branch summary' \
  skills/brainstorming/SKILL.md \
  skills/writing-plans/SKILL.md \
  skills/requesting-code-review/SKILL.md \
  skills/writing-skills/SKILL.md
```
Expected: no matches.

- [ ] **Step 2: Review the final diffs in the four main generated skill files**

Run:
```bash
git diff -- \
  skills/brainstorming/SKILL.md \
  skills/writing-plans/SKILL.md \
  skills/requesting-code-review/SKILL.md \
  skills/writing-skills/SKILL.md
```
Expected: diffs show smaller, more prose-level changes with no numbered workflow injections or redundant command coaching.

- [ ] **Step 3: Review the final diffs in the generated prompt/supporting files that must stay minimal**

Run:
```bash
git diff -- \
  skills/brainstorming/spec-document-reviewer-prompt.md \
  skills/writing-plans/plan-document-reviewer-prompt.md \
  skills/requesting-code-review/code-reviewer.md \
  skills/writing-skills/testing-skills-with-subagents.md \
  skills/writing-skills/examples/CLAUDE_MD_TESTING.md
```
Expected: diffs are limited to still-justified terminology cleanup and do not show broad structural rewrites that the simplification spec explicitly ruled out.

- [ ] **Step 4: Review the final diffs in the patch definitions themselves**

Run:
```bash
git diff -- \
  updater/skills/brainstorming.json \
  updater/skills/writing-plans.json \
  updater/skills/requesting-code-review.json \
  updater/skills/writing-skills.json
```
Expected: diffs show that the patch definitions are smaller or more targeted than before, especially around checklist injection and explicit workflow blocks.

- [ ] **Step 5: Fix any remaining drift issues discovered in review**

If any of the following remain, go back to the corresponding updater JSON file and make one more targeted patch adjustment, then rerun `npm run updater`:
- a checklist item still contains a numbered `push-task` workflow block
- a main `SKILL.md` still tells the user to run `/start-task`
- a main `SKILL.md` still mentions `/finish-task`
- a main `SKILL.md` still says `branch summary`
- a patch unnecessarily rewrites template-file structure instead of only stale terminology

- [ ] **Step 6: Run the project’s required verification sequence before the first commit**

Run:
```bash
npm run fix
npm run verify
```
Expected:
- `npm run fix` completes successfully
- `npm run verify` completes successfully, including updater regeneration, drift check, tests, and dry-run packing
- any autofixes from `npm run fix` are included in the verified working tree before commit

- [ ] **Step 7: Commit the finished simplification work once verification passes**

```bash
git add updater/skills/*.json skills docs/superpowers/plans/2026-05-25-skill-patch-simplification.md
git commit -m "refactor(skills): simplify task-based patching"
```
Expected: one final commit captures the fully verified patch-definition changes and regenerated skill outputs.
