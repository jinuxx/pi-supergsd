#!/usr/bin/env node
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
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
  return files.map((f: string) => {
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
