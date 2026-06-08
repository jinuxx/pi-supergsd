import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type MessageRenderer,
  type RegisteredCommand,
  type SessionEntry,
  type SessionMessageEntry,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { Box, Text } from "@earendil-works/pi-tui";

import { Type, type Static } from "typebox";

import { makeSlug } from "./slug.js";

import { firstTextContent, renderTextContent, taskResultTextContent } from "./text-content.js";

export function toolPushTask(pi: PushTaskAPI): ToolDefinition {
  return defineTool({
    name: "push-task",
    label: "Push Task",
    description: "Store a task prompt for a user-started navigation branch.",
    promptSnippet: "Store a focused task prompt for a user-started navigation branch.",
    promptGuidelines: [
      "Use push-task to hand off a self-contained task for isolated execution.",
      "Do not batch multiple push-task calls together, and do not mix push-task with other tool calls in the same turn.",
    ],
    parameters: pushTaskParameters,
    renderCall(args: PushTaskParams, theme, context) {
      const tags: string[] = [];
      if (args.model) {
        tags.push(theme.fg("dim", `[model: ${args.model}]`));
      }
      if (args.thinking_level) {
        tags.push(theme.fg("dim", `[thinking: ${args.thinking_level}]`));
      }
      if (args.inherit_context) {
        tags.push(theme.fg("warning", "[inherit]"));
      }
      const header =
        theme.fg("toolTitle", theme.bold("push-task")) +
        (tags.length > 0 ? " " + tags.join(" ") : "");

      const promptLines = args.prompt.split("\n");
      const maxLines = context.expanded ? promptLines.length : 7;
      const displayLines = promptLines
        .slice(0, maxLines)
        .map((l) => theme.fg("dim", l.trimEnd() || " "));

      if (!context.expanded && promptLines.length > maxLines) {
        const totalLines = promptLines.length;
        const moreLines = totalLines - maxLines;
        displayLines.push(
          theme.fg("muted", `... (${moreLines} more lines, ${totalLines} total, ctrl+o to expand)`),
        );
      }

      return new Text([header, ...displayLines].join("\n"), 0, 0);
    },
    renderResult() {
      return new Text("", 0, 0);
    },
    async execute(_toolCallId, params: PushTaskParams, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("Task storage aborted.");
      }

      pi.appendEntry(TASK_ENTRY_TYPE, {
        prompt: params.prompt,
        inherit_context: params.inherit_context ?? false,
        model: params.model,
        thinking_level: params.thinking_level,
      });

      if (ctx.hasUI) {
        refreshTaskStatus(ctx);
        ctx.ui.notify("Task stored. Use `/start-task` or `/auto` to start it.", "info");
      }

      return {
        content: [],
        details: {
          prompt: params.prompt,
          inherit_context: params.inherit_context ?? false,
          model: params.model,
          thinking_level: params.thinking_level,
        },
        terminate: true,
      };
    },
  });
}

export function cmdStartTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Navigate to a fresh context and inject the active task prompt",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await startTask(pi, ctx);
    },
  };
}

export function cmdDiscardTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Discard the active task without executing it",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await discardTask(pi, ctx);
    },
  };
}

export function cmdFinishTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Finish the current task and return to the task start point",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await finishTask(pi, ctx);
    },
  };
}

export function cmdAbortTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Abort the current task without finishing",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await abortTask(pi, ctx);
    },
  };
}

