import type { SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';

import { extractTextContent } from '../text-content.js';

import type { MatchDescriptor_, ReactionDescriptor, ResponseDescriptor } from './descriptors.js';

export function scanAndReact(
  sessionManager: SessionManager,
  reactions: Array<[MatchDescriptor_, ReactionDescriptor | ResponseDescriptor | ResponseDescriptor[]]>,
  seenIds: Set<string>,
  runtime: ReactionRuntime,
): boolean {
  let reacted = false;
  for (const entry of sessionManager.getBranch()) {
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    for (const [match, reaction] of reactions) {
      if (!entryMatches(entry, match)) continue;
      applyReaction(reaction, runtime);
      reacted = true;
      break;
    }
  }
  return reacted;
}

export interface ReactionRuntime {
  /** Append a user message directly to the session manager. */
  appendUserMessage(text: string): void;
  /** Append an assistant message directly to the session manager. */
  appendAssistantMessage(text: string, stopReason?: string): void;
  /** Append a custom task entry to the session manager. */
  appendTaskEntry(prompt: string, inherit_context: boolean): void;
  /** Cancel the next navigation. */
  cancelNextNavigation(): void;
  /** Trigger session shutdown (emitted to extensions). */
  triggerShutdown(): void;
  /** Fire /auto again (will warn if already running). */
  runAutoAgain(): void;
}

function entryMatches(entry: SessionEntry, match: MatchDescriptor_): boolean {
  if (match.type === 'match:prompt') {
    if (entry.type !== 'message' || entry.message.role !== 'user') return false;
    return (extractTextContent(entry.message.content, '') ?? '').includes(match.text);
  }

  if (match.type === 'match:queued-task') {
    if (entry.type !== 'custom' || entry.customType !== 'task') return false;
    const data = readTaskData(entry.data);
    return data !== null
      && data.prompt.includes(match.prompt)
      && data.inherit_context === match.inherit_context;
  }

  if (match.type === 'message') {
    if (entry.type !== 'message') return false;
    if (entry.message.role !== match.message.role) return false;
    return ((extractTextContent(entry.message.content, '') ?? '').includes(extractTextContent(match.message.content, '') ?? ''));
  }

  return false;
}

function readTaskData(data: unknown): { prompt: string; inherit_context: boolean } | null {
  if (!isRecord(data)) return null;
  if (typeof data.prompt !== 'string' || typeof data.inherit_context !== 'boolean') return null;
  return { prompt: data.prompt, inherit_context: data.inherit_context };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function applyReaction(
  reaction: ReactionDescriptor | ResponseDescriptor | ResponseDescriptor[],
  runtime: ReactionRuntime,
): void {
  const reactions = Array.isArray(reaction) ? reaction : [reaction];

  for (const item of reactions) {
    switch (item.type) {
      case 'user-esc':
        runtime.cancelNextNavigation();
        break;
      case 'user-ctrl-c':
        runtime.triggerShutdown();
        break;
      case 'user-runs-auto':
        runtime.runAutoAgain();
        break;
      case 'response:text':
        runtime.appendAssistantMessage(item.text);
        break;
      case 'response:thinking':
        runtime.appendAssistantMessage(item.text);
        break;
      case 'response:aborted':
        runtime.appendAssistantMessage(item.text, 'aborted');
        break;
      case 'response:push-task':
        runtime.appendTaskEntry(item.prompt, item.inherit_context);
        break;
    }
  }
}