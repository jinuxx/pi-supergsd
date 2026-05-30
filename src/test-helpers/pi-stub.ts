import {
  SessionManager,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';

export class PiStub implements Partial<ExtensionAPI> {
  constructor(private readonly sessionManager: SessionManager) {}

  private readonly sessionShutdownHandlers: Array<() => unknown> = [];
  private readonly triggeredCustomMessages = new Set<string>();
  private readonly triggeredUserMessages = new Set<string>();

  readonly on: ExtensionAPI['on'] = ((eventName: string, handler: () => unknown) => {
    if (eventName === 'session_shutdown') this.sessionShutdownHandlers.push(handler);
  }) as ExtensionAPI['on'];

  appendEntry(customType: string, data?: unknown): void {
    this.sessionManager.appendCustomEntry(customType, data);
  }

  sendUserMessage(
    content: Parameters<ExtensionAPI['sendUserMessage']>[0],
  ): void {
    const text = extractContentText(content) ?? '';
    this.sessionManager.appendMessage(makeUserMessage(text, Date.now()));
    const branch = this.sessionManager.getBranch();
    const last = branch[branch.length - 1];
    if (last) this.triggeredUserMessages.add(last.id);
  }

  sendMessage(
    message: Parameters<ExtensionAPI['sendMessage']>[0],
    options?: Parameters<ExtensionAPI['sendMessage']>[1],
  ): void {
    this.sessionManager.appendCustomMessageEntry(
      message.customType,
      message.content,
      message.display ?? true,
      message.details,
    );

    if (options?.triggerTurn) {
      const branch = this.sessionManager.getBranch();
      const last = branch[branch.length - 1];
      if (last) this.triggeredCustomMessages.add(last.id);
    }
  }

  isTriggeredCustomMessage(entryId: string): boolean {
    return this.triggeredCustomMessages.has(entryId);
  }

  isTriggeredUserMessage(entryId: string): boolean {
    return this.triggeredUserMessages.has(entryId);
  }

  triggerSessionShutdown(): void {
    for (const handler of this.sessionShutdownHandlers) {
      handler();
    }
  }
}

export function makeUserMessage(text: string, timestamp = 0): AppendedMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp };
}

export function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter(isTextBlock)
    .map(block => block.text)
    .join('');
}

type AppendedMessage = Parameters<SessionManager['appendMessage']>[0];

function isTextBlock(value: unknown): value is TextBlock {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string';
}

type TextBlock = { type: 'text'; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
