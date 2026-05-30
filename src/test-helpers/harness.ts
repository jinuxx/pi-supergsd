import assert from 'node:assert';

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';

// eslint-disable-next-line unslop/import-control -- extension factory not available via src test-helpers import chain
import registerSuperGsd from '../../index.js';
import { assertBranchHistory, assertSessionContains } from './assertions.js';
import type { AutoConfig, BranchEntry, ResponseDescriptor } from './descriptors.js';
import { FAUX_MODEL, FAUX_PROVIDER, FauxResponseQueue } from './faux-provider.js';
import { scanAndReact } from './reactions.js';
import type { ReactionRuntime } from './reactions.js';
import { TestUI } from './ui.js';

export class TestHarness {
  private constructor(
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly ui: TestUI,
    private readonly fauxResponses: FauxResponseQueue,
  ) {
    this.cancelNextNav = false;
  }

  private cancelNextNav: boolean;

  // Reaction engine state — set by runAuto, consumed by waitForIdle
  private activeReactions: NonNullable<AutoConfig['reactions']> | null = null;
  private activeSeenIds: Set<string> | null = null;
  private activeRuntime: ReactionRuntime | null = null;

  static async create(): Promise<TestHarness> {
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const sessionManager = SessionManager.inMemory(cwd);
    const fauxResponses = new FauxResponseQueue();
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [
        (pi) => {
          pi.registerProvider(FAUX_PROVIDER, {
            api: FAUX_MODEL.api,
            baseUrl: FAUX_MODEL.baseUrl,
            apiKey: 'test-key',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline types don't match pi-ai ProviderConfig
            streamSimple: fauxResponses.stream as any,
            models: [{
              id: FAUX_MODEL.id,
              name: FAUX_MODEL.name,
              api: FAUX_MODEL.api,
              baseUrl: FAUX_MODEL.baseUrl,
              reasoning: FAUX_MODEL.reasoning,
              thinkingLevelMap: FAUX_MODEL.thinkingLevelMap,
              input: [...FAUX_MODEL.input],
              cost: FAUX_MODEL.cost,
              contextWindow: FAUX_MODEL.contextWindow,
              maxTokens: FAUX_MODEL.maxTokens,
            }],
          });
        },
        registerSuperGsd,
      ],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline types don't match pi-ai Model<any>
      model: FAUX_MODEL as any,
      thinkingLevel: 'off' as const,
      noTools: 'builtin',
    });

    const ui = new TestUI();
    const harness = new TestHarness(session, sessionManager, ui, fauxResponses);
    await session.bindExtensions({
      uiContext: ui.context,
      commandContextActions: harness.commandContextActions(),
      shutdownHandler: () => {
        // No-op: we don't want extension shutdown to terminate the process.
      },
    });
    return harness;
  }

dispose(): void {
    this.session.dispose();
  }

getStatus(): string | undefined {
    return this.ui.getStatus();
  }

assertBranchHistory(...expected: BranchEntry[]): void {
    assertBranchHistory(this.sessionManager, expected);
  }

assertSessionContains(...expected: BranchEntry[]): void {
    assertSessionContains(this.sessionManager, expected);
  }

assertNotifications(...expected: string[]): void {
    for (const text of expected) {
      assert.ok(this.ui.notifications().includes(text), `Expected notification log to include: ${text}`);
    }
  }

assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      this.ui.taskStatuses().includes(expected),
      `Expected task status history to include ${JSON.stringify(expected)}`,
    );
  }

async waitForIdle(): Promise<void> {
    await this.session.agent.waitForIdle();
  }

registeredToolNames(): string[] {
    return this.session.getAllTools().map(tool => tool.name).sort();
  }

modelName(): string | undefined {
    const model = this.session.model;
    return model ? `${model.provider}/${model.id}` : undefined;
  }

async prompt(text: string, ...responses: ResponseDescriptor[]): Promise<void> {
    this.fauxResponses.enqueue(...responses);
    await this.session.prompt(text, { expandPromptTemplates: false, source: 'test' as never });
    await this.session.agent.waitForIdle();
    this.assertNoQueuedResponses(`prompt(${JSON.stringify(text)})`);
  }

async runAuto(config: AutoConfig): Promise<void> {
    const reactions = config.reactions ?? [];
    const seenIds = new Set<string>();

    this.activeReactions = reactions;
    this.activeSeenIds = seenIds;

    const runtime: ReactionRuntime = {
      appendUserMessage: (text: string) => {
         
         
        this.sessionManager.appendMessage({
          role: 'user',
          content: [{ type: 'text' as const, text }],
          api: FAUX_MODEL.api,
          provider: FAUX_PROVIDER,
          model: FAUX_MODEL.id,
          usage: FAUX_TEST_USAGE,
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      appendAssistantMessage: (text: string, stopReason?: string) => {
         
        this.sessionManager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text' as const, text }],
          api: FAUX_MODEL.api,
          provider: FAUX_PROVIDER,
          model: FAUX_MODEL.id,
          usage: FAUX_TEST_USAGE,
          stopReason: (stopReason ?? 'stop') as 'stop' | 'aborted' | 'toolUse' | 'length' | 'error',
          timestamp: Date.now(),
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      appendTaskEntry: (prompt: string, inherit_context: boolean) => {
        this.sessionManager.appendCustomEntry('task', { prompt, inherit_context });
      },
      cancelNextNavigation: () => { this.cancelNextNav = true; },
      triggerShutdown: () => { this.triggerSessionShutdown().catch(() => {}); },
      runAutoAgain: () => {
        this.session.prompt('/auto', { expandPromptTemplates: true, source: 'test' as never }).catch(() => {});
      },
    };
    this.activeRuntime = runtime;

    try {
      await this.session.prompt('/auto', { expandPromptTemplates: true, source: 'test' as never });
    } finally {
      this.activeReactions = null;
      this.activeSeenIds = null;
      this.activeRuntime = null;
      this.cancelNextNav = false;
    }

    this.assertNoQueuedResponses('runAuto');
  }

private async triggerSessionShutdown(): Promise<void> {
    await this.session.extensionRunner.emit({
      type: 'session_shutdown',
      reason: 'quit',
    });
  }

private assertNoQueuedResponses(label: string): void {
    const remaining = this.fauxResponses.remaining();
    assert.deepStrictEqual(remaining, [], `${label} left unused faux responses queued`);
  }

private commandContextActions() {
    return {
      waitForIdle: async () => {
        // First wait for the agent to be idle so all pending operations
        // (user messages triggered by sendUserMessage, LLM calls, etc.)
        // have flushed to the session manager.
        await this.session.agent.waitForIdle();
        // Then run reactions on the settled session state.
        if (this.activeReactions && this.activeSeenIds && this.activeRuntime) {
          let reacted: boolean;
          do {
            reacted = scanAndReact(this.sessionManager, this.activeReactions, this.activeSeenIds, this.activeRuntime);
            await flushMicrotasks();
          } while (reacted);
        }
      },
      navigateTree: async (targetId: string, options?: Parameters<AgentSession['navigateTree']>[1]) => {
        if (this.cancelNextNav) {
          this.cancelNextNav = false;
          return { cancelled: true };
        }
        return this.session.navigateTree(targetId, options);
      },
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      reload: async () => {
        await this.session.reload();
      },
    };
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}

const FAUX_TEST_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
