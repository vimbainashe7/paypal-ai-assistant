import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PayPalRestService,
  PayPalServiceError,
  type PayPalCreateOrderInput,
} from "../src/services/paypalRest.js";

const credentials = {
  clientId: "sandbox-client-id",
  clientSecret: "sandbox-client-secret",
  invoicerBusinessName: "Vitso Sandbox Shop",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(token = "sandbox-access-token"): Response {
  return jsonResponse(200, { access_token: token, expires_in: 3600 });
}

const orderInput: PayPalCreateOrderInput = {
  requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123123",
  amount: "25.00",
  currency: "USD",
  description: "Consultation",
};

describe("PayPal Sandbox REST service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an order using Sandbox OAuth, fixed return URLs, and the approval link PayPal returned", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: "SANDBOX-ORDER-123",
          status: "CREATED",
          links: [
            { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=order" },
          ],
        }),
      );
    const service = new PayPalRestService(credentials, fetcher);

    await expect(service.createOrder(orderInput)).resolves.toEqual({
      id: "SANDBOX-ORDER-123",
      status: "CREATED",
      approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order",
      invoiceUrl: null,
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    );
    const orderCall = fetcher.mock.calls[1];
    expect(orderCall?.[0]).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const headers = new Headers(orderCall?.[1]?.headers);
    expect(headers.get("PayPal-Request-Id")).toBe(orderInput.requestId);
    expect(headers.get("Authorization")).toBe("Bearer sandbox-access-token");
    const payload = JSON.parse(String(orderCall?.[1]?.body));
    expect(payload.intent).toBe("CAPTURE");
    expect(payload.payment_source.paypal.experience_context).toEqual({
      user_action: "PAY_NOW",
      return_url: "http://localhost:5173/payments/return",
      cancel_url: "http://localhost:5173/payments/cancel",
    });
    expect(payload.purchase_units[0].amount).toEqual({
      currency_code: "USD",
      value: "25.00",
    });
  });

  it("creates an invoice draft with validated merchant, recipient, items, and due date", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: "SANDBOX-INVOICE-123",
          status: "DRAFT",
          links: [
            { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/123" },
            { rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#123" },
          ],
        }),
      );
    const service = new PayPalRestService(credentials, fetcher);
    const dueDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await expect(
      service.createInvoice({
        requestId: "ae1f8c56-0a08-4dcf-a617-909aa8123124",
        recipientEmail: "customer@example.com",
        currency: "USD",
        dueDate,
        items: [
          {
            name: "Candles",
            description: "Handmade",
            quantity: 2,
            unitAmount: "12.50",
          },
        ],
      }),
    ).resolves.toEqual({
      id: "SANDBOX-INVOICE-123",
      status: "DRAFT",
      approvalUrl: null,
      invoiceUrl: "https://www.sandbox.paypal.com/invoice/p/#123",
    });

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api-m.sandbox.paypal.com/v2/invoicing/invoices",
    );
    const payload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(payload.detail).toEqual({
      currency_code: "USD",
      payment_term: { due_date: `${dueDate}T00:00:00Z` },
    });
    expect(payload.invoicer).toEqual({ business_name: credentials.invoicerBusinessName });
    expect(payload.primary_recipients).toEqual([
      { billing_info: { email_address: "customer@example.com" } },
    ]);
    expect(payload.items).toEqual([
      {
        name: "Candles",
        description: "Handmade",
        quantity: "2",
        unit_amount: { currency_code: "USD", value: "12.50" },
      },
    ]);
    expect(payload.sent).toBeUndefined();
  });

  it("reuses a successful request for duplicate idempotency keys and rejects changed details", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: "SANDBOX-ORDER-123",
          status: "CREATED",
          links: [],
        }),
      );
    const service = new PayPalRestService(credentials, fetcher);

    const first = await service.createOrder(orderInput);
    await expect(service.createOrder(orderInput)).resolves.toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(
      service.createOrder({ ...orderInput, amount: "26.00" }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("refreshes an expired OAuth token once after PayPal returns 401", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("old-token"))
      .mockResolvedValueOnce(jsonResponse(401, { name: "AUTHENTICATION_FAILURE" }))
      .mockResolvedValueOnce(tokenResponse("new-token"))
      .mockResolvedValueOnce(jsonResponse(201, {
        id: "SANDBOX-ORDER-456",
        status: "CREATED",
        links: [],
      }));
    const service = new PayPalRestService(credentials, fetcher);

    await expect(service.createOrder(orderInput)).resolves.toMatchObject({
      id: "SANDBOX-ORDER-456",
      status: "CREATED",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer new-token",
    );
  });

  it("handles PayPal OAuth rejection without returning credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401, { error: "invalid_client" }));
    const service = new PayPalRestService(credentials, fetcher);

    await expect(service.createOrder(orderInput)).rejects.toMatchObject({
      code: "authentication",
    });
  });

  it("reports timeouts without retrying a create operation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const service = new PayPalRestService(credentials, fetcher);

    await expect(service.createOrder(orderInput)).rejects.toMatchObject({
      code: "timeout",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports network and PayPal API errors without exposing raw provider content", async () => {
    const networkFailure = new PayPalRestService(
      credentials,
      vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("private network detail")),
    );
    await expect(networkFailure.createOrder(orderInput)).rejects.toBeInstanceOf(
      PayPalServiceError,
    );

    const apiFailure = new PayPalRestService(
      credentials,
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          jsonResponse(500, { message: "provider detail not for clients" }),
        ),
    );
    await expect(apiFailure.createOrder(orderInput)).rejects.toMatchObject({
      code: "upstream",
    });
  });
});
