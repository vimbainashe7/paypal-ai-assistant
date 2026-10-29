import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { getPayPalCredentials } from "../config.js";
import type { AssistantDraft } from "./draft.js";

const allowedToolNames = new Set([
  "create_invoice",
  "create_order",
  "get_invoice",
  "get_order",
  "list_invoices",
  "list_transactions",
]);

export function createPayPalToolkit(): PayPalAgentToolkit {
  const credentials = getPayPalCredentials();
  if (!credentials) {
    throw new Error("PayPal sandbox credentials are not configured.");
  }

  return new PayPalAgentToolkit({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    configuration: {
      context: { sandbox: true },
      actions: {
        invoices: { create: true, get: true, list: true },
        orders: { create: true, get: true },
        transactions: { list: true },
      },
    },
  });
}

export function getAllowedPayPalTools(toolkit: PayPalAgentToolkit) {
  return toolkit.getTools().filter((tool) => allowedToolNames.has(tool.function.name));
}

export function isAllowedPayPalTool(name: string): boolean {
  return allowedToolNames.has(name);
}

export async function createConfirmedDraft(draft: AssistantDraft): Promise<{
  id: string;
  approvalUrl: string | null;
}> {
  if (draft.needsInfo) {
    throw new Error("The draft needs more information before it can be created.");
  }

  const toolkit = createPayPalToolkit();
  const toolName = draft.action === "order" ? "create_order" : "create_invoice";
  const tool = toolkit.getTools().find((candidate) => candidate.function.name === toolName);
  if (!tool) {
    throw new Error(`The PayPal ${toolName} tool is not enabled.`);
  }

  const argumentsValue =
    draft.action === "order"
      ? {
          currencyCode: draft.currencyCode,
          items: draft.items.map((item) => ({
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            itemCost: item.unitAmount,
            itemTotal: Number((item.unitAmount * item.quantity).toFixed(2)),
            taxPercent: 0,
          })),
          discount: 0,
          shippingCost: 0,
        }
      : {
          currency_code: draft.currencyCode,
          primary_recipients: [
            {
              billing_info: { email_address: draft.recipientEmail },
            },
          ],
          items: draft.items.map((item) => ({
            name: item.name,
            description: item.description,
            quantity: String(item.quantity),
            unit_amount: {
              currency_code: draft.currencyCode,
              value: item.unitAmount.toFixed(2),
            },
          })),
        };

  const result = await toolkit.handleToolCall({
    id: `confirmed-${draft.action}`,
    type: "function",
    function: { name: toolName, arguments: JSON.stringify(argumentsValue) },
  });
  if (typeof result.content !== "string") {
    throw new Error("PayPal returned an unsupported create response.");
  }

  const response: unknown = JSON.parse(result.content);
  if (!isRecord(response) || "error" in response) {
    throw new Error("PayPal could not create the confirmed Sandbox draft.");
  }

  const id =
    typeof response.id === "string"
      ? response.id
      : typeof response.order_id === "string"
        ? response.order_id
        : typeof response.invoice_id === "string"
          ? response.invoice_id
          : undefined;
  if (!id) {
    throw new Error("PayPal did not return an ID for the created draft.");
  }

  const approvalUrl = Array.isArray(response.links)
    ? response.links.find(
        (link): link is Record<string, unknown> =>
          isRecord(link) && link.rel === "approve" && typeof link.href === "string",
      )?.href
    : undefined;

  return { id, approvalUrl: typeof approvalUrl === "string" ? approvalUrl : null };
}

export async function callPayPalReadTool(
  name: "list_invoices" | "list_transactions" | "get_invoice",
  argumentsValue: Record<string, unknown>,
): Promise<unknown> {
  const toolkit = createPayPalToolkit();
  const tool = toolkit.getTools().find((candidate) => candidate.function.name === name);
  if (!tool) {
    throw new Error(`The PayPal ${name} tool is not enabled.`);
  }

  const result = await toolkit.handleToolCall({
    id: `dashboard-${name}`,
    type: "function",
    function: { name, arguments: JSON.stringify(argumentsValue) },
  });
  if (typeof result.content !== "string") {
    throw new Error(`The PayPal ${name} tool returned an unsupported response.`);
  }

  return JSON.parse(result.content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
