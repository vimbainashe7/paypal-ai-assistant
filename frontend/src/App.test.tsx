import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("application shell", () => {
  it("shows the project name, sandbox indicator, and primary navigation", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("PayPal AI Assistant");
    expect(markup).toContain("SANDBOX");
    expect(markup).toContain("Transactions");
    expect(markup).toContain("Invoices");
  });

  it("shows a welcoming empty conversation and prevents empty submission", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", environment: "SANDBOX" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    expect(screen.getByText("What would you like help with?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/assistant/chat",
      expect.anything(),
    );
  });

  it("shows the exact proposed action and confirms only its server-issued IDs", async () => {
    const conversationId = "2e327bba-786a-4609-81f1-c7919db49e8c";
    const actionId = "b0fd38e4-e6db-4890-8725-4db4fc46df6c";
    const action = {
      type: "create_sandbox_order",
      actionId,
      amount: "54.00",
      currency: "USD",
      description: "3 handmade candles",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === "/api/health") {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", environment: "SANDBOX" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (input.toString() === "/api/assistant/chat") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              kind: "confirmation_required",
              conversationId,
              message: "Review Sandbox checkout order: USD 54.00 for 3 handmade candles.",
              proposedAction: action,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      expect(input.toString()).toBe("/api/assistant/confirm-action");
      expect(JSON.parse(String(init?.body))).toEqual({ conversationId, actionId });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            kind: "created",
            actionId,
            action,
            message: "Order created in Sandbox. The buyer must complete checkout.",
            resource: {
              id: "SANDBOX-ORDER-123",
              status: "PAYER_ACTION_REQUIRED",
              approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order",
              invoiceUrl: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Prepare a sandbox order for 3 candles." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/assistant/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ message: "Prepare a sandbox order for 3 candles." }),
        }),
      );
    });
    expect(await screen.findByText("Proposed action · Review before confirming")).toBeTruthy();
    expect(screen.getByText("Checkout order: USD 54.00")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const confirmButton = screen.getByRole("button", { name: "Confirm this exact action" });
    act(() => {
      confirmButton.click();
      confirmButton.click();
    });
    expect(await screen.findByText("PayPal reference: SANDBOX-ORDER-123")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Continue to PayPal Sandbox checkout" }).getAttribute("href"),
    ).toBe("https://www.sandbox.paypal.com/checkoutnow?token=order");
    expect(screen.getByText(/Pending — buyer checkout is still required/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows a clear error when the assistant request fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const isHealthCheck = input.toString() === "/api/health";
      return Promise.resolve(
        new Response(
          JSON.stringify(
            isHealthCheck
              ? { status: "ok", environment: "SANDBOX" }
              : { error: "Configure sandbox credentials." },
          ),
          {
            status: isHealthCheck ? 200 : 503,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Prepare a sandbox order." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Configure sandbox credentials.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a clarification without offering to create an incomplete action", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input.toString() === "/api/health"
              ? { status: "ok", environment: "SANDBOX" }
              : {
                  kind: "clarification",
                  conversationId: "2e327bba-786a-4609-81f1-c7919db49e8c",
                  message: "What is the amount and currency?",
                },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Prepare an order for candles." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("What is the amount and currency?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm this exact action" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows invoice recipient and due date before confirmation", async () => {
    const conversationId = "2e327bba-786a-4609-81f1-c7919db49e8c";
    const actionId = "b0fd38e4-e6db-4890-8725-4db4fc46df6c";
    const action = {
      type: "create_invoice",
      actionId,
      amount: "45.00",
      currency: "USD",
      recipientEmail: "customer@example.com",
      description: "Consulting",
      dueDate: "2026-11-10",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === "/api/health") {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", environment: "SANDBOX" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (input.toString() === "/api/assistant/chat") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              kind: "confirmation_required",
              conversationId,
              message: "Review Sandbox invoice draft.",
              proposedAction: action,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      expect(input.toString()).toBe("/api/assistant/cancel-action");
      expect(JSON.parse(String(init?.body))).toEqual({ conversationId, actionId });
      return Promise.resolve(
        new Response(JSON.stringify({ kind: "cancelled", actionId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Prepare a consulting invoice." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Recipient: customer@example.com")).toBeTruthy();
    expect(screen.getByText("Item or service: Consulting")).toBeTruthy();
    expect(screen.getByText("Due date: 2026-11-10")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Confirm this exact action" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel proposal" }));
    expect(await screen.findByText(/pending proposal was cancelled/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm this exact action" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows loading and safe errors for unreadable backend responses", async () => {
    let finishChat: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (input.toString() === "/api/health") {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", environment: "SANDBOX" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return new Promise<Response>((resolve) => {
        finishChat = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Assistant is thinking…")).toBeTruthy();
    finishChat?.(new Response("not-json", { status: 200 }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("unreadable response");

    cleanup();
    vi.unstubAllGlobals();
    const networkFailure = vi.fn((input: RequestInfo | URL) =>
      input.toString() === "/api/health"
        ? Promise.resolve(
            new Response(JSON.stringify({ status: "ok", environment: "SANDBOX" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
        : Promise.reject(new Error("network offline")),
    );
    vi.stubGlobal("fetch", networkFailure);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Hello again" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Could not reach the backend");
  });

  it("uses a suggested prompt and never renders confirmation for ordinary answers", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input.toString() === "/api/health"
              ? { status: "ok", environment: "SANDBOX" }
              : {
                  kind: "message",
                  conversationId: "2e327bba-786a-4609-81f1-c7919db49e8c",
                  message: "I can prepare Sandbox orders and invoice drafts.",
                },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create a $10 Sandbox checkout order for candles.",
      }),
    );
    expect(screen.getByLabelText("Message")).toHaveProperty(
      "value",
      "Create a $10 Sandbox checkout order for candles.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("I can prepare Sandbox orders and invoice drafts.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm this exact action" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows invoice details, PayPal invoice link, and verified invoice status", async () => {
    const conversationId = "2e327bba-786a-4609-81f1-c7919db49e8c";
    const actionId = "b0fd38e4-e6db-4890-8725-4db4fc46df6c";
    const action = {
      type: "create_invoice",
      actionId,
      amount: "45.00",
      currency: "USD",
      recipientEmail: "customer@example.com",
      description: "Consulting",
      dueDate: null,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (input.toString() === "/api/health") {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", environment: "SANDBOX" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (input.toString() === "/api/assistant/chat") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              kind: "confirmation_required",
              conversationId,
              message: "Review invoice.",
              proposedAction: action,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            kind: "created",
            actionId,
            action,
            message: "Invoice draft created. It was not sent.",
            resource: {
              id: "SANDBOX-INVOICE-123",
              status: "DRAFT",
              approvalUrl: null,
              invoiceUrl: "https://www.sandbox.paypal.com/invoice/p/example",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Prepare an invoice." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Recipient: customer@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm this exact action" }));
    expect(await screen.findByText("PayPal reference: SANDBOX-INVOICE-123")).toBeTruthy();
    expect(screen.getByText(/Pending — this invoice draft has not been sent/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View PayPal Sandbox invoice" }).getAttribute("href"),
    ).toBe("https://www.sandbox.paypal.com/invoice/p/example");
  });

  it("rejects malformed structured proposals instead of rendering a confirmation", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input.toString() === "/api/health"
              ? { status: "ok", environment: "SANDBOX" }
              : {
                  kind: "confirmation_required",
                  conversationId: "2e327bba-786a-4609-81f1-c7919db49e8c",
                  message: "Review this request.",
                  proposedAction: {
                    type: "create_sandbox_order",
                    actionId: "b0fd38e4-e6db-4890-8725-4db4fc46df6c",
                    amount: "-10.00",
                    currency: "USD",
                    description: "Invalid amount",
                  },
                },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Prepare order" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("invalid chat response");
    expect(screen.queryByRole("button", { name: "Confirm this exact action" })).toBeNull();
  });

  it("shows an expired confirmation as an error without offering another create click", async () => {
    const conversationId = "2e327bba-786a-4609-81f1-c7919db49e8c";
    const actionId = "b0fd38e4-e6db-4890-8725-4db4fc46df6c";
    const action = {
      type: "create_sandbox_order",
      actionId,
      amount: "10.00",
      currency: "USD",
      description: "Candles",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input.toString() === "/api/health"
              ? { status: "ok", environment: "SANDBOX" }
              : input.toString() === "/api/assistant/chat"
                ? {
                    kind: "confirmation_required",
                    conversationId,
                    message: "Review order.",
                    proposedAction: action,
                  }
                : { kind: "error", error: "This confirmation expired. Prepare it again." },
          ),
          {
            status: input.toString() === "/api/assistant/confirm-action" ? 404 : 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Prepare order" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm this exact action" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("confirmation expired");
    expect(screen.queryByRole("button", { name: "Confirm this exact action" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
