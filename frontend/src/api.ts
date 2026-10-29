export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TransactionRow {
  id: string;
  date: string;
  description: string;
  status: string;
  amount: number;
  currency: string;
}

export interface InvoiceRow {
  id: string;
  date: string;
  status: string;
  amount: string;
}

export type AssistantReadData =
  | {
      type: "transaction_summary";
      environment: "SANDBOX";
      periodDays: number;
      count: number;
      grossByCurrency: Array<{ currency: string; amount: string }>;
    }
  | {
      type: "invoice_status";
      environment: "SANDBOX";
      invoiceId: string;
      status: string;
      dueAmount: string | null;
      dueCurrency: string | null;
    };

export type ProposedPaymentAction =
  | {
      type: "create_sandbox_order";
      actionId: string;
      amount: string;
      currency: "USD";
      description: string | null;
    }
  | {
      type: "create_invoice";
      actionId: string;
      amount: string;
      currency: "USD";
      recipientEmail: string;
      description: string;
      dueDate: string | null;
    };

export type AssistantChatResult =
  | {
      kind: "message" | "clarification";
      conversationId: string;
      message: string;
    }
  | {
      kind: "confirmation_required";
      conversationId: string;
      message: string;
      proposedAction: ProposedPaymentAction;
    }
  | {
      kind: "read_result";
      conversationId: string;
      message: string;
      data: AssistantReadData;
    };

export interface AssistantExecutionResult {
  kind: "created";
  actionId: string;
  message: string;
  action: ProposedPaymentAction;
  resource: {
    id: string;
    status: string;
    approvalUrl: string | null;
    invoiceUrl: string | null;
  };
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError("Could not reach the backend. Check that the server is running and try again.");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("The backend returned an unreadable response. Please try again.");
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return body;
}

export async function getHealth(): Promise<{ status: string }> {
  const body = await requestJson("/api/health");
  if (
    typeof body !== "object" ||
    body === null ||
    !("status" in body) ||
    typeof body.status !== "string"
  ) {
    throw new ApiError("The backend returned an invalid health response.");
  }

  return { status: body.status };
}

export async function chatAssistant(
  message: string,
  conversationId?: string,
): Promise<AssistantChatResult> {
  const body = await requestJson("/api/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
  });

  if (!isRecord(body) || typeof body.kind !== "string" || !isUuid(body.conversationId)) {
    throw new ApiError("The assistant returned an invalid chat response.");
  }

  if (
    (body.kind === "message" || body.kind === "clarification") &&
    typeof body.message === "string"
  ) {
    return { kind: body.kind, conversationId: body.conversationId, message: body.message };
  }
  if (
    body.kind === "confirmation_required" &&
    typeof body.message === "string" &&
    isProposedPaymentAction(body.proposedAction)
  ) {
    return {
      kind: body.kind,
      conversationId: body.conversationId,
      message: body.message,
      proposedAction: body.proposedAction,
    };
  }
  if (
    body.kind === "read_result" &&
    typeof body.message === "string" &&
    isAssistantReadResult(body.data)
  ) {
    return {
      kind: body.kind,
      conversationId: body.conversationId,
      message: body.message,
      data: body.data,
    };
  }
  throw new ApiError("The assistant returned an invalid chat response.");
}

export async function confirmPendingAction(
  conversationId: string,
  actionId: string,
): Promise<AssistantExecutionResult> {
  const body = await requestJson("/api/assistant/confirm-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, actionId }),
  });

  if (
    !isRecord(body) ||
    body.kind !== "created" ||
    body.actionId !== actionId ||
    typeof body.message !== "string" ||
    !isProposedPaymentAction(body.action) ||
    body.action.actionId !== actionId ||
    !isRecord(body.resource) ||
    typeof body.resource.id !== "string" ||
    typeof body.resource.status !== "string" ||
    !isSafeSandboxUrl(body.resource.approvalUrl) ||
    !isSafeSandboxUrl(body.resource.invoiceUrl)
  ) {
    throw new ApiError("The backend returned an invalid confirmation result.");
  }

  return {
    kind: "created",
    actionId: body.actionId,
    message: body.message,
    action: body.action,
    resource: {
      id: body.resource.id,
      status: body.resource.status,
      approvalUrl: body.resource.approvalUrl,
      invoiceUrl: body.resource.invoiceUrl,
    },
  };
}

