import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransactionsSection from "./TransactionsSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mockRecords = [
  {
    recordId: "rec-order-1",
    paypalId: "SANDBOX-ORDER-101",
    resourceType: "order",
    recipient: null,
    description: "Handmade ceramic mug",
    amount: 28.5,
    currency: "USD",
    status: "PAYER_ACTION_REQUIRED",
    isSettledPayment: false,
    createdAt: "2026-10-25T14:30:00Z",
    approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=mock-order",
    invoiceUrl: null,
  },
  {
    recordId: "rec-inv-2",
    paypalId: "SANDBOX-INV-202",
    resourceType: "invoice",
    recipient: "buyer@example.com",
    description: "Design consulting service",
    amount: 150.0,
    currency: "USD",
    status: "DRAFT",
    isSettledPayment: false,
    createdAt: "2026-10-26T10:15:00Z",
    approvalUrl: null,
    invoiceUrl: "https://www.sandbox.paypal.com/invoice/p/#mock-inv",
  },
  {
    recordId: "rec-pay-3",
    paypalId: "PAYPAL-TX-303",
    resourceType: "settled_payment",
    recipient: null,
    description: "Monthly subscription payment",
    amount: 99.0,
    currency: "USD",
    status: "COMPLETED",
    isSettledPayment: true,
    createdAt: "2026-10-27T08:00:00Z",
    approvalUrl: null,
    invoiceUrl: null,
  },
];

describe("TransactionsSection AG Grid dashboard", () => {
  it("renders summary cards distinguishing orders, invoices, and confirmed settled payments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            records: mockRecords,
            environment: "SANDBOX",
            sandboxLiveConnected: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(<TransactionsSection />);

    expect(await screen.findByText("Transactions & Activity")).toBeTruthy();
    expect(screen.getByText("Application Orders")).toBeTruthy();
    expect(screen.getByText("Invoice Drafts")).toBeTruthy();
    expect(screen.getByText("Settled Payments")).toBeTruthy();
    expect(screen.getByText("Confirmed Received Total")).toBeTruthy();

    // Verify financial distinction: Settled Total only counts settled payment ($99.00), not pending order ($28.50)
    expect(screen.getByText("USD 99.00")).toBeTruthy();
    expect(screen.getByText("Pending buyer checkout: USD 28.50")).toBeTruthy();
  });

  it("handles backend API error gracefully and shows fallback demo notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network connection failed")),
    );

    render(<TransactionsSection />);

    expect(
      await screen.findByText(/Notice: Live Sandbox query unavailable/),
    ).toBeTruthy();
    expect(screen.getByText(/Displaying local application records/)).toBeTruthy();
  });

  it("handles empty record state and provides filter reset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            records: [],
            environment: "SANDBOX",
            sandboxLiveConnected: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(<TransactionsSection />);

    expect(await screen.findByText("No records found")).toBeTruthy();
    expect(screen.getByText("USD 0.00")).toBeTruthy();
  });

  it("opens detail modal on row action click with correct financial explanation and safe URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            records: mockRecords,
            environment: "SANDBOX",
            sandboxLiveConnected: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(<TransactionsSection />);

    const viewButtons = await screen.findAllByRole("button", { name: "View" });
    expect(viewButtons.length).toBeGreaterThan(0);

    // Click the first view button (the order)
    fireEvent.click(viewButtons[0]);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("PayPal Checkout Order")).toBeTruthy();
    expect(screen.getByText(/This order requires buyer checkout completion/)).toBeTruthy();
    expect(screen.getAllByText("rec-order-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("SANDBOX-ORDER-101").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("USD 28.50").length).toBeGreaterThanOrEqual(1);

    const checkoutLink = screen.getByRole("link", {
      name: /Open PayPal Sandbox Checkout Link/,
    });
    expect(checkoutLink.getAttribute("href")).toBe(
      "https://www.sandbox.paypal.com/checkoutnow?token=mock-order",
    );

    // Close modal
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("supports manual data refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          records: mockRecords,
          environment: "SANDBOX",
          sandboxLiveConnected: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TransactionsSection />);

    const refreshButton = await screen.findByRole("button", { name: /Refresh/ });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
