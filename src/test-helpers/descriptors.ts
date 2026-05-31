import type {
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { extractTextContent } from "../text-content.js";

import type { TextBlock } from "../text-content.js";

export function assumeCommandContext<T extends object>(
  value: T,
): ExtensionCommandContext & T {
  return value as unknown as ExtensionCommandContext & T;
}

export function visibleEntries(entries: SessionEntry[]): BranchEntry[] {
  return entries
    .map(toBranchEntry)
    .filter((entry): entry is BranchEntry => entry !== null);
}

export type BranchEntry =
  | UserEntry
  | AssistantEntry
  | TaskEntry
  | TaskResultEntry;

export type AssistantEntry = ReturnType<typeof assistant>;

export type UserEntry = ReturnType<typeof user>;

export type TaskEntry = ReturnType<typeof task>;

export type TaskResultEntry = ReturnType<typeof taskResult>;

export const assistant = (content: string, stopReason?: string) => ({
  type: "message" as const,
  message: {
    role: "assistant" as const,
    content: [textBlock(content)],
    ...(stopReason ? { stopReason } : {}),
  },
});

export const user = (content: string) => ({
  type: "message" as const,
  message: {
    role: "user" as const,
    content: [textBlock(content)],
  },
});

export const task = (prompt: string, inherit_context = false) => ({
  type: "custom" as const,
  customType: "task" as const,
  data: { prompt, inherit_context },
});

export const taskResult = (slug: string, content?: string) => ({
  type: "custom_message" as const,
  customType: "task-result" as const,
  details: { slug },
  ...(content !== undefined ? { content: [textBlock(content)] } : {}),
});

const textBlock = (text: string): TextBlock => ({ type: "text", text });

function toBranchEntry(entry: SessionEntry): BranchEntry | null {
  switch (entry.type) {
    case "thinking_level_change":
    case "model_change":
    case "session_info":
    case "label":
      return null;
    case "message":
      if (entry.message.role === "user") {
        return user(textContent(entry.message.content));
      }
      if (entry.message.role === "assistant") {
        return assistant(
          textContent(entry.message.content),
          visibleStopReason(entry.message.stopReason),
        );
      }
      return null;
    case "custom":
      return entry.customType === "task" && isTaskData(entry.data)
        ? task(entry.data.prompt, entry.data.inherit_context)
        : null;
    case "custom_message":
      if (entry.customType !== "task-result" || !hasSlug(entry.details)) {
        return null;
      }
      return taskResult(
        entry.details.slug,
        textContent(entry.content) || undefined,
      );
    default:
      return null;
  }
}

function textContent(content: unknown): string {
  return extractTextContent(content, "") ?? "";
}

function visibleStopReason(stopReason: unknown): string | undefined {
  return typeof stopReason === "string" && stopReason !== "stop"
    ? stopReason
    : undefined;
}

function isTaskData(
  value: unknown,
): value is { prompt: string; inherit_context: boolean } {
  return (
    isRecord(value) &&
    typeof value.prompt === "string" &&
    typeof value.inherit_context === "boolean"
  );
}

function hasSlug(value: unknown): value is { slug: string } {
  return isRecord(value) && typeof value.slug === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