export async function cancelPendingAction(
  conversationId: string,
  actionId: string,
): Promise<void> {
  const body = await requestJson("/api/assistant/cancel-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, actionId }),
  });
  if (
    !isRecord(body) ||
    body.kind !== "cancelled" ||
    body.actionId !== actionId
  ) {
    throw new ApiError("The backend returned an invalid cancellation response.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isProposedPaymentAction(value: unknown): value is ProposedPaymentAction {
  if (
    !isRecord(value) ||
    !isUuid(value.actionId) ||
    value.currency !== "USD" ||
    typeof value.amount !== "string" ||
    !isValidAmount(value.amount)
  ) {
    return false;
  }
  if (
    value.type === "create_sandbox_order" &&
    ((typeof value.description === "string" && value.description.length <= 127) ||
      value.description === null)
  ) {
    return true;
  }
  return (
    value.type === "create_invoice" &&
    typeof value.recipientEmail === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.recipientEmail) &&
    value.recipientEmail.length <= 254 &&
    typeof value.description === "string" &&
    value.description.trim().length > 0 &&
    value.description.length <= 127 &&
    ((typeof value.dueDate === "string" && isValidDate(value.dueDate)) ||
      value.dueDate === null)
  );
}

function isValidAmount(value: string): boolean {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value)) {
    return false;
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 10_000;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isAssistantReadResult(value: unknown): value is AssistantReadData {
  if (!isRecord(value) || value.environment !== "SANDBOX") {
    return false;
  }
  if (
    value.type === "transaction_summary" &&
    typeof value.periodDays === "number" &&
    typeof value.count === "number" &&
    Array.isArray(value.grossByCurrency) &&
    value.grossByCurrency.every(
      (row) =>
        isRecord(row) &&
        typeof row.currency === "string" &&
        typeof row.amount === "string",
    )
  ) {
    return true;
  }
  if (
    value.type === "invoice_status" &&
    typeof value.invoiceId === "string" &&
    typeof value.status === "string" &&
    (typeof value.dueAmount === "string" || value.dueAmount === null) &&
    (typeof value.dueCurrency === "string" || value.dueCurrency === null)
  ) {
    return true;
  }
  return false;
}

function isSafeSandboxUrl(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.sandbox.paypal.com";
  } catch {
    return false;
  }
}

function parseRows<T>(
  body: unknown,
  key: "transactions" | "invoices",
  isRow: (value: unknown) => value is T,
): T[] {
  if (!isRecord(body) || !Array.isArray(body[key]) || !body[key].every(isRow)) {
    throw new ApiError(`The backend returned an invalid ${key} response.`);
  }

  return body[key];
}

function isTransactionRow(value: unknown): value is TransactionRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.date === "string" &&
    typeof value.description === "string" &&
    typeof value.status === "string" &&
    typeof value.amount === "number" &&
    typeof value.currency === "string"
  );
}

function isInvoiceRow(value: unknown): value is InvoiceRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.date === "string" &&
    typeof value.status === "string" &&
    typeof value.amount === "string"
  );
}

export async function getTransactions(): Promise<TransactionRow[]> {
  return parseRows(await requestJson("/api/transactions"), "transactions", isTransactionRow);
}

export async function getInvoices(): Promise<InvoiceRow[]> {
  return parseRows(await requestJson("/api/invoices"), "invoices", isInvoiceRow);
}

export type ApplicationResourceType = "order" | "invoice" | "settled_payment";

export interface DashboardRecord {
  recordId: string;
  paypalId: string | null;
  resourceType: ApplicationResourceType;
  recipient: string | null;
  description: string;
  amount: number;
  currency: string;
  status: string;
  isSettledPayment: boolean;
  createdAt: string;
  approvalUrl?: string | null;
  invoiceUrl?: string | null;
}

export interface DashboardRecordsResponse {
  records: DashboardRecord[];
  environment: string;
  sandboxLiveConnected: boolean;
}

function isDashboardRecord(value: unknown): value is DashboardRecord {
  return (
    isRecord(value) &&
    typeof value.recordId === "string" &&
    (typeof value.paypalId === "string" || value.paypalId === null) &&
    (value.resourceType === "order" ||
      value.resourceType === "invoice" ||
      value.resourceType === "settled_payment") &&
    (typeof value.recipient === "string" || value.recipient === null) &&
    typeof value.description === "string" &&
    typeof value.amount === "number" &&
    typeof value.currency === "string" &&
    typeof value.status === "string" &&
    typeof value.isSettledPayment === "boolean" &&
    typeof value.createdAt === "string"
  );
}

export async function getDashboardRecords(): Promise<DashboardRecordsResponse> {
  const body = await requestJson("/api/dashboard/records");
  if (!isRecord(body) || !Array.isArray(body.records)) {
    throw new ApiError("The backend returned an invalid dashboard records response.");
  }

  const records = body.records.filter(isDashboardRecord);
  return {
    records,
    environment: typeof body.environment === "string" ? body.environment : "SANDBOX",
    sandboxLiveConnected: Boolean(body.sandboxLiveConnected),
  };
}