export function cmdAuto(pi: AutoCommandAPI): CommandOptions {
  let running = false;
  let stopCurrentRun: (() => void) | null = null;

  pi.on("session_shutdown", async () => {
    stopCurrentRun?.();
  });

  return {
    description: "Automatically run pushed task branches",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (running) {
        ctx.ui.notify("Auto is already running.", "warning");
        return;
      }

      running = true;
      let stopped = false;
      let sawTaskActivity = false;
      stopCurrentRun = () => {
        stopped = true;
      };

      const autoStatusOptions = {
        prefix: "[auto] ",
      } satisfies TaskStatusOptions;
      refreshTaskStatus(ctx, autoStatusOptions);

      try {
        while (!stopped) {
          await ctx.waitForIdle();

          // Re-check after idle: userCtrlC/stopped may have been set
          // while we were waiting (the reaction engine runs before the
          // waiter resolves). Without this, we'd fall through to task
          // processing and might call finishTask even though the session
          // was shut down.
          if (stopped) break;

          if (lastAssistantWasAborted(ctx.sessionManager)) break;

          if (pendingTask(ctx.sessionManager)) {
            const result = await startTask(pi, ctx, {
              statusPrefix: autoStatusOptions.prefix,
            });
            if (result === "cancelled") break;
            sawTaskActivity = true;
            continue;
          }

          if (currentTask(ctx.sessionManager)) {
            const result = await finishTask(pi, ctx, {
              statusPrefix: autoStatusOptions.prefix,
            });
            if (result === "cancelled") break;
            sawTaskActivity = true;
            continue;
          }

          // No pending tasks and no current task
          if (!sawTaskActivity) {
            // Never had any task activity — nothing to process
            ctx.ui.notify("No pending tasks to run.", "info");
            break;
          }

          if (!ctx.hasPendingMessages()) {
            break;
          }
        }
      } finally {
        stopCurrentRun = null;
        refreshTaskStatus(ctx);
        running = false;
      }
    },
  };
}

export const rendererTaskResult: MessageRenderer<{ slug?: string }> = (
  message,
  _options,
  theme,
): Box => {
  const label = message.details?.slug
    ? theme.fg("customMessageLabel", `${message.details.slug} result:`)
    : theme.fg("customMessageLabel", "result:");
  const text = renderTextContent(message.content);
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(`${label}\n${text}`, 0, 0));
  return box;
};

export function updateTaskStatus(
  session: ReadonlySessionLike,
  setStatus: (key: string, value: string | undefined) => void,
  theme: TaskStatusTheme,
  options: TaskStatusOptions = {},
): void {
  const prefix = options.prefix ?? "";
  const pending = pendingTask(session);
  if (pending) {
    const slug = makeSlug(pending.data.prompt);
    setStatus("task", `${prefix}${theme.fg("dim", `pending task: ${slug}`)}`);
    return;
  }

  if (currentTask(session)) {
    const prompt = findTaskPrompt(session);
    if (prompt) {
      const slug = makeSlug(prompt);
      setStatus("task", `${prefix}${theme.fg("dim", `current task: ${slug}`)}`);
    }
    return;
  }

  setStatus("task", undefined);
}

type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

type PushTaskAPI = Pick<ExtensionAPI, "appendEntry">;

interface AutoCommandAPI extends TaskCommandAPI {
  on(eventName: "session_shutdown", handler: () => unknown): void;
}

type TaskStatusTheme = Pick<Theme, "fg">;

type TaskStatusOptions = {
  prefix?: string;
};

type PushTaskParams = Static<typeof pushTaskParameters>;

type TaskActionOptions = {
  statusPrefix?: string;
};

function lastAssistantWasAborted(session: ReadonlySessionLike): boolean {
  const branch = session.getBranch();
  const last = branch[branch.length - 1];
  return (
    last?.type === "message" &&
    last.message.role === "assistant" &&
    last.message.stopReason === "aborted"
  );
}

