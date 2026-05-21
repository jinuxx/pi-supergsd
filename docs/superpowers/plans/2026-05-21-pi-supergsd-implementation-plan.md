# pi-supergsd Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the `execute-plan` prompt to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi extension that packages curated, patched Superpowers skills for Pi users.

**Architecture:** A TypeScript Pi extension (`index.ts`) serves skills statically and injects a `system-prompt.md` guide. A Node.js updater script (`updater.ts`) fetches skills from GitHub, applies declarative patches, and writes them to `skills/` and `system-prompt.md`.

**Tech Stack:** TypeScript, Node 20+, `tsx`, native `fetch`, Node built-in test runner

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pi-supergsd",
  "version": "1.0.0",
  "description": "Superpowers skills packaged for Pi",
  "type": "module",
  "scripts": {
    "updater": "tsx updater/updater.ts",
    "test:updater": "tsx --test updater/lib/**/*.test.ts"
  },
  "pi": {
    "extensions": ["./index.ts"]
  },
  "devDependencies": {
    "tsx": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["updater/**/*.ts", "index.ts"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
*.log
.DS_Store
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` and `package-lock.json` created.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "chore: project scaffolding"
```

---

## Task 2: Shared Types

**Files:**
- Create: `updater/lib/types.ts`

- [ ] **Step 1: Write types**

```typescript
export type PatchOp =
  | { op: 'replace'; find: string; replace: string }
  | { op: 'regex-replace'; find: string; replace: string }
  | { op: 'delete-line'; find: string }
  | { op: 'delete-block'; findStart: string; findEnd: string }
  | { op: 'prepend'; text: string }
  | { op: 'append'; text: string };

export type Patch = PatchOp;

export interface SkillFile {
  path: string;
  patches: Patch[];
}

export interface SkillSource {
  repo: string;
  ref: string;
  path: string;
}

export interface SkillDefinition {
  name: string;
  source: SkillSource;
  output?: string;
  files: SkillFile[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add updater/lib/types.ts
git commit -m "feat: add updater shared types"
```

---

## Task 3: Patch Engine + Unit Tests

**Files:**
- Create: `updater/lib/patcher.ts`
- Create: `updater/lib/patcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyPatches } from './patcher.js';

describe('applyPatches', () => {
  it('returns unmatched patches when find string is missing', () => {
    const patch = { op: 'replace' as const, find: 'xyz', replace: 'abc' };
    const result = applyPatches('hello world', [patch]);
    assert.strictEqual(result.result, 'hello world');
    assert.deepStrictEqual(result.unmatched, [patch]);
  });

  it('applies replace to all occurrences', () => {
    const result = applyPatches('a b a', [
      { op: 'replace', find: 'a', replace: 'x' },
    ]);
    assert.strictEqual(result.result, 'x b x');
    assert.deepStrictEqual(result.unmatched, []);
  });

  it('applies regex-replace with capture groups', () => {
    const result = applyPatches('Hello World', [
      { op: 'regex-replace', find: 'Hello (\\w+)', replace: 'Hi $1' },
    ]);
    assert.strictEqual(result.result, 'Hi World');
    assert.deepStrictEqual(result.unmatched, []);
  });

  it('returns unmatched regex-replace when pattern missing', () => {
    const patch = { op: 'regex-replace' as const, find: '\\d+', replace: '0' };
    const result = applyPatches('no digits', [patch]);
    assert.strictEqual(result.result, 'no digits');
    assert.deepStrictEqual(result.unmatched, [patch]);
  });

  it('deletes lines containing find string', () => {
    const result = applyPatches('line1\nline2\nline3', [
      { op: 'delete-line', find: 'line2' },
    ]);
    assert.strictEqual(result.result, 'line1\nline3');
    assert.deepStrictEqual(result.unmatched, []);
  });

  it('deletes blocks from start to end line inclusive', () => {
    const result = applyPatches('start\na\nb\nend\nc', [
      { op: 'delete-block', findStart: 'start', findEnd: 'end' },
    ]);
    assert.strictEqual(result.result, 'c');
    assert.deepStrictEqual(result.unmatched, []);
  });

  it('returns unmatched delete-block when start missing', () => {
    const patch = { op: 'delete-block' as const, findStart: 'missing', findEnd: 'end' };
    const result = applyPatches('a\nb\nc', [patch]);
    assert.strictEqual(result.result, 'a\nb\nc');
    assert.deepStrictEqual(result.unmatched, [patch]);
  });

  it('prepends text', () => {
    const result = applyPatches('world', [{ op: 'prepend', text: 'hello ' }]);
    assert.strictEqual(result.result, 'hello world');
    assert.deepStrictEqual(result.unmatched, []);
  });

  it('appends text', () => {
    const result = applyPatches('hello', [{ op: 'append', text: ' world' }]);
    assert.strictEqual(result.result, 'hello world');
    assert.deepStrictEqual(result.unmatched, []);
  });

  it('applies patches in order', () => {
    const result = applyPatches('abc', [
      { op: 'replace', find: 'a', replace: 'x' },
      { op: 'replace', find: 'b', replace: 'y' },
    ]);
    assert.strictEqual(result.result, 'xyc');
    assert.deepStrictEqual(result.unmatched, []);
  });

  it('throws on invalid patch operation', () => {
    assert.throws(() => {
      applyPatches('test', [{ op: 'invalid' as unknown as Patch['op'], find: 'x', replace: 'y' }]);
    }, /Invalid patch operation/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:updater`
Expected: FAIL with "Cannot find module './patcher.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Patch, PatchResult } from './types.js';

export function applyPatches(content: string, patches: Patch[]): PatchResult {
  const unmatched: Patch[] = [];
  let result = content;

  for (const patch of patches) {
    if (patch.op === 'replace') {
      if (!result.includes(patch.find)) {
        unmatched.push(patch);
      } else {
        result = result.split(patch.find).join(patch.replace);
      }
    } else if (patch.op === 'regex-replace') {
      const regex = new RegExp(patch.find, 'g');
      if (!regex.test(result)) {
        unmatched.push(patch);
      } else {
        result = result.replace(new RegExp(patch.find, 'g'), patch.replace);
      }
    } else if (patch.op === 'delete-line') {
      const lines = result.split('\n');
      const filtered = lines.filter((line) => !line.includes(patch.find));
      if (filtered.length === lines.length) {
        unmatched.push(patch);
      } else {
        result = filtered.join('\n');
      }
    } else if (patch.op === 'delete-block') {
      const lines = result.split('\n');
      const startIdx = lines.findIndex((line) => line.includes(patch.findStart));
      const endIdx = lines.findIndex((line) => line.includes(patch.findEnd));
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
        unmatched.push(patch);
      } else {
        lines.splice(startIdx, endIdx - startIdx + 1);
        result = lines.join('\n');
      }
    } else if (patch.op === 'prepend' || patch.op === 'append') {
      result = patch.op === 'prepend' ? patch.text + result : result + patch.text;
    } else {
      throw new Error(`Invalid patch operation: ${JSON.stringify(patch)}`);
    }
  }

  return { result, unmatched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:updater`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add updater/lib/patcher.ts updater/lib/patcher.test.ts
git commit -m "feat: add patch engine with unit tests"
```

---

## Task 4: Fetcher

**Files:**
- Create: `updater/lib/fetcher.ts`

- [ ] **Step 1: Write fetcher**

```typescript
export async function fetchFile(url: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url);

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.text();
  }

  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}
```

- [ ] **Step 2: Commit**

```bash
git add updater/lib/fetcher.ts
git commit -m "feat: add GitHub raw content fetcher"
```

---

## Task 5: Updater Script

**Files:**
- Create: `updater/updater.ts`

- [ ] **Step 1: Write updater**

```typescript
#!/usr/bin/env node
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatches } from './lib/patcher.js';
import { fetchFile } from './lib/fetcher.js';
import type { SkillDefinition, Patch } from './lib/types.js';

const baseDir = dirname(fileURLToPath(import.meta.url));
const projectDir = join(baseDir, '..');
const skillsOutputDir = join(projectDir, 'skills');
const commonPatchPath = join(baseDir, 'common-patch.json');
const skillDefsDir = join(baseDir, 'skills');

function loadDefinitions(): SkillDefinition[] {
  const files = readdirSync(skillDefsDir).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    const content = readFileSync(join(skillDefsDir, f), 'utf-8');
    const def: SkillDefinition = JSON.parse(content);
    return def;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const commonPatches: Patch[] = JSON.parse(
    readFileSync(commonPatchPath, 'utf-8')
  );
  const definitions = loadDefinitions();

  let totalFiles = 0;
  let totalPatches = 0;
  let failedPatches = 0;

  for (const def of definitions) {
    console.log(`Processing: ${def.name}`);

    const outputPath = def.output
      ? join(projectDir, def.output)
      : join(skillsOutputDir, def.name);

    if (!def.output) {
      mkdirSync(outputPath, { recursive: true });
    } else if (def.output.includes('/')) {
      mkdirSync(dirname(outputPath), { recursive: true });
    }

    let outputContent = '';

    for (const file of def.files) {
      const url = `https://raw.githubusercontent.com/${def.source.repo}/${def.source.ref}/${def.source.path}/${file.path}`;
      console.log(`  Fetching: ${file.path}`);

      const raw = await fetchFile(url);
      await delay(100);

      const afterCommon = applyPatches(raw, commonPatches);
      const afterFile = applyPatches(afterCommon.result, file.patches);

      totalPatches += file.patches.length;
      failedPatches += afterFile.unmatched.length;

      for (const unmatched of afterFile.unmatched) {
        console.warn(
          `    WARNING: patch did not match in ${file.path}: ${JSON.stringify(unmatched)}`
        );
      }

      if (def.output) {
        outputContent += (outputContent ? '\n\n' : '') + afterFile.result;
      } else {
        const fileOutputPath = join(outputPath, file.path);
        mkdirSync(dirname(fileOutputPath), { recursive: true });
        writeFileSync(fileOutputPath, afterFile.result);
      }

      totalFiles++;
    }

    if (def.output && outputContent) {
      writeFileSync(outputPath, outputContent);
    }
  }

  console.log(
    `\nDone. Skills: ${definitions.length}, Files: ${totalFiles}, Patches: ${totalPatches}, Failed: ${failedPatches}`
  );

  if (failedPatches > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add updater/updater.ts
git commit -m "feat: add updater script"
```

---

## Task 6: Common Patch

**Files:**
- Create: `updater/common-patch.json`

- [ ] **Step 1: Write common patch**

```json
[
  { "op": "replace", "find": "Claude Code", "replace": "Pi" },
  { "op": "replace", "find": "the Skill tool", "replace": "the read tool" },
  { "op": "replace", "find": "superpowers:", "replace": "/skill:" },
  { "op": "replace", "find": "TodoWrite", "replace": "a todo list" },
  { "op": "regex-replace", "find": "Task\\(\"", "replace": "subagent dispatch (\"" }
]
```

- [ ] **Step 2: Commit**

```bash
git add updater/common-patch.json
git commit -m "feat: add common patch definitions"
```

---

## Task 7: Skill Definitions (Part 1)

**Files:**
- Create: `updater/skills/brainstorming.json`
- Create: `updater/skills/test-driven-development.json`
- Create: `updater/skills/systematic-debugging.json`
- Create: `updater/skills/verification-before-completion.json`

- [ ] **Step 1: Write `brainstorming.json`**

```json
{
  "name": "brainstorming",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/brainstorming"
  },
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "invoke writing-plans skill", "replace": "invoke the /skill:writing-plans command" },
        { "op": "replace", "find": "Invoke writing-plans skill", "replace": "Invoke the /skill:writing-plans command" }
      ]
    },
    { "path": "visual-companion.md", "patches": [] },
    { "path": "scripts/frame-template.html", "patches": [] },
    { "path": "scripts/helper.js", "patches": [] },
    { "path": "scripts/server.cjs", "patches": [] },
    { "path": "scripts/start-server.sh", "patches": [] },
    { "path": "scripts/stop-server.sh", "patches": [] }
  ]
}
```

- [ ] **Step 2: Write `test-driven-development.json`**

```json
{
  "name": "test-driven-development",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/test-driven-development"
  },
  "files": [
    { "path": "SKILL.md", "patches": [] },
    { "path": "testing-anti-patterns.md", "patches": [] }
  ]
}
```

- [ ] **Step 3: Write `systematic-debugging.json`**

```json
{
  "name": "systematic-debugging",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/systematic-debugging"
  },
  "files": [
    { "path": "SKILL.md", "patches": [] },
    { "path": "root-cause-tracing.md", "patches": [] },
    { "path": "defense-in-depth.md", "patches": [] },
    { "path": "condition-based-waiting.md", "patches": [] },
    { "path": "condition-based-waiting-example.ts", "patches": [] },
    { "path": "find-polluter.sh", "patches": [] }
  ]
}
```

- [ ] **Step 4: Write `verification-before-completion.json`**

```json
{
  "name": "verification-before-completion",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/verification-before-completion"
  },
  "files": [
    { "path": "SKILL.md", "patches": [] }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add updater/skills/brainstorming.json updater/skills/test-driven-development.json updater/skills/systematic-debugging.json updater/skills/verification-before-completion.json
git commit -m "feat: add skill definitions batch 1"
```

---

## Task 8: Skill Definitions (Part 2)

**Files:**
- Create: `updater/skills/requesting-code-review.json`
- Create: `updater/skills/receiving-code-review.json`
- Create: `updater/skills/finishing-a-development-branch.json`

- [ ] **Step 1: Write `requesting-code-review.json`**

```json
{
  "name": "requesting-code-review",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/requesting-code-review"
  },
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "Dispatch a code reviewer subagent to catch issues before they cascade.", "replace": "Request a code review to catch issues before they cascade." },
        { "op": "replace", "find": "Dispatch code reviewer subagent:", "replace": "Request code review:" },
        { "op": "replace", "find": "Use Task tool with `general-purpose` type, fill template at `code-reviewer.md`", "replace": "Use the code-reviewer.md template for your review process." }
      ]
    },
    {
      "path": "code-reviewer.md",
      "patches": [
        { "op": "replace", "find": "Use this template when dispatching a code reviewer subagent.", "replace": "Use this template when requesting a code review." },
        { "op": "replace", "find": "Task tool (general-purpose):", "replace": "Review request:" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write `receiving-code-review.json`**

```json
{
  "name": "receiving-code-review",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/receiving-code-review"
  },
  "files": [
    { "path": "SKILL.md", "patches": [] }
  ]
}
```

- [ ] **Step 3: Write `finishing-a-development-branch.json`**

```json
{
  "name": "finishing-a-development-branch",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/finishing-a-development-branch"
  },
  "files": [
    { "path": "SKILL.md", "patches": [] }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add updater/skills/requesting-code-review.json updater/skills/receiving-code-review.json updater/skills/finishing-a-development-branch.json
git commit -m "feat: add skill definitions batch 2"
```

---

## Task 9: Skill Definitions (Part 3)

**Files:**
- Create: `updater/skills/writing-plans.json`
- Create: `updater/skills/executing-plans.json`
- Create: `updater/skills/writing-skills.json`
- Create: `updater/skills/using-superpowers.json`

- [ ] **Step 1: Write `writing-plans.json`**

```json
{
  "name": "writing-plans",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/writing-plans"
  },
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "delete-line", "find": "If working in an isolated worktree" },
        { "op": "replace", "find": "**\"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Two execution options:**\n\n**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration\n\n**2. Inline Execution** - Execute tasks in this session using /skill:executing-plans, batch execution with checkpoints for review\n\n**Which approach?\"**\n\n**If Subagent-Driven chosen:**\n- **REQUIRED SUB-SKILL:** Use /skill:subagent-driven-development\n- Fresh subagent per task + two-stage review\n\n**If Inline Execution chosen:**\n- **REQUIRED SUB-SKILL:** Use /skill:executing-plans\n- Batch execution with checkpoints for review", "replace": "**\"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Use the `execute-plan` prompt to execute tasks sequentially.\"**" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write `executing-plans.json`**

```json
{
  "name": "executing-plans",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/executing-plans"
  },
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "delete-line", "find": "Tell your human partner that Superpowers works much better with access to subagents." },
        { "op": "delete-line", "find": "If subagents are available, use /skill:subagent-driven-development instead of this skill." },
        { "op": "delete-line", "find": "- **/skill:using-git-worktrees**" }
      ]
    }
  ]
}
```

- [ ] **Step 3: Write `writing-skills.json`**

```json
{
  "name": "writing-skills",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/writing-skills"
  },
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "Personal skills live in agent-specific directories (`~/.claude/skills` for Pi, `~/.agents/skills/` for Codex)", "replace": "Personal skills live in agent-specific directories (`~/.pi/skills` for Pi, `~/.agents/skills/` for Codex)" },
        { "op": "replace", "find": "Pressure scenario with subagents", "replace": "Pressure scenario with agent behavior" },
        { "op": "replace", "find": "subagent test harness", "replace": "test harness" },
        { "op": "replace", "find": "Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.", "replace": "Use the read tool to load skills when needed." }
      ]
    },
    { "path": "anthropic-best-practices.md", "patches": [] },
    { "path": "persuasion-principles.md", "patches": [] },
    { "path": "graphviz-conventions.dot", "patches": [] },
    { "path": "render-graphs.js", "patches": [] },
    { "path": "examples/CLAUDE_MD_TESTING.md", "patches": [] }
  ]
}
```

- [ ] **Step 4: Write `using-superpowers.json`**

```json
{
  "name": "using-superpowers",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/using-superpowers"
  },
  "output": "system-prompt.md",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "## How to Access Skills\n\n**In Pi:** Use the `Skill` tool. When you invoke a skill, its content is loaded and presented to you—follow it directly. Never use the Read tool on skill files.\n\n**In Copilot CLI:** Use the `skill` tool. Skills are auto-discovered from installed plugins. The `skill` tool works the same as Pi's `Skill` tool.\n\n**In Gemini CLI:** Skills activate via the `activate_skill` tool. Gemini loads skill metadata at session start and activates the full content on demand.\n\n**In other environments:** Check your platform's documentation for how skills are loaded.", "replace": "## How to Access Skills\n\n**In Pi:** Skills are discovered automatically via the extension's `resources_discover` event. Use the `read` tool to load skill content from the discovered skill paths. Follow skill instructions exactly once loaded." },
        { "op": "delete-block", "findStart": "## Platform Adaptation", "findEnd": "loaded automatically via GEMINI.md." },
        { "op": "replace", "find": "Invoke Skill tool", "replace": "Load skill content with the read tool" },
        { "op": "replace", "find": "Create a todo list todo per item", "replace": "Track each checklist item" }
      ]
    }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add updater/skills/writing-plans.json updater/skills/executing-plans.json updater/skills/writing-skills.json updater/skills/using-superpowers.json
