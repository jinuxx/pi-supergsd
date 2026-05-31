import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

export interface AutoConfig {
  reactions?: Array<[MatchDescriptor_, ReactionDescriptor | ResponseDescriptor | ResponseDescriptor[]]>;
}



export type BranchEntry = UserEntry | AssistantEntry | TaskEntry | TaskResultEntry | NotificationEntry;

export type NotificationEntry = {
  type: 'notification';
  text: string;
  afterEntryId: string | null;
};

export type MatchDescriptor_ = PromptMatch | QueuedTaskMatch | UserEntry | AssistantEntry;

export type PromptMatch = { type: 'match:prompt'; text: string };

export type QueuedTaskMatch = {
  type: 'match:queued-task';
  prompt: string;
  inherit_context: boolean;
};

export type ReactionDescriptor = ControlReactionDescriptor | ResponseDescriptor | ResponseDescriptor[];

export type ControlReactionDescriptor =
  | { type: 'user-esc' }
  | { type: 'user-ctrl-c' }
  | { type: 'user-runs-auto' }
  | { type: 'user-append'; text: string };  // Append a user message as a reaction

export type ResponseDescriptor = RespondsDescriptor | ThinksDescriptor | AbortsDescriptor | PushTaskDescriptor;

export type RespondsDescriptor = { type: 'response:text'; text: string };

export type ThinksDescriptor = { type: 'response:thinking'; text: string };

export type AbortsDescriptor = { type: 'response:aborted'; text: string };

export type PushTaskDescriptor = {
  type: 'response:push-task';
  prompt: string;
  inherit_context: boolean;
};

export type AssistantEntry = {
  type: 'message';
  message: {
    role: 'assistant';
    content: TextBlock[];
    stopReason?: string;
  };
};

export type UserEntry = {
  type: 'message';
  message: {
    role: 'user';
    content: TextBlock[];
  };
};

export type TaskEntry = {
  type: 'custom';
  customType: 'task';
  data: {
    prompt: string;
    inherit_context: boolean;
  };
};

export {
  assistant,
  user,
  task,
  taskResult,
  userEsc,
  userCtrlC,
  userRunsAuto,
  notification,
  assumeCommandContext,
  prompt,
  queuedTask,
  responds,
  thinks,
  aborts,
  pushTask,
};

const assistant = (content: string, stopReason?: string): AssistantEntry => ({
  type: 'message',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    ...(stopReason ? { stopReason } : {}),
  },
});

const user = (content: string): UserEntry => ({
  type: 'message',
  message: {
    role: 'user',
    content: [{ type: 'text', text: content }],
  },
});

const task = (prompt: string, inherit_context = false): TaskEntry => ({
  type: 'custom',
  customType: 'task',
  data: { prompt, inherit_context },
});

const taskResult = (slug: string, content?: string): TaskResultEntry => ({
  type: 'custom_message',
  customType: 'task-result',
  details: { slug },
  ...(content !== undefined ? { content: [{ type: 'text', text: content }] } : {}),
});

type TaskResultEntry = {
  type: 'custom_message';
  customType: 'task-result';
  details: {
    slug: string;
  };
  content?: TextBlock[];
};

type TextBlock = {
  type: 'text';
  text: string;
};

const prompt = (text: string): PromptMatch => ({ type: 'match:prompt', text });

const queuedTask = (prompt_: string, inherit_context = false): QueuedTaskMatch => ({
  type: 'match:queued-task',
  prompt: prompt_,
  inherit_context,
});

const responds = (text: string): RespondsDescriptor => ({ type: 'response:text', text });

const thinks = (text: string): ThinksDescriptor => ({ type: 'response:thinking', text });

const aborts = (text: string): AbortsDescriptor => ({ type: 'response:aborted', text });

const pushTask = (prompt_: string, inherit_context = false): PushTaskDescriptor => ({
  type: 'response:push-task',
  prompt: prompt_,
  inherit_context,
});

const userEsc = (): { type: 'user-esc' } => ({ type: 'user-esc' });

const userCtrlC = (): { type: 'user-ctrl-c' } => ({ type: 'user-ctrl-c' });

const userRunsAuto = (): { type: 'user-runs-auto' } => ({ type: 'user-runs-auto' });

const notification = (text: string): NotificationEntry => ({
  type: 'notification',
  text,
  afterEntryId: null,
});

function assumeCommandContext<T extends object>(value: T): ExtensionCommandContext & T {
  return value as unknown as ExtensionCommandContext & T;
}