async function startTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify("No pending task. Use push-task first.", "warning");
    return;
  }

  const inheritContext = activeTask.data.inherit_context;

  if (!inheritContext) {
    const departureLeafId = ctx.sessionManager.getLeafId()!;
    const freshTargetId = findFreshTargetId(ctx.sessionManager);
    if (!freshTargetId) {
      ctx.ui.notify("No starting point found on current branch.", "warning");
      return;
    }

    const result = await ctx.navigateTree(freshTargetId, { summarize: false });
    if (result.cancelled) return "cancelled";

    pi.appendEntry(TASK_START_ENTRY_TYPE, {
      returnTo: departureLeafId,
      ...originalTaskState(pi, ctx, activeTask.data),
    });
  } else {
    pi.appendEntry(TASK_START_ENTRY_TYPE, {
      returnTo: ctx.sessionManager.getLeafId()!,
      ...originalTaskState(pi, ctx, activeTask.data),
    });
  }

  if (activeTask.data.model) {
    await applyModelSpec(pi, ctx, activeTask.data.model, "Task model");
  }
  if (activeTask.data.thinking_level) {
    applyThinkingLevel(pi, ctx, activeTask.data.thinking_level, "Task thinking_level");
  }

  pi.sendUserMessage(activeTask.data.prompt);

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}

async function discardTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify("No pending task to discard.", "warning");
    return;
  }

  pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  ctx.ui.notify("Task discarded.", "info");

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}

async function finishTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify("Not inside task, nothing to finish.", "warning");
    return;
  }

  // Capture last assistant message content before navigation. Only text blocks
  // are valid for custom_message content; provider-specific thinking/tool blocks
  // must not be replayed into the parent branch.
  const lastAssistant = findLastEntry(ctx.sessionManager, isAssistantMessageEntry);
  const lastAssistantContent = lastAssistant
    ? taskResultTextContent(lastAssistant.message.content)
    : undefined;
  const lastAssistantId = lastAssistant?.id;

  // Find the task prompt on the current branch for the slug label
  const taskPrompt = findTaskPrompt(ctx.sessionManager);
  const slug = taskPrompt ? makeSlug(taskPrompt) : undefined;

  const result = await ctx.navigateTree(taskStart.data.returnTo, {
    summarize: false,
  });
  if (result.cancelled) return "cancelled";

  await restoreModelAndThinking(pi, ctx, taskStart);

  // Inject last assistant message after navigation
  if (lastAssistantId && lastAssistantContent !== undefined) {
    pi.sendMessage(
      {
        customType: "task-result",
        // Content is filtered to only TextContent blocks (or original string)
        content: lastAssistantContent,
        display: true,
        details: { slug },
      },
      { triggerTurn: true },
    );
  }

  if (pendingTask(ctx.sessionManager)) {
    pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  }

  const label = lastAssistantId ? "Last response attached." : "No last response to attach.";
  ctx.ui.notify(`Task finished. ${label}`, "info");

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}

async function abortTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify("Not inside task, nothing to abort.", "warning");
    return;
  }

  const result = await ctx.navigateTree(taskStart.data.returnTo, {
    summarize: false,
  });
  if (result.cancelled) return "cancelled";

  await restoreModelAndThinking(pi, ctx, taskStart);

  ctx.ui.notify("Task aborted. Branch abandoned without summary.", "info");

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}

type TaskActionResult = "cancelled" | void;

function originalTaskState(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  taskData: TaskData,
): Pick<TaskStartData, "originalModel" | "originalThinkingLevel"> {
  const changesModel = !!taskData.model;
  const changesThinkingLevel = changesModel || !!taskData.thinking_level;

  return {
    originalModel: changesModel && ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
    originalThinkingLevel: changesThinkingLevel ? pi.getThinkingLevel() : undefined,
  };
}

async function restoreModelAndThinking(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  taskStart: TaskStartEntry,
): Promise<void> {
  const { originalModel, originalThinkingLevel } = taskStart.data;

  if (originalModel) {
    await applyModelSpec(pi, ctx, originalModel, "Original model");
  }

  if (originalThinkingLevel) {
    applyThinkingLevel(pi, ctx, originalThinkingLevel, "Original thinking_level");
  }
}

async function applyModelSpec(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  modelSpec: string,
  label: string,
): Promise<void> {
  const parsed = parseModelSpec(modelSpec);
  if (!parsed) {
    ctx.ui.notify(`${label} "${modelSpec}" must be in provider/model format.`, "warning");
    return;
  }

  const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
  if (!model) {
    ctx.ui.notify(`${label} "${modelSpec}" not found. Skipping model change.`, "warning");
    return;
  }

  const success = await pi.setModel(model);
  if (!success) {
    ctx.ui.notify(
      `${label} "${modelSpec}" has no configured API key. Skipping model change.`,
      "warning",
    );
  }
}

