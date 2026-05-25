# `/start-task` Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update four push-task-aware skills to use new `/start-task` command and `context` parameter instead of old `/start-fresh` pattern.

**Architecture:** All four skills are updater-generated. Source of truth is `updater/skills/*.json` — each contains `replace` patches that inject the navigator section into upstream source. Update the patch text in each JSON def, then regenerate `skills/` via `npm run updater`.

**Tech Stack:** JSON patch files, TypeScript updater (`tsx`), Node test runner

**Roadmap:** None

**Phase:** Single-plan implementation

---

### Task 1: Update brainstorming definition

**Files:**
- Modify: `updater/skills/brainstorming.json`

- [ ] **Step 1: Update the push-task patch text**

In `updater/skills/brainstorming.json`, locate the patch with `find` matching:

```
"7. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)"
```

Update the `replace` text to:
- Change `push-task({ prompt: "..." })` → `push-task({ prompt: "...", context: "fresh" })`
- Change `/start-fresh` → `/start-task` (in both the comment and the user instruction)
- Change `summary findings` → `review findings`

The new `replace` text:

```
"7. **Spec self-review** — check the spec for completeness and consistency before user review\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: \"<content from spec-document-reviewer-prompt.md>\", context: \"fresh\" })\n   The prompt must be self-contained — it cannot reference \"above\" or prior\n   conversation, because `/start-task` provides empty context.\n2. Tell the user: \"Run `/start-task` for a fresh-context review of the spec.\"\n3. After the user runs `/return`, incorporate the review findings and fix any gaps\n   in the spec before proceeding to Step 8.\n\n**Otherwise:**\nRun the Spec Self-Review checklist inline (see below)."
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('updater/skills/brainstorming.json','utf8'))" && echo "Valid JSON"
```
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add updater/skills/brainstorming.json
git commit -m "feat: update brainstorming to use /start-task and context: fresh"
```

---

### Task 2: Update writing-plans definition

**Files:**
- Modify: `updater/skills/writing-plans.json`

- [ ] **Step 1: Update the push-task patch text**

In `updater/skills/writing-plans.json`, locate the patch with `find` matching:

```
"## Self-Review\n\nAfter writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch."
```

Update the `replace` text to:
- Change `push-task({ prompt: "..." })` → `push-task({ prompt: "...", context: "fresh" })`
- Change `/start-fresh` → `/start-task`

The new `replace` text:

```
"## Self-Review\n\n**Fresh-context plan review (optional but recommended):**\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: \"<content from plan-document-reviewer-prompt.md>\", context: \"fresh\" })`\n2. Tell the user: \"Run `/start-task` for a fresh-context review of the plan.\"\n3. After `/return`, fix any gaps before committing the plan.\n\n**Otherwise:**\nRun the Self-Review checklist inline."
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('updater/skills/writing-plans.json','utf8'))" && echo "Valid JSON"
```
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add updater/skills/writing-plans.json
git commit -m "feat: update writing-plans to use /start-task and context: fresh"
```

---

### Task 3: Update requesting-code-review definition

**Files:**
- Modify: `updater/skills/requesting-code-review.json`

This skill has two patches and a language change:

- [ ] **Step 1: Update the instructions patch**

In `updater/skills/requesting-code-review.json`, locate the patch with `find` matching:

```
"**2. Dispatch code reviewer subagent:**\n\nUse Task tool with `general-purpose` type, fill template at `code-reviewer.md`\n\n**Placeholders:**\n- `{DESCRIPTION}` - Brief summary of what you built\n- `{PLAN_OR_REQUIREMENTS}` - What it should do\n- `{BASE_SHA}` - Starting commit\n- `{HEAD_SHA}` - Ending commit"
```

Update the `replace` text to:
- Add `context: "fresh"` to push-task call
- Change `/start-fresh` → `/start-task`
- Change `branch summary` → `review output`

The new `replace` text:

```
"**2. Request code review:**\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: \"<review prompt with BASE_SHA, HEAD_SHA, description>\", context: \"fresh\" })`\n2. Tell the user: \"Run `/start-task` for a fresh-context code review.\"\n3. After `/return`, read the review output and act on feedback.\n\n**Otherwise:**\nUse the code-reviewer.md template for your review process."
```

- [ ] **Step 2: Update the example patch**

Locate the patch with `find` matching:

```
"[Dispatch code reviewer subagent]\n  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types\n  PLAN_OR_REQUIREMENTS: Task 2 from docs/superpowers/plans/deployment-plan.md\n  BASE_SHA: a7981ec\n  HEAD_SHA: 3df7661\n\n[Subagent returns]:\n  Strengths: Clean architecture, real tests\n  Issues:\n    Important: Missing progress indicators\n    Minor: Magic number (100) for reporting interval\n  Assessment: Ready to proceed"
```

Update the `replace` text to:
- Add `context: "fresh"` to the push-task call
- Change `[After /return, branch summary contains]:` → `[After /return, review output]:`

The new `replace` text:

```
"[Call push-task with review prompt]\n`push-task({ prompt: \"You are a Senior Code Reviewer... [review body from code-reviewer.md, filled with BASE_SHA=a7981ec, HEAD_SHA=3df7661, DESCRIPTION=Added verifyIndex() and repairIndex() with 4 issue types, PLAN_OR_REQUIREMENTS=Task 2 from docs/superpowers/plans/deployment-plan.md]\", context: \"fresh\" })`\n\n[After /return, review output]:\n  Strengths: Clean architecture, real tests\n  Issues:\n    Important: Missing progress indicators\n    Minor: Magic number (100) for reporting interval\n  Assessment: Ready to proceed"
```

- [ ] **Step 3: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('updater/skills/requesting-code-review.json','utf8'))" && echo "Valid JSON"
```
Expected: `Valid JSON`

