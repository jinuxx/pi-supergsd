import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';

import registerTaskCommands, {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
  createAutoCommand,
} from './index.js';

// ── Constants (mirrors index.ts internals; strings are stable) ──

const TASK_ENTRY_TYPE = 'task';
const TASK_START_ENTRY_TYPE = 'task-start';
const TASK_DONE_ENTRY_TYPE = 'task-done';

// ── Test harness ─────────────────────────────────────────────────

function makeHarness() {
  const sm = SessionManager.inMemory();
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ customType: string; content: unknown; options?: unknown }> = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  const navigations: Array<{ targetId: string; opts?: unknown }> = [];
  const idleWaiters: Array<() => void> = [];
  const sessionShutdownHandlers: Array<() => unknown> = [];
  let cancelNextNav = false;
  let pendingMessages = false;

  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
      sentMessages.push(text);
    },
    sendMessage(
      message: { customType: string; content: unknown; display?: boolean; details?: unknown },
      options?: { triggerTurn?: boolean },
    ) {
      sentCustomMessages.push({ customType: message.customType, content: message.content, options });
      sm.appendCustomMessageEntry(
        message.customType,
        message.content as string,
        message.display ?? true,
        message.details,
      );
    },
    on(eventName: string, handler: () => unknown) {
      if (eventName === 'session_shutdown') sessionShutdownHandlers.push(handler);
    },
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const ctx = {
    waitForIdle: async () => {
      await new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    hasPendingMessages: () => pendingMessages,
    sessionManager: sm,
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
    navigateTree: async (targetId: string, opts?: unknown) => {
      navigations.push({ targetId, opts });
      if (cancelNextNav) {
        cancelNextNav = false;
        return { cancelled: true };
      }
      sm.branch(targetId);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext & { sessionManager: SessionManager };

  // ── Plumbing helpers ──────────────────────────────────────────

  async function releaseNextIdle() {
    const next = idleWaiters.shift();
    assert.ok(next, 'Expected a pending waitForIdle call.');
    next();
    // Drain microtasks so anything awaiting the released idle can proceed.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function emitSessionShutdown() {
    for (const handler of sessionShutdownHandlers) {
      await handler();
    }
  }

  function setPendingMessages(value: boolean) {
    pendingMessages = value;
  }

  function setCancelNextNav(v: boolean) {
    cancelNextNav = v;
  }

  // ── Convenience wrappers (pre-bound to pi / ctx) ───────────────

  async function runPushTask(prompt: string, context?: 'fresh' | 'branch') {
    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt, context }, undefined, undefined, ctx);
  }

  async function runStartTask() {
    const handlerP = createStartTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  async function runFinishTask() {
    const handlerP = createFinishTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  async function runDiscardTask() {
    const handlerP = createDiscardTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  async function runAbortTask() {
    const handlerP = createAbortTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  function runAuto(): Promise<void> {
    return createAutoCommand(pi).handler('', ctx) as Promise<void>;
  }

  return {
    sm,
    pi,
    ctx,
    sentMessages,
    sentCustomMessages,
    notifications,
    navigations,
    releaseNextIdle,
    flushMicrotasks,
    emitSessionShutdown,
    setPendingMessages,
    setCancelNextNav,
    runPushTask,
    runStartTask,
    runFinishTask,
    runDiscardTask,
    runAbortTask,
    runAuto,
  };
}

// ── Assistant message builders ───────────────────────────────────

type AppendMessageInput = Parameters<SessionManager['appendMessage']>[0];

function assistantMessage(text: string): AppendMessageInput {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
    model: 'test',
    provider: 'test',
  } as AppendMessageInput;
}

function abortedAssistantMessage(text: string): AppendMessageInput {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
    model: 'test',
    provider: 'test',
    stopReason: 'aborted',
  } as AppendMessageInput;
}

// ── Assertion helpers ───────────────────────────────────────────

interface TaskStartShape { returnTo: string }
interface TaskShape { prompt: string; context?: string }

function getTaskStart(sm: SessionManager): TaskStartShape | null {
  const branch = sm.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === 'custom' && e.customType === TASK_START_ENTRY_TYPE) {
      return e.data as TaskStartShape;
    }
  }
  return null;
}

function assertTaskStart(sm: SessionManager): TaskStartShape {
  const ts = getTaskStart(sm);
  assert.ok(ts, 'Expected task start, found none.');
  return ts;
}

function getActiveTask(sm: SessionManager): TaskShape | null {
  const branch = sm.getBranch();
  let skip = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === 'custom' && e.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
    } else if (e.type === 'custom' && e.customType === TASK_ENTRY_TYPE) {
      if (skip === 0) return e.data as TaskShape;
      skip--;
    }
  }
  return null;
}

function assertNoActiveTask(sm: SessionManager): void {
  const task = getActiveTask(sm);
  assert.strictEqual(task, null, `Expected no active task, but found: ${JSON.stringify(task)}`);
}

function assertNoTaskStart(sm: SessionManager): void {
  const ts = getTaskStart(sm);
  assert.strictEqual(ts, null, `Expected no task start, but found one: ${JSON.stringify(ts)}`);
}

function countCustomEntries(sm: SessionManager, customType: string): number {
  return sm
    .getEntries()
    .filter((entry) => entry.type === 'custom' && entry.customType === customType)
    .length;
}

interface Notification {
  message: string;
  type?: string;
}

function getLastNotification(
  notifications: Notification[],
  type?: string,
): Notification | null {
  for (let i = notifications.length - 1; i >= 0; i--) {
    if (type === undefined || notifications[i].type === type) {
      return notifications[i];
    }
  }
  return null;
}

function assertLastNotification(
  notifications: Notification[],
  type?: string,
  expectedMessage?: string,
): Notification {
  const n = getLastNotification(notifications, type);
  assert.ok(n, `Expected notification${type ? ` of type '${type}'` : ''}, found none.`);
  if (expectedMessage !== undefined) {
    assert.strictEqual(n.message, expectedMessage);
  }
  return n;
}