function parseModelSpec(modelSpec: string): { provider: string; modelId: string } | null {
  const separatorIndex = modelSpec.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === modelSpec.length - 1) return null;

  return {
    provider: modelSpec.slice(0, separatorIndex),
    modelId: modelSpec.slice(separatorIndex + 1),
  };
}

function applyThinkingLevel(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  thinkingLevel: string,
  label: string,
): void {
  if (!isThinkingLevel(thinkingLevel)) {
    ctx.ui.notify(`${label} "${thinkingLevel}" is not valid. Skipping thinking change.`, "warning");
    return;
  }

  pi.setThinkingLevel(thinkingLevel);
}

type TaskCommandAPI = Pick<
  ExtensionAPI,
  | "appendEntry"
  | "sendMessage"
  | "sendUserMessage"
  | "setModel"
  | "setThinkingLevel"
  | "getThinkingLevel"
>;

function isThinkingLevel(value: string): value is ThinkingLevel {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return true;
    default:
      return false;
  }
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

function refreshTaskStatus(ctx: TaskStatusContext, options: TaskStatusOptions = {}): void {
  if (ctx.hasUI) {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme, options);
  }
}

type TaskStatusContext = Pick<ExtensionCommandContext, "hasUI" | "sessionManager" | "ui">;

/** Type guard: is the entry an assistant message with content? */
function isAssistantMessageEntry(
  entry: SessionEntry,
): entry is SessionMessageEntry & { message: { role: "assistant" } } {
  return entry.type === "message" && entry.message.role === "assistant";
}

/**
 * Find the target ID for navigating to a fresh context.
 * Returns the parent of the first model-visible entry, or the branch root as fallback.
 * Returns null if no valid target is found.
 */
function findFreshTargetId(session: ReadonlySessionLike): string | null {
  const branch = session.getBranch();
  if (branch.length === 0) return null;

  const firstVisible = findPreConversationEntry(session);
  if (firstVisible) {
    return firstVisible.parentId ?? firstVisible.id;
  }

  // Fallback: use branch root's parent (or the root itself if no parent)
  return branch[0].parentId ?? branch[0].id;
}

/**
 * Find the first model-visible entry on the current branch (closest to root).
 *
 * "Model-visible" means the entry participates in LLM context via buildSessionContext:
 * messages (user/assistant), compaction summaries, branch summaries, and custom messages.
 * Entries like thinking_level_change, model_change, custom (data-only), label, and
 * session_info are NOT visible — Pi may insert them before the conversation begins.
 *
 * Returns null if the branch has no model-visible entries (e.g., only non-visible setup
 * entries) or if there is no leaf.
 */
function findPreConversationEntry(session: ReadonlySessionLike): SessionEntry | null {
  const leafId = session.getLeafId();
  if (!leafId) return null;

  const branch = session.getBranch();
  for (const entry of branch) {
    if (
      entry.type === "message" ||
      entry.type === "compaction" ||
      entry.type === "branch_summary" ||
      entry.type === "custom_message"
    ) {
      return entry;
    }
  }

  return null;
}

/**
 * Find the user message content injected as the task prompt after the
 * most recent TASK_START entry. Returns undefined if no task is active.
 */
function findTaskPrompt(session: ReadonlySessionLike): string | undefined {
  const branch = session.getBranch();

  const startIdx = findLastEntryIndex(
    session,
    (entry) => entry.type === "custom" && entry.customType === TASK_START_ENTRY_TYPE,
  );
  if (startIdx === -1) return undefined;

  // Walk forward from TASK_START to find the next user message
  for (let i = startIdx + 1; i < branch.length; i++) {
    const entry = branch[i];
    if (entry.type === "message" && entry.message.role === "user") {
      return firstTextContent(entry.message.content);
    }
  }
  return undefined;
}

