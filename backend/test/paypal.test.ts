import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  handleToolCall: vi.fn(),
}));

vi.mock("@paypal/agent-toolkit/openai", () => ({
  PayPalAgentToolkit: class MockPayPalAgentToolkit {
    constructor(options: unknown) {
      mocks.constructor(options);
    }

    getTools() {
      return [
        { function: { name: "create_order" } },
        { function: { name: "create_invoice" } },
      ];
    }

    handleToolCall(toolCall: unknown) {
      return mocks.handleToolCall(toolCall);
    }
  },
}));

vi.mock("../src/config.js", () => ({
  getPayPalCredentials: () => ({
    clientId: "sandbox-client-id",
    clientSecret: "sandbox-client-secret",
  }),
}));

import { createConfirmedDraft } from "../src/services/paypal.js";
import type { AssistantDraft } from "../src/services/draft.js";

const orderDraft: AssistantDraft = {
  action: "order",
  currencyCode: "USD",
  items: [{ name: "Candles", description: "Handmade", quantity: 3, unitAmount: 18 }],
  recipientEmail: null,
  needsInfo: false,
  clarification: null,
};

describe("confirmed PayPal Sandbox drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an order only when explicitly called and returns the approval link", async () => {
    mocks.handleToolCall.mockResolvedValueOnce({
      content: JSON.stringify({
        id: "SANDBOX-ORDER-123",
        links: [{ rel: "approve", href: "https://sandbox.example/approve" }],
      }),
    });

    await expect(createConfirmedDraft(orderDraft)).resolves.toEqual({
      id: "SANDBOX-ORDER-123",
      approvalUrl: "https://sandbox.example/approve",
    });

    expect(mocks.constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "sandbox-client-id",
        clientSecret: "sandbox-client-secret",
        configuration: expect.objectContaining({ context: { sandbox: true } }),
      }),
    );
    expect(mocks.handleToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        function: expect.objectContaining({
          name: "create_order",
          arguments: JSON.stringify({
            currencyCode: "USD",
            items: [
              {
                name: "Candles",
                description: "Handmade",
                quantity: 3,
                itemCost: 18,
                itemTotal: 54,
                taxPercent: 0,
              },
            ],
            discount: 0,
            shippingCost: 0,
          }),
        }),
      }),
    );
  });

  it("creates an invoice draft for the confirmed recipient without sending it", async () => {
    mocks.handleToolCall.mockResolvedValueOnce({
      content: JSON.stringify({ id: "SANDBOX-INVOICE-123" }),
    });
    const invoiceDraft: AssistantDraft = {
      ...orderDraft,
      action: "invoice",
      recipientEmail: "customer@example.com",
    };

    await expect(createConfirmedDraft(invoiceDraft)).resolves.toEqual({
      id: "SANDBOX-INVOICE-123",
      approvalUrl: null,
    });

    const toolCall = mocks.handleToolCall.mock.calls[0]?.[0];
    expect(toolCall.function.name).toBe("create_invoice");
    expect(JSON.parse(toolCall.function.arguments)).toEqual({
      currency_code: "USD",
      primary_recipients: [{ billing_info: { email_address: "customer@example.com" } }],
      items: [
        {
          name: "Candles",
          description: "Handmade",
          quantity: "3",
          unit_amount: { currency_code: "USD", value: "18.00" },
        },
      ],
    });
  });

  it("does not turn a PayPal error response into a successful result", async () => {
    mocks.handleToolCall.mockResolvedValueOnce({
      content: JSON.stringify({ error: { message: "Invalid request" } }),
    });

    await expect(createConfirmedDraft(orderDraft)).rejects.toThrow(
      "PayPal could not create the confirmed Sandbox draft.",
    );
  });
});
