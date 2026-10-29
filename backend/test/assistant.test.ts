import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCompletion: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mocks.createCompletion } };

    constructor(_options: { apiKey: string }) {}
  },
}));

vi.mock("../src/config.js", () => ({
  config: { OPENAI_API_KEY: "test-openai-key" },
}));

import { prepareWithAssistant } from "../src/services/assistant.js";

function assistantCompletion(name: string, proposal: unknown) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-prepare-draft",
              type: "function",
              function: { name, arguments: JSON.stringify(proposal) },
            },
          ],
        },
      },
    ],
  };
}

const orderDraft = {
  action: "order",
  currencyCode: "USD",
  items: [{ name: "Candles", description: "Handmade", quantity: 3, unitAmount: 18 }],
  recipientEmail: null,
  needsInfo: false,
  clarification: null,
};

describe("assistant draft preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a validated order proposal without making a PayPal tool call", async () => {
    mocks.createCompletion.mockResolvedValueOnce(
      assistantCompletion("prepare_payment_draft", orderDraft),
    );

    await expect(prepareWithAssistant("Prepare three candles at $18 each.")).resolves.toEqual(
      orderDraft,
    );

    const request = mocks.createCompletion.mock.calls[0]?.[0];
    expect(request.model).toBe("gpt-4o-mini");
    expect(request.tool_choice).toEqual({
      type: "function",
      function: { name: "prepare_payment_draft" },
    });
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0].function.name).toBe("prepare_payment_draft");
    expect(request.tools[0].function.name).not.toContain("create_order");
  });

  it("returns a clarification when information is missing", async () => {
    const clarification = {
      action: "invoice",
      currencyCode: "USD",
      items: [],
      recipientEmail: null,
      needsInfo: true,
      clarification: "What is the recipient's email address and the item price?",
    };
    mocks.createCompletion.mockResolvedValueOnce(
      assistantCompletion("prepare_payment_draft", clarification),
    );

    await expect(prepareWithAssistant("Please make an invoice.")).resolves.toEqual(clarification);
  });

  it("rejects a draft with an unsupported currency or invalid prices", async () => {
    mocks.createCompletion.mockResolvedValueOnce(
      assistantCompletion("prepare_payment_draft", {
        ...orderDraft,
        currencyCode: "EUR",
      }),
    );

    await expect(prepareWithAssistant("Create an order.")).rejects.toThrow(
      "OpenAI returned a payment draft with invalid details.",
    );
  });

  it("rejects an unexpected function response", async () => {
    mocks.createCompletion.mockResolvedValueOnce(
      assistantCompletion("create_order", orderDraft),
    );

    await expect(prepareWithAssistant("Create an order.")).rejects.toThrow(
      "OpenAI did not return a valid payment draft.",
    );
  });
});
