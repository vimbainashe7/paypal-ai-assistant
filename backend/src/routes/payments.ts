import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config, getPayPalCredentials } from "../config.js";
import {
  getPayPalRestService,
  PayPalServiceError,
  type PayPalCreateInvoiceInput,
  type PayPalCreateOrderInput,
} from "../services/paypalRest.js";
import { applicationRecordStore } from "../services/applicationRecords.js";

const moneySchema = z
  .string()
  .regex(/^\d{1,6}(?:\.\d{1,2})?$/, "Use a decimal amount with at most two fractional digits.")
  .refine((value) => decimalToCents(value) > 0, "Amount must be greater than zero.")
  .refine((value) => decimalToCents(value) <= 1_000_000, "Amount cannot exceed USD 10,000.");

const orderRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    amount: moneySchema,
    currency: z.literal("USD"),
    description: z.string().trim().min(1).max(127).optional(),
  })
  .strict();

const invoiceItemSchema = z
  .object({
    name: z.string().trim().min(1).max(127),
    description: z.string().trim().max(255).optional(),
    quantity: z.number().int().min(1).max(100),
    unitAmount: moneySchema,
  })
  .strict();

const invoiceRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    recipientEmail: z.string().trim().email().max(254),
    currency: z.literal("USD"),
    items: z.array(invoiceItemSchema).min(1).max(20),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict()
  .superRefine((invoice, context) => {
    if (invoice.dueDate && !isValidDueDate(invoice.dueDate)) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date must be a real calendar date that is today or later.",
      });
    }

    const totalCents = invoice.items.reduce(
      (total, item) => total + decimalToCents(item.unitAmount) * item.quantity,
      0,
    );
    if (totalCents > 10_000_000) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Invoice total cannot exceed USD 100,000.",
      });
    }
  });

export const paymentsRouter = Router();

const createRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: "Too many payment requests. Wait before trying again." });
  },
});

paymentsRouter.post("/orders", createRateLimit, async (request, response) => {
  const parsed = orderRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Provide a unique requestId, a positive USD amount up to 10,000, and a valid description.",
    });
    return;
  }
  if (!getPayPalCredentials()) {
    response.status(503).json({
      error: "Configure PayPal Sandbox credentials in the server environment before creating orders.",
    });
    return;
  }

  const input: PayPalCreateOrderInput = {
    ...parsed.data,
    amount: centsToDecimal(decimalToCents(parsed.data.amount)),
  };
  try {
    const created = await getPayPalRestService().createOrder(input);
    applicationRecordStore.addRecord({
      recordId: input.requestId,
      paypalId: created.id,
      resourceType: "order",
      recipient: null,
      description: input.description ?? "Sandbox checkout order",
      amount: Number(input.amount),
      currency: input.currency,
      status: created.status,
      isSettledPayment: false,
      createdAt: new Date().toISOString(),
      approvalUrl: created.approvalUrl,
      invoiceUrl: null,
    });
    response.status(201).json({
      orderId: created.id,
      status: created.status,
      approvalUrl: created.approvalUrl,
      amount: input.amount,
      currency: input.currency,
      environment: "SANDBOX",
      buyerMustCompleteCheckout: true,
    });
  } catch (error) {
    sendPayPalError(response, error, "PayPal Sandbox could not create the order.");
  }
});

paymentsRouter.post("/invoices", createRateLimit, async (request, response) => {
  const parsed = invoiceRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Provide a unique requestId, recipient email, USD currency, valid invoice items, and an optional valid due date.",
    });
    return;
  }
  if (!getPayPalCredentials()) {
    response.status(503).json({
      error: "Configure PayPal Sandbox credentials in the server environment before creating invoices.",
    });
    return;
  }
  if (!config.PAYPAL_INVOICER_BUSINESS_NAME) {
    response.status(503).json({
      error: "Configure PAYPAL_INVOICER_BUSINESS_NAME before creating invoice drafts.",
    });
    return;
  }

  const input: PayPalCreateInvoiceInput = {
    ...parsed.data,
    items: parsed.data.items.map((item) => ({
      ...item,
      unitAmount: centsToDecimal(decimalToCents(item.unitAmount)),
    })),
  };
  try {
    const created = await getPayPalRestService().createInvoice(input);
    const totalCents = input.items.reduce(
      (total, item) => total + decimalToCents(item.unitAmount) * item.quantity,
      0,
    );
    applicationRecordStore.addRecord({
      recordId: input.requestId,
      paypalId: created.id,
      resourceType: "invoice",
      recipient: input.recipientEmail,
      description: input.items.map((i) => i.name).join(", "),
      amount: totalCents / 100,
      currency: input.currency,
      status: created.status,
      isSettledPayment: false,
      createdAt: new Date().toISOString(),
      approvalUrl: null,
      invoiceUrl: created.invoiceUrl,
    });
    response.status(201).json({
      invoiceId: created.id,
      status: created.status,
      invoiceUrl: created.invoiceUrl,
      amount: centsToDecimal(totalCents),
      currency: input.currency,
      environment: "SANDBOX",
      sent: false,
    });
  } catch (error) {
    sendPayPalError(response, error, "PayPal Sandbox could not create the invoice draft.");
  }
});

function sendPayPalError(
  response: import("express").Response,
  error: unknown,
  upstreamMessage: string,
): void {
  if (error instanceof PayPalServiceError) {
    if (error.code === "credentials_missing") {
      response.status(503).json({
        error: "Configure PayPal Sandbox credentials in the server environment.",
      });
      return;
    }
    if (error.code === "idempotency_conflict") {
      response.status(409).json({
        error: "This requestId was already used with different details. Use a new requestId.",
      });
      return;
    }
    if (error.code === "timeout") {
      response.status(504).json({
        error: "PayPal Sandbox did not respond in time. Check PayPal before retrying this request.",
      });
      return;
    }
    console.error("PayPal Sandbox API request failed", error.code);
    response.status(502).json({ error: upstreamMessage });
    return;
  }

  console.error("Unexpected PayPal Sandbox service error", error instanceof Error ? error.name : "UnknownError");
  response.status(502).json({ error: upstreamMessage });
}

function decimalToCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

function isValidDueDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  return value >= today;
}