function findLastEntryIndex(
  session: ReadonlySessionLike,
  predicate: (entry: SessionEntry) => boolean,
): number {
  const branch = session.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    if (predicate(branch[i])) return i;
  }
  return -1;
}

// ── Lookup utilities ──────────────────────────────────────────────

function pendingTask(session: ReadonlySessionLike): TaskEntry | null {
  const branch = session.getBranch();
  let skip = 0;

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === TASK_START_ENTRY_TYPE) {
      return null;
    }
    if (entry.type === "custom" && entry.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
      continue;
    }
    if (isTaskEntry(entry)) {
      if (skip === 0) return entry;
      skip--;
    }
  }

  return null;
}

const TASK_DONE_ENTRY_TYPE = "task-done";

function currentTask(session: ReadonlySessionLike): TaskStartEntry | null {
  return findLastEntry(session, isTaskStartEntry) ?? null;
}

function findLastEntry<T extends SessionEntry>(
  session: ReadonlySessionLike,
  predicate: (entry: SessionEntry) => entry is T,
): T | undefined {
  const branch = session.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (predicate(entry)) return entry;
  }
  return undefined;
}

/**
 * Minimal read-only session interface needed by lookup functions.
 * Compatible with both ReadonlySessionManager (from ExtensionCommandContext)
 * and SessionManager (full mutable version).
 */
interface ReadonlySessionLike {
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
}

function isTaskEntry(entry: SessionEntry): entry is TaskEntry {
  return isCustomEntry(entry, TASK_ENTRY_TYPE, isTaskData);
}

type TaskEntry = CustomEntry<typeof TASK_ENTRY_TYPE, TaskData>;

const TASK_ENTRY_TYPE = "task";

function isTaskData(value: unknown): value is TaskData {
  return (
    isRecord(value) &&
    typeof value.prompt === "string" &&
    typeof value.inherit_context === "boolean" &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.thinking_level === undefined || typeof value.thinking_level === "string")
  );
}

interface TaskData {
  prompt: string;
  inherit_context: boolean;
  model?: string;
  thinking_level?: string;
}

function isTaskStartEntry(entry: SessionEntry): entry is TaskStartEntry {
  return isCustomEntry(entry, TASK_START_ENTRY_TYPE, isTaskStartData);
}

type TaskStartEntry = CustomEntry<typeof TASK_START_ENTRY_TYPE, TaskStartData>;

const TASK_START_ENTRY_TYPE = "task-start";

function isCustomEntry<TCustomType extends string, TData>(
  entry: SessionEntry,
  customType: TCustomType,
  isData: (value: unknown) => value is TData,
): entry is CustomEntry<TCustomType, TData> {
  return entry.type === "custom" && entry.customType === customType && isData(entry.data);
}

type CustomEntry<TCustomType extends string, TData> = SessionEntry & {
  type: "custom";
  customType: TCustomType;
  data: TData;
};

function isTaskStartData(value: unknown): value is TaskStartData {
  return (
    isRecord(value) &&
    typeof value.returnTo === "string" &&
    (value.originalModel === undefined || typeof value.originalModel === "string") &&
    (value.originalThinkingLevel === undefined || typeof value.originalThinkingLevel === "string")
  );
}

interface TaskStartData {
  returnTo: string;
  originalModel?: string;
  originalThinkingLevel?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const pushTaskParameters = Type.Object({
  prompt: Type.String({
    description: "Full prompt for the task, including all context and instructions.",
  }),
  inherit_context: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "Whether to inherit the current branch context instead of starting fresh. Never set it to true, unless explicitly requested by the user.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Optional model for the task in provider/model format, e.g. openai/gpt-5.5-codex.",
    }),
  ),
  thinking_level: Type.Optional(
    Type.Union(
      [
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
      ],
      {
        description: "Optional Pi thinking level for the task.",
      },
    ),
  ),
});
