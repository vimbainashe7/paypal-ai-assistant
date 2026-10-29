import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatCompletion,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { AssistantAgent } from "../src/services/assistantAgent.js";
import type { PayPalCreatedResource } from "../src/services/paypalRest.js";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  executeOrder: vi.fn(),
  executeInvoice: vi.fn(),
  listTransactions: vi.fn(),
  getInvoiceStatus: vi.fn(),
}));

function createAgent(): AssistantAgent {
  return new AssistantAgent({
    complete: mocks.complete,
    executeOrder: mocks.executeOrder,
    executeInvoice: mocks.executeInvoice,
    listTransactions: mocks.listTransactions,
    getInvoiceStatus: mocks.getInvoiceStatus,
    now: Date.now,
  });
}

function completion(
  message: ChatCompletion.Choice.Message,
): ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        finish_reason: message.tool_calls?.length ? "tool_calls" : "stop",
        logprobs: null,
        message,
      },
    ],
  };
}

function functionCall(name: string, args: unknown): ChatCompletionMessageToolCall {
  return {
    id: "call-test",
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

const orderProposal = {
  amount: "10.00",
  currency: "USD",
  description: "Consultation",
};

const createdOrder: PayPalCreatedResource = {
  id: "SANDBOX-ORDER-123",
  status: "PAYER_ACTION_REQUIRED",
  approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order",
  invoiceUrl: null,
};

describe("AI assistant agent workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers ordinary questions without proposing or executing a tool", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({ role: "assistant", content: "This prototype supports Sandbox orders and invoice drafts." }),
    );
    const agent = createAgent();

    await expect(agent.chat("What can this app do?")).resolves.toMatchObject({
      kind: "message",
      message: "This prototype supports Sandbox orders and invoice drafts.",
    });
    expect(mocks.executeOrder).not.toHaveBeenCalled();
    expect(mocks.executeInvoice).not.toHaveBeenCalled();
  });

  it("asks for clarification when the model identifies a missing amount", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_sandbox_order", {
            amount: null,
            currency: "USD",
            description: "Consultation",
          }),
        ],
      }),
    );
    const result = await createAgent().chat("Create a checkout order for consultation.");

    expect(result.kind).toBe("clarification");
    if (result.kind === "clarification") {
      expect(result.message).toContain("positive amount");
    }
    expect(mocks.executeOrder).not.toHaveBeenCalled();
  });

  it("asks for currency when it is missing rather than guessing", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_sandbox_order", {
            amount: "10.00",
            currency: null,
            description: null,
          }),
        ],
      }),
    );

    const result = await createAgent().chat("Create an order for ten.");
    expect(result.kind).toBe("clarification");
    if (result.kind === "clarification") {
      expect(result.message).toContain("currency");
    }
  });

  it("rejects malformed or malicious tool arguments without calling PayPal", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_sandbox_order", {
            ...orderProposal,
            url: "https://attacker.example",
          }),
        ],
      }),
    );

    await expect(createAgent().chat("Create an order.")).rejects.toThrow(
      "provider_arguments_invalid",
    );
    expect(mocks.executeOrder).not.toHaveBeenCalled();
  });

  it("rejects unsupported currency and invalid amounts rather than guessing", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("create_sandbox_order", { ...orderProposal, currency: "EUR" })],
      }),
    );
    const currencyResult = await createAgent().chat("Create a €10 order.");
    expect(currencyResult.kind).toBe("clarification");

    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("create_sandbox_order", { ...orderProposal, amount: "-10.00" })],
      }),
    );
    const invalidAmountResult = await createAgent().chat("Create a negative order.");
    expect(invalidAmountResult.kind).toBe("clarification");
    expect(mocks.executeOrder).not.toHaveBeenCalled();
  });

  it("proposes the exact order and does not create it before explicit confirmation", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("create_sandbox_order", orderProposal)],
      }),
    );
    const agent = createAgent();

    const result = await agent.chat("Create a $10 Sandbox checkout order for consultation.");

    expect(result.kind).toBe("confirmation_required");
    expect(result.message).toContain("USD 10.00");
    expect(result.message).toContain("Consultation");
    expect(mocks.executeOrder).not.toHaveBeenCalled();
    if (result.kind !== "confirmation_required") {
      throw new Error("Expected a confirmation proposal.");
    }

    expect(mocks.executeOrder).not.toHaveBeenCalled();
    mocks.executeOrder.mockResolvedValueOnce(createdOrder);
    await expect(
      agent.confirm(result.conversationId, result.proposedAction.actionId),
    ).resolves.toMatchObject({
      kind: "created",
      resource: createdOrder,
      action: {
        amount: "10.00",
        currency: "USD",
        description: "Consultation",
      },
    });
    expect(mocks.executeOrder).toHaveBeenCalledWith({
      requestId: result.proposedAction.actionId,
      amount: "10.00",
      currency: "USD",
      description: "Consultation",
    });
    expect(mocks.executeOrder).toHaveBeenCalledTimes(1);
  });

  it("does not allow a different conversation to confirm a pending action", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("create_sandbox_order", orderProposal)],
      }),
    );
    const agent = createAgent();
    const result = await agent.chat("Create a $10 Sandbox order.");
    if (result.kind !== "confirmation_required") {
      throw new Error("Expected a confirmation proposal.");
    }

    await expect(
      agent.confirm("76b6dadd-ffcb-42f5-a9fd-fc62e864eeda", result.proposedAction.actionId),
    ).rejects.toThrow("pending_action_not_found");
    expect(mocks.executeOrder).not.toHaveBeenCalled();
  });

  it("cancels a pending action so it cannot later be confirmed", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("create_sandbox_order", orderProposal)],
      }),
    );
    const agent = createAgent();
    const proposal = await agent.chat("Create a $10 Sandbox order.");
    if (proposal.kind !== "confirmation_required") {
      throw new Error("Expected a confirmation proposal.");
    }

    expect(
      agent.cancel(proposal.conversationId, proposal.proposedAction.actionId),
    ).toEqual({ kind: "cancelled", actionId: proposal.proposedAction.actionId });
    await expect(
      agent.confirm(proposal.conversationId, proposal.proposedAction.actionId),
    ).rejects.toThrow("pending_action_not_found");
    expect(mocks.executeOrder).not.toHaveBeenCalled();
  });

  it("creates an invoice proposal only when recipient and invoice details validate", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_invoice", {
            amount: "45.00",
            currency: "USD",
            description: "Consulting",
            recipientEmail: "customer@example.com",
            dueDate: null,
          }),
        ],
      }),
    );
    const result = await createAgent().chat("Prepare a $45 USD invoice for consulting to customer@example.com.");

    expect(result.kind).toBe("confirmation_required");
    if (result.kind === "confirmation_required") {
      expect(result.proposedAction).toMatchObject({
        type: "create_invoice",
        amount: "45.00",
        currency: "USD",
        recipientEmail: "customer@example.com",
        description: "Consulting",
      });
    }
    expect(mocks.executeInvoice).not.toHaveBeenCalled();
  });

  it("clarifies missing invoice recipient and rejects invalid recipient addresses", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_invoice", {
            amount: "45.00",
            currency: "USD",
            description: "Consulting",
            recipientEmail: null,
            dueDate: null,
          }),
        ],
      }),
    );
    expect((await createAgent().chat("Invoice $45 for consulting.")).kind).toBe("clarification");

    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_invoice", {
            amount: "45.00",
            currency: "USD",
            description: "Consulting",
            recipientEmail: "not-an-email",
            dueDate: null,
          }),
        ],
      }),
    );
    expect((await createAgent().chat("Invoice $45 to invalid address.")).kind).toBe(
      "clarification",
    );
    expect(mocks.executeInvoice).not.toHaveBeenCalled();
  });

  it("executes a confirmed action once and returns the cached result on duplicate confirmation", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("create_sandbox_order", orderProposal)],
      }),
    );
    mocks.executeOrder.mockResolvedValueOnce(createdOrder);
    const agent = createAgent();
    const proposed = await agent.chat("Create a $10 order.");
    if (proposed.kind !== "confirmation_required") {
      throw new Error("Expected a confirmation proposal.");
    }

    const first = await agent.confirm(proposed.conversationId, proposed.proposedAction.actionId);
    const duplicate = await agent.confirm(
      proposed.conversationId,
      proposed.proposedAction.actionId,
    );
    expect(duplicate).toEqual(first);
    expect(mocks.executeOrder).toHaveBeenCalledTimes(1);
    expect(first.message).toContain("does not confirm payment");
  });

  it("returns no success-shaped result when a confirmed PayPal action fails", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("create_sandbox_order", orderProposal)],
      }),
    );
    mocks.executeOrder.mockRejectedValueOnce(new Error("provider details"));
    const agent = createAgent();
    const proposed = await agent.chat("Create a $10 order.");
    if (proposed.kind !== "confirmation_required") {
      throw new Error("Expected a confirmation proposal.");
    }

    await expect(
      agent.confirm(proposed.conversationId, proposed.proposedAction.actionId),
    ).rejects.toThrow("provider details");
    await expect(
      agent.confirm(proposed.conversationId, proposed.proposedAction.actionId),
    ).rejects.toThrow("action_failed_do_not_retry");
    expect(mocks.executeOrder).toHaveBeenCalledTimes(1);
  });

  it("uses the invoice creation operation only after explicit confirmation", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_invoice", {
            amount: "45.00",
            currency: "USD",
            description: "Consulting",
            recipientEmail: "customer@example.com",
            dueDate: null,
          }),
        ],
      }),
    );
    const agent = createAgent();
    const proposal = await agent.chat("Prepare a $45 invoice for consulting to customer@example.com.");
    expect(mocks.executeInvoice).not.toHaveBeenCalled();
    if (proposal.kind !== "confirmation_required") {
      throw new Error("Expected an invoice confirmation proposal.");
    }

    mocks.executeInvoice.mockResolvedValueOnce({
      id: "SANDBOX-INVOICE-123",
      status: "DRAFT",
      approvalUrl: null,
      invoiceUrl: null,
    });
    await agent.confirm(proposal.conversationId, proposal.proposedAction.actionId);
    expect(mocks.executeInvoice).toHaveBeenCalledWith({
      requestId: proposal.proposedAction.actionId,
      recipientEmail: "customer@example.com",
      currency: "USD",
      items: [{ name: "Consulting", quantity: 1, unitAmount: "45.00" }],
    });
    expect(mocks.executeInvoice).toHaveBeenCalledTimes(1);
  });

  it("summarizes only transaction data returned by the trusted read service", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("list_application_transactions", { periodDays: 31 }),
        ],
      }),
    );
    mocks.listTransactions.mockResolvedValueOnce({
      type: "transaction_summary",
      environment: "SANDBOX",
      periodDays: 31,
      count: 2,
      grossByCurrency: [{ currency: "USD", amount: "32.50" }],
    });

    await expect(createAgent().chat("Summarize recent transactions.")).resolves.toMatchObject({
      kind: "read_result",
      message: expect.stringContaining("2 successful transactions"),
      data: { count: 2, grossByCurrency: [{ currency: "USD", amount: "32.50" }] },
    });
    expect(mocks.listTransactions).toHaveBeenCalledWith(31);
    expect(mocks.executeOrder).not.toHaveBeenCalled();
  });

  it("reads a requested invoice status and does not invent a reason for nonpayment", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("get_invoice_status", { invoiceId: "INV-123" })],
      }),
    );
    mocks.getInvoiceStatus.mockResolvedValueOnce({
      type: "invoice_status",
      environment: "SANDBOX",
      invoiceId: "INV-123",
      status: "SENT",
      dueAmount: "45.00",
      dueCurrency: "USD",
    });

    const result = await createAgent().chat("Why has invoice INV-123 not been paid?");
    expect(result.kind).toBe("read_result");
    expect(result.message).toContain("status SENT");
    expect(result.message).toContain("does not establish why");
    expect(mocks.getInvoiceStatus).toHaveBeenCalledWith("INV-123");
    expect(mocks.executeInvoice).not.toHaveBeenCalled();
  });

  it("rejects malformed read-tool arguments without calling PayPal", async () => {
    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [functionCall("get_invoice_status", { invoiceId: "../../other" })],
      }),
    );

    await expect(createAgent().chat("Check invoice status.")).rejects.toThrow(
      "provider_arguments_invalid",
    );
    expect(mocks.getInvoiceStatus).not.toHaveBeenCalled();
  });

  it("does not expose model-provider errors or accept multiple tool calls", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("private provider response"));
    await expect(createAgent().chat("Hello")).rejects.toThrow("private provider response");

    mocks.complete.mockResolvedValueOnce(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          functionCall("create_sandbox_order", orderProposal),
          functionCall("create_sandbox_order", orderProposal),
        ],
      }),
    );
    await expect(createAgent().chat("Create two orders.")).rejects.toThrow(
      "provider_response_invalid",
    );
    expect(mocks.executeOrder).not.toHaveBeenCalled();
  });
});
