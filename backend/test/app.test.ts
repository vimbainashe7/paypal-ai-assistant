import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { hasPayPalCredentials } from "../src/config.js";

describe("API", () => {
  it("reports a sandbox-ready health response", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", environment: "SANDBOX" });
  });

  it("adds standard security headers and restricts cross-origin access", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "https://untrusted.example");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("returns a clear error for unknown API routes", async () => {
    const response = await request(app).get("/api/not-a-route");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "API endpoint not found" });
  });

  it("rejects an empty assistant chat request", async () => {
    const response = await request(app).post("/api/assistant/chat").send({ message: "  " });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("message between 1 and 2,000 characters");
  });

  it("rejects assistant messages that exceed the chat input limit", async () => {
    const response = await request(app)
      .post("/api/assistant/chat")
      .send({ message: "a".repeat(2001) });

    expect(response.status).toBe(400);
  });

  it("reports malformed JSON as a client error", async () => {
    const response = await request(app)
      .post("/api/assistant/chat")
      .set("Content-Type", "application/json")
      .send('{"message":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Request body must contain valid JSON." });
  });

  it("rejects client-supplied drafts instead of treating them as confirmation", async () => {
    const response = await request(app)
      .post("/api/assistant/confirm-action")
      .send({
        draft: {
          action: "order",
          currencyCode: "USD",
          items: [{ name: "Candles", description: "", quantity: 1, unitAmount: 12 }],
          recipientEmail: null,
          needsInfo: false,
          clarification: null,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("pending action");
  });

  it("rejects invalid confirmation data before any PayPal call", async () => {
    const response = await request(app)
      .post("/api/assistant/confirm-action")
      .send({ conversationId: "invalid", actionId: "also-invalid" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("pending action");
  });

  it("rejects invalid and unsupported order amounts before requiring credentials", async () => {
    const zeroAmount = await request(app).post("/api/payments/orders").send({
      requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123123",
      amount: "0.00",
      currency: "USD",
    });
    expect(zeroAmount.status).toBe(400);

    const unsupportedCurrency = await request(app).post("/api/payments/orders").send({
      requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123124",
      amount: "10.00",
      currency: "EUR",
    });
    expect(unsupportedCurrency.status).toBe(400);

    const arbitraryRedirect = await request(app).post("/api/payments/orders").send({
      requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123125",
      amount: "10.00",
      currency: "USD",
      returnUrl: "https://attacker.example",
    });
    expect(arbitraryRedirect.status).toBe(400);
  });

  it.skipIf(hasPayPalCredentials())("rejects order creation with missing PayPal credentials", async () => {
    const response = await request(app).post("/api/payments/orders").send({
      requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123126",
      amount: "10.00",
      currency: "USD",
    });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("PayPal Sandbox credentials");
    expect(response.text).not.toContain("clientSecret");
  });

  it("validates invoice recipients, supported currency, due date, and item details", async () => {
    const response = await request(app).post("/api/payments/invoices").send({
      requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123127",
      recipientEmail: "not-an-email",
      currency: "EUR",
      items: [],
      dueDate: "2026-02-31",
    });

    expect(response.status).toBe(400);
  });

  it.skipIf(hasPayPalCredentials())("rejects invoice creation with missing PayPal credentials", async () => {
    const response = await request(app).post("/api/payments/invoices").send({
      requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123128",
      recipientEmail: "customer@example.com",
      currency: "USD",
      items: [{ name: "Consultation", quantity: 1, unitAmount: "20.00" }],
    });

    expect(response.status).toBe(503);
  });

  it.skipIf(hasPayPalCredentials())("explains how to enable sandbox transaction data", async () => {
    const response = await request(app).get("/api/transactions");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Configure PayPal sandbox credentials in .env to load account data.",
    });
  });
});
