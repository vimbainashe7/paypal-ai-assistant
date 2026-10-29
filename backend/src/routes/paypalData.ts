import { Router } from "express";
import { config, hasPayPalCredentials } from "../config.js";
import { callPayPalReadTool } from "../services/paypal.js";
import {
  applicationRecordStore,
  type ApplicationRecord,
} from "../services/applicationRecords.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getAmount(value: unknown): { amount: number; currency: string } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const amount = typeof value.value === "string" ? Number(value.value) : Number.NaN;
  const currency = stringValue(value.currency_code);
  return Number.isFinite(amount) && currency ? { amount, currency } : undefined;
}

function requireCredentials(response: import("express").Response): boolean {
  if (!hasPayPalCredentials()) {
    response.status(503).json({
      error: "Configure PayPal sandbox credentials in .env to load account data.",
    });
    return false;
  }

  return true;
}

export const paypalDataRouter = Router();

paypalDataRouter.get("/transactions", async (_request, response) => {
  if (!requireCredentials(response)) {
    return;
  }

  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 31 * 24 * 60 * 60 * 1000);
    const payload = await callPayPalReadTool("list_transactions", {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      transaction_status: "S",
      page: 1,
      page_size: 100,
    });
    if (!isRecord(payload) || !Array.isArray(payload.transaction_details)) {
      throw new Error("PayPal returned an invalid transaction list.");
    }

    const transactions = payload.transaction_details.map((entry, index) => {
      if (!isRecord(entry) || !isRecord(entry.transaction_info)) {
        throw new Error(`PayPal returned an invalid transaction at position ${index + 1}.`);
      }

      const info = entry.transaction_info;
      const id = stringValue(info.transaction_id);
      const amount = getAmount(info.transaction_amount);
      if (!id || !amount) {
        throw new Error(`PayPal returned an incomplete transaction at position ${index + 1}.`);
      }

      return {
        id,
        date: stringValue(info.transaction_initiation_date) ?? "Date unavailable",
        description:
          stringValue(info.transaction_subject) ??
          stringValue(info.transaction_event_code) ??
          "PayPal transaction",
        status: stringValue(info.transaction_status) === "S" ? "Successful" : "Status unavailable",
        amount: amount.amount,
        currency: amount.currency,
      };
    });

    response.json({ transactions, environment: config.PAYPAL_ENVIRONMENT });
  } catch (error) {
    console.error("Transaction request failed", error instanceof Error ? error.name : "UnknownError");
    response.status(502).json({
      error: "PayPal sandbox transaction data could not be loaded. Try again shortly.",
    });
  }
});

paypalDataRouter.get("/invoices", async (_request, response) => {
  if (!requireCredentials(response)) {
    return;
  }

  try {
    const payload = await callPayPalReadTool("list_invoices", {
      page: 1,
      page_size: 50,
      total_required: true,
    });
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new Error("PayPal returned an invalid invoice list.");
    }

    const invoices = payload.items.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`PayPal returned an invalid invoice at position ${index + 1}.`);
      }

      const detail = isRecord(entry.detail) ? entry.detail : {};
      const money = getAmount(entry.amount) ?? getAmount(entry.grand_total);
      const id = stringValue(entry.id) ?? stringValue(entry.invoice_id);
      if (!id) {
        throw new Error(`PayPal returned an invoice without an ID at position ${index + 1}.`);
      }

      return {
        id,
        date: stringValue(detail.invoice_date) ?? "Date unavailable",
        status: stringValue(entry.status) ?? "Status unavailable",
        amount: money ? `${money.currency} ${money.amount.toFixed(2)}` : "Amount unavailable",
      };
    });

    response.json({ invoices, environment: config.PAYPAL_ENVIRONMENT });
  } catch (error) {
    console.error("Invoice request failed", error instanceof Error ? error.name : "UnknownError");
    response.status(502).json({
      error: "PayPal sandbox invoice data could not be loaded. Try again shortly.",
    });
  }
});

paypalDataRouter.get("/dashboard/records", async (_request, response) => {
  const appRecords = applicationRecordStore.getRecords();
  const records: ApplicationRecord[] = [...appRecords];

  if (hasPayPalCredentials()) {
    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 31 * 24 * 60 * 60 * 1000);
      const payload = await callPayPalReadTool("list_transactions", {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        transaction_status: "S",
        page: 1,
        page_size: 100,
      });

      if (isRecord(payload) && Array.isArray(payload.transaction_details)) {
        const existingPaypalIds = new Set(
          records.map((r) => r.paypalId).filter(Boolean),
        );

        for (const entry of payload.transaction_details) {
          if (isRecord(entry) && isRecord(entry.transaction_info)) {
            const info = entry.transaction_info;
            const id = stringValue(info.transaction_id);
            const amount = getAmount(info.transaction_amount);
            if (id && amount && !existingPaypalIds.has(id)) {
              existingPaypalIds.add(id);
              records.push({
                recordId: `paypal-tx-${id}`,
                paypalId: id,
                resourceType: "settled_payment",
                recipient: null,
                description:
                  stringValue(info.transaction_subject) ??
                  stringValue(info.transaction_event_code) ??
                  "Settled PayPal transaction",
                amount: amount.amount,
                currency: amount.currency,
                status: "COMPLETED",
                isSettledPayment: true,
                createdAt:
                  stringValue(info.transaction_initiation_date) ??
                  new Date().toISOString(),
                approvalUrl: null,
                invoiceUrl: null,
              });
            }
          }
        }
      }
    } catch (readError) {
      console.warn("Live Sandbox transaction read omitted for dashboard:", readError instanceof Error ? readError.name : "UnknownError");
    }
  }

  // Sort newest first
  records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  response.json({
    records,
    environment: config.PAYPAL_ENVIRONMENT,
    sandboxLiveConnected: hasPayPalCredentials(),
  });
});

