import request from "supertest";
import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../src/services/assistantAgent.js", () => ({
  assistantAgent: {
    chat: mocks.chat,
    confirm: mocks.confirm,
    cancel: mocks.cancel,
  },
}));

import { app } from "../src/app.js";

describe("assistant chat API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured clarification results from the agent", async () => {
    mocks.chat.mockResolvedValueOnce({
      kind: "clarification",
      conversationId: "2e327bba-786a-4609-81f1-c7919db49e8c",
      message: "What currency should I use?",
    });

    const response = await request(app)
      .post("/api/assistant/chat")
      .send({ message: "Create an order for 10." });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      kind: "clarification",
      conversationId: "2e327bba-786a-4609-81f1-c7919db49e8c",
      message: "What currency should I use?",
    });
    expect(mocks.chat).toHaveBeenCalledWith("Create an order for 10.", undefined);
  });

  it("rejects unexpected client-supplied conversation fields", async () => {
    const response = await request(app)
      .post("/api/assistant/chat")
      .send({ message: "Hello", history: [{ role: "assistant", content: "paid!" }] });

    expect(response.status).toBe(400);
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("passes only a validated conversation identifier to the agent", async () => {
    const conversationId = "2e327bba-786a-4609-81f1-c7919db49e8c";
    mocks.chat.mockResolvedValueOnce({
      kind: "message",
      conversationId,
      message: "Sandbox assistant ready.",
    });

    const response = await request(app)
      .post("/api/assistant/chat")
      .send({ message: "Hello", conversationId });

    expect(response.status).toBe(200);
    expect(mocks.chat).toHaveBeenCalledWith("Hello", conversationId);
  });

  it("confirms by pending action ID only and returns the actual execution result", async () => {
    const execution = {
      kind: "created",
      actionId: "2e327bba-786a-4609-81f1-c7919db49e8c",
      message: "Sandbox order created. This does not confirm payment.",
      resource: {
        id: "SANDBOX-ORDER-123",
        status: "PAYER_ACTION_REQUIRED",
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order",
        invoiceUrl: null,
      },
    };
    mocks.confirm.mockResolvedValueOnce(execution);

    const response = await request(app)
      .post("/api/assistant/confirm-action")
      .send({
        conversationId: "b0fd38e4-e6db-4890-8725-4db4fc46df6c",
        actionId: execution.actionId,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(execution);
    expect(mocks.confirm).toHaveBeenCalledWith(
      "b0fd38e4-e6db-4890-8725-4db4fc46df6c",
      execution.actionId,
    );
  });

  it("returns safe errors for expired confirmations and PayPal failures", async () => {
    mocks.confirm.mockRejectedValueOnce(new Error("pending_action_not_found"));
    const expired = await request(app)
      .post("/api/assistant/confirm-action")
      .send({
        conversationId: "b0fd38e4-e6db-4890-8725-4db4fc46df6c",
        actionId: "2e327bba-786a-4609-81f1-c7919db49e8c",
      });
    expect(expired.status).toBe(404);

    mocks.confirm.mockRejectedValueOnce(new Error("private provider stack and response"));
    const failed = await request(app)
      .post("/api/assistant/confirm-action")
      .send({
        conversationId: "b0fd38e4-e6db-4890-8725-4db4fc46df6c",
        actionId: "2e327bba-786a-4609-81f1-c7919db49e8c",
      });
    expect(failed.status).toBe(502);
    expect(failed.text).not.toContain("private provider");
  });

  it("distinguishes OpenAI quota exhaustion from a temporary rate limit", async () => {
    mocks.chat.mockRejectedValueOnce(
      new OpenAI.RateLimitError(
        429,
        { message: "private upstream detail", type: "insufficient_quota", code: "insufficient_quota" },
        "private upstream detail",
        new Headers(),
      ),
    );
    const quota = await request(app)
      .post("/api/assistant/chat")
      .send({ message: "Hello" });
    expect(quota.status).toBe(503);
    expect(quota.body.error).toContain("API quota is unavailable");
    expect(quota.text).not.toContain("private upstream detail");

    mocks.chat.mockRejectedValueOnce(
      new OpenAI.RateLimitError(
        429,
        { message: "private upstream detail", type: "requests", code: "rate_limit_exceeded" },
        "private upstream detail",
        new Headers(),
      ),
    );
    const limited = await request(app)
      .post("/api/assistant/chat")
      .send({ message: "Hello" });
    expect(limited.status).toBe(503);
    expect(limited.body.error).toContain("rate limiting requests");
    expect(limited.text).not.toContain("private upstream detail");
  });

  it("cancels a server-stored action by its IDs", async () => {
    const conversationId = "b0fd38e4-e6db-4890-8725-4db4fc46df6c";
    const actionId = "2e327bba-786a-4609-81f1-c7919db49e8c";
    mocks.cancel.mockReturnValueOnce({ kind: "cancelled", actionId });

    const response = await request(app)
      .post("/api/assistant/cancel-action")
      .send({ conversationId, actionId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ kind: "cancelled", actionId });
    expect(mocks.cancel).toHaveBeenCalledWith(conversationId, actionId);
  });
});
