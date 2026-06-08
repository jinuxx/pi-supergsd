import * as piAi from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

import { extractTextContent } from "../text-content.js";
import type { MockLLM, MockLLMDescriptor } from "./mock-llm.js";
import type { MockUserAction } from "./mock-user.js";

const registrations = new WeakMap<FauxProvider, piAi.FauxProviderRegistration>();

export const FAUX_PROVIDER = "supergsd-test";

export const FAUX_MODEL: Model<string> = {
  id: "deterministic",
  name: "Deterministic Test Model",
  api: "supergsd-test-api",
  provider: FAUX_PROVIDER,
  baseUrl: "memory://supergsd-test",
  reasoning: true,
  thinkingLevelMap: { off: null, low: "low", medium: "medium", high: "high" },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 4096,
};

export const FAUX_ALT_MODEL: Model<string> = {
  ...FAUX_MODEL,
  id: "alternate",
  name: "Alternate Test Model",
};

export type FauxStreamCall = {
  model: string;
  reasoning?: SimpleStreamOptions["reasoning"];
};

export class FauxProvider {
  constructor(
    private readonly llm: MockLLM,
    private readonly matchAssistantActions: (text: string) => MockUserAction[],
  ) {
    registrations.set(
      this,
      piAi.registerFauxProvider({
        api: FAUX_MODEL.api,
        provider: FAUX_PROVIDER,
        tokenSize: { min: 1, max: 1 },
        models: [FAUX_MODEL, FAUX_ALT_MODEL].map((model) => ({
          id: model.id,
          name: model.name,
          reasoning: model.reasoning,
          input: [...model.input],
          cost: model.cost,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        })),
      }),
    );
  }

  readonly streamCalls: FauxStreamCall[] = [];

  stream(model: Model<string>, context: Context, options?: SimpleStreamOptions) {
    this.streamCalls.push({
      model: `${model.provider}/${model.id}`,
      reasoning: options?.reasoning,
    });

    const lastUser = [...context.messages].reverse().find((message) => message.role === "user");
    const promptText = extractTextContent(lastUser?.content ?? "") ?? "";
    const responses = this.llm.matchPrompt(promptText);

    const registration = registrations.get(this);
    if (!registration) throw new Error("Faux provider registration missing.");

    const message = maybeRewriteAssistantEsc(
      makeAssistantMessage(responses),
      this.matchAssistantActions,
    );
    registration.setResponses([message]);

    return piAi.streamSimple(model, context, options);
  }

  unregister(): void {
    const registration = registrations.get(this);
    if (!registration) return;
    registration.unregister();
    registrations.delete(this);
  }
}

function maybeRewriteAssistantEsc(
  message: AssistantMessage,
  matchAssistantActions: (text: string) => MockUserAction[],
): AssistantMessage {
  const visibleText = extractTextContent(message.content, "") ?? "";
  const shouldAbort = matchAssistantActions(visibleText).some(
    (action) => action.type === "user-esc",
  );

  if (!shouldAbort) return message;

  return piAi.fauxAssistantMessage("", { stopReason: "aborted" });
}

function makeAssistantMessage(responses: MockLLMDescriptor[]): AssistantMessage {
  const content = responses.map((descriptor, index) => {
    switch (descriptor.type) {
      case "response:text":
        return piAi.fauxText(descriptor.text);
      case "response:thinking":
        return piAi.fauxThinking(descriptor.text);
      case "response:push-task":
        return piAi.fauxToolCall(
          "push-task",
          {
            prompt: descriptor.prompt,
            inherit_context: descriptor.inherit_context,
            ...(descriptor.model !== undefined ? { model: descriptor.model } : {}),
            ...(descriptor.thinking_level !== undefined
              ? { thinking_level: descriptor.thinking_level }
              : {}),
          },
          { id: `call-${index + 1}` },
        );
    }
  });

  return piAi.fauxAssistantMessage(content, {
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
  });
}