git commit -m "feat: add skill definitions batch 3"
```

---

## Task 10: Extension Entry Point

**Files:**
- Create: `index.ts`

- [ ] **Step 1: Write extension**

```typescript
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on('resources_discover', () => {
    const skillDir = join(baseDir, 'skills');
    return { skillPaths: [skillDir] };
  });

  const superpowersGuide = readFileSync(
    join(baseDir, 'system-prompt.md'),
    'utf-8'
  );

  pi.on('before_agent_start', (event) => {
    return {
      systemPrompt: event.systemPrompt + '\n\n' + superpowersGuide,
    };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add index.ts
git commit -m "feat: add Pi extension entry point"
```

---

## Task 11: Run Updater and Verify

**Files:**
- Create: `skills/` (generated)
- Create: `system-prompt.md` (generated)

- [ ] **Step 1: Run updater**

Run: `npm run updater`
Expected: Output showing fetched skills, files, patches. Exit code 0.

- [ ] **Step 2: Verify directory structure**

Run:
```bash
ls skills/
```
Expected: `brainstorming`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `writing-plans`, `writing-skills`

Run:
```bash
ls system-prompt.md
```
Expected: `system-prompt.md` exists.

- [ ] **Step 3: Spot-check patched content**

Run:
```bash
grep -c "Pi" system-prompt.md
```
Expected: At least 1 occurrence.

Run:
```bash
grep -c "Claude Code" system-prompt.md
```
Expected: 0 occurrences.

Run:
```bash
grep -c "the read tool" system-prompt.md
```
Expected: At least 1 occurrence.

Run:
```bash
grep -c "/skill:" skills/systematic-debugging/SKILL.md
```
Expected: At least 1 occurrence (replacing "superpowers:").

Run:
```bash
grep -c "invoke the /skill:writing-plans command" skills/brainstorming/SKILL.md
```
Expected: At least 1 occurrence.

- [ ] **Step 4: Commit generated files**

```bash
git add skills/ system-prompt.md
git commit -m "feat: generate patched skills and system prompt"
```

---

## Task 12: Integration Verification

**Files:**
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Add top-level test script**

Modify `package.json` scripts section:

```json
"scripts": {
  "updater": "tsx updater/updater.ts",
  "test:updater": "tsx --test updater/lib/**/*.test.ts",
  "test": "npm run test:updater"
}
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All patcher tests pass.

- [ ] **Step 3: Verify extension loads syntactically**

Run: `npx tsx --check index.ts`
Expected: No syntax errors. (Type checking against `@earendil-works/pi-coding-agent` may warn if types are unavailable; that is acceptable at build time since Pi provides them at runtime.)

Alternative if `--check` is unsupported:
Run: `npx tsc --noEmit`
Expected: No errors in `updater/` files. `index.ts` may report missing types for `@earendil-works/pi-coding-agent` unless installed; this is expected and acceptable.

- [ ] **Step 4: Final commit**

```bash
git add package.json
git commit -m "chore: add test script and verify integration"
```

---

## Self-Review

**1. Spec coverage:**
- Extension entry point (`resources_discover` + `before_agent_start`) → Task 10
- Patch engine with all 6 operation types → Task 3
- Fetcher with retry/backoff → Task 4
- Updater script with discovery, common patches, per-file patches, output writing → Task 5
- Common patch → Task 6
- All 11 included skill definitions → Tasks 7–9
- `system-prompt.md` generation via `output` field → Task 9 (using-superpowers.json)
- Error handling (invalid op throws, unmatched patches warn, network errors exit non-zero) → Tasks 3, 4, 5
- Testing strategy (unit tests for patcher, integration via updater run) → Tasks 3, 11, 12

**2. Placeholder scan:**
- No "TBD", "TODO", or "implement later"
- No vague instructions like "add appropriate error handling"
- Every step contains exact code or exact commands
- No "similar to Task N" references

**3. Type consistency:**
- `Patch`, `PatchOp`, `SkillDefinition`, `SkillFile`, `SkillSource` used consistently
- `applyPatches` signature matches design: `(content: string, patches: Patch[]) => { result: string; unmatched: Patch[] }`
- File paths consistent: `updater/lib/patcher.ts`, `updater/updater.ts`, etc.

---

> **Plan complete and saved to `docs/superpowers/plans/2026-05-21-pi-supergsd-implementation-plan.md`. Use the `execute-plan` prompt to execute tasks sequentially.**