- [ ] **Step 4: Commit**

```bash
git add updater/skills/requesting-code-review.json
git commit -m "feat: update requesting-code-review to use /start-task, context: fresh, and verbatim language"
```

---

### Task 4: Update writing-skills definition

**Files:**
- Modify: `updater/skills/writing-skills.json`

Three patches need updating (RED, GREEN, REFACTOR). All use `context: "branch"`.

- [ ] **Step 1: Update the RED (baseline) patch**

Locate the patch with `find` matching:

```
"### RED: Write Failing Test (Baseline)\n\nRun pressure scenario with subagent WITHOUT the skill. Document exact behavior:\n- What choices did they make?\n- What rationalizations did they use (verbatim)?\n- Which pressures triggered violations?"
```

Update the `replace` text to use `context: "branch"` and `/start-task`:

```
"### RED: Write Failing Test (Baseline)\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: <pressure scenario>, context: \"branch\" })`\n2. Tell the user: \"Run `/start-task` to run the baseline scenario.\"\n3. After `/return`, document the agent's choices and rationalizations verbatim.\n\n**Otherwise:**\nRun the scenario in the current session and document the agent's behavior:\n- What choices did they make?\n- What rationalizations did they use (verbatim)?\n- Which pressures triggered violations?"
```

- [ ] **Step 2: Update the GREEN (with skill) patch**

Locate the patch with `find` matching:

```
"Run same scenarios WITH skill. Agent should now comply."
```

Update the `replace` text:

```
"Run same scenarios WITH skill. Agent should now comply.\n\n**If `push-task` is available:** Call `push-task({ prompt: \"<pressure scenario with skill loaded>\", context: \"branch\" })` and tell the user to run `/start-task`. After `/return`, confirm compliance.\n\n**Otherwise:** Run in the current session."
```

- [ ] **Step 3: Update the REFACTOR (close loopholes) patch**

Locate the patch with `find` matching:

```
"### REFACTOR: Close Loopholes\n\nAgent found new rationalization? Add explicit counter. Re-test until bulletproof."
```

Update the `replace` text:

```
"### REFACTOR: Close Loopholes\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: <updated scenario + updated skill loaded>, context: \"branch\" })`\n2. Tell the user: \"Run `/start-task` to verify the updated skill works.\"\n3. After `/return`, confirm the agent now complies and no new rationalizations appear.\n\n**Otherwise:**\nAgent found new rationalization? Add explicit counter. Re-test until bulletproof."
```

- [ ] **Step 4: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('updater/skills/writing-skills.json','utf8'))" && echo "Valid JSON"
```
Expected: `Valid JSON`

- [ ] **Step 5: Commit**

```bash
git add updater/skills/writing-skills.json
git commit -m "feat: update writing-skills to use /start-task and context: branch"
```

---

### Task 5: Regenerate skills and verify

**Files:**
- Generate: `skills/brainstorming/SKILL.md`, `skills/writing-plans/SKILL.md`, `skills/requesting-code-review/SKILL.md`, `skills/writing-skills/SKILL.md`

- [ ] **Step 1: Run the updater to regenerate skills**

```bash
npm run updater
```
Expected: Exit 0 (no patch failures — drift detection passes)

- [ ] **Step 2: Confirm only expected files changed**

```bash
git diff --stat skills/
```
Expected: Only the four target SKILL.md files listed. No unexpected changes.

- [ ] **Step 3: Verify no stale `/start-fresh` references**

```bash
grep -n "start-fresh" skills/brainstorming/SKILL.md skills/writing-plans/SKILL.md skills/requesting-code-review/SKILL.md skills/writing-skills/SKILL.md
```
Expected: No output (empty — all references migrated)

- [ ] **Step 4: Verify new references exist**

```bash
grep -c "start-task" skills/brainstorming/SKILL.md skills/writing-plans/SKILL.md skills/requesting-code-review/SKILL.md skills/writing-skills/SKILL.md
```
Expected (minimum counts):
- brainstorming: 1
- writing-plans: 1
- requesting-code-review: 1
- writing-skills: 3

- [ ] **Step 5: Verify context parameters exist**

```bash
grep -c 'context.*fresh\|context.*branch' skills/brainstorming/SKILL.md skills/writing-plans/SKILL.md skills/requesting-code-review/SKILL.md skills/writing-skills/SKILL.md
```
Expected (exact `context: "fresh"` or `context: "branch"` counts):
- brainstorming: 1
- writing-plans: 1
- requesting-code-review: 2 (instructions patch + example patch)
- writing-skills: 3

- [ ] **Step 6: Full verification gate**

```bash
npm run verify
```
Expected: All checks pass (lint → tsc → test → updater → skill drift → pack)

- [ ] **Step 7: Commit generated skills**

```bash
git add skills/
git commit -m "chore: regenerate skills after /start-task migration"
```
