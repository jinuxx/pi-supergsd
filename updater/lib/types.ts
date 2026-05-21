export type PatchOp =
  | { op: 'replace'; find: string; replace: string }
  | { op: 'regex-replace'; find: string; replace: string }
  | { op: 'delete-line'; find: string }
  | { op: 'delete-block'; findStart: string; findEnd: string }
  | { op: 'prepend'; text: string }
  | { op: 'append'; text: string };

export type Patch = PatchOp;

export interface PatchResult {
  result: string;
  unmatched: Patch[];
}

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
