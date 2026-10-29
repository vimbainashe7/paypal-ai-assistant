import { createHash } from "node:crypto";
import { config, getPayPalCredentials } from "../config.js";

const sandboxApiBaseUrl = "https://api-m.sandbox.paypal.com";
const requestTimeoutMs = 10_000;
const idempotencyTtlMs = 6 * 60 * 60 * 1000;
const idempotencyCacheLimit = 5_000;

export type PayPalServiceErrorCode =
  | "credentials_missing"
  | "authentication"
  | "timeout"
  | "network"
  | "upstream"
  | "invalid_response"
  | "idempotency_conflict";

export class PayPalServiceError extends Error {
  constructor(readonly code: PayPalServiceErrorCode) {
    super(code);
    this.name = "PayPalServiceError";
  }
}

export interface PayPalCreateOrderInput {
  requestId: string;
  amount: string;
  currency: "USD";
  description?: string;
}

export interface PayPalCreateInvoiceInput {
  requestId: string;
  recipientEmail: string;
  currency: "USD";
  items: Array<{
    name: string;
    description?: string;
    quantity: number;
    unitAmount: string;
  }>;
  dueDate?: string;
}

export interface PayPalCreatedResource {
  id: string;
  status: string;
  approvalUrl: string | null;
  invoiceUrl: string | null;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

interface IdempotencyEntry {
  fingerprint: string;
  expiresAt: number;
  promise: Promise<PayPalCreatedResource>;
}

interface Credentials {
  clientId: string;
  clientSecret: string;
  invoicerBusinessName?: string;
}

export class PayPalRestService {
  private cachedToken: CachedToken | undefined;
  private readonly idempotencyEntries = new Map<string, IdempotencyEntry>();

  constructor(
    private readonly credentials: Credentials,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async createOrder(input: PayPalCreateOrderInput): Promise<PayPalCreatedResource> {
    return this.createIdempotently("order", input.requestId, input, async () => {
      const body = {
        intent: "CAPTURE",
        purchase_units: [
          {
            description: input.description,
            amount: {
              currency_code: input.currency,
              value: input.amount,
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              return_url: config.PAYPAL_RETURN_URL,
              cancel_url: config.PAYPAL_CANCEL_URL,
            },
          },
        },
      };

      const response = await this.requestApi(
        "/v2/checkout/orders",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "PayPal-Request-Id": input.requestId,
            Prefer: "return=representation",
          },
          body: JSON.stringify(body),
        },
      );
      const resource = await this.parseSuccessfulResponse(response);
      const id = readString(resource.id);
      const status = readString(resource.status);
      if (!id || !status) {
        throw new PayPalServiceError("invalid_response");
      }

      return {
        id,
        status,
        approvalUrl: getPayPalLink(resource.links, ["payer-action", "approve"]),
        invoiceUrl: null,
      };
    });
  }

  async createInvoice(input: PayPalCreateInvoiceInput): Promise<PayPalCreatedResource> {
    if (!this.credentials.invoicerBusinessName) {
      throw new PayPalServiceError("credentials_missing");
    }

    return this.createIdempotently("invoice", input.requestId, input, async () => {
      const body = {
        detail: {
          currency_code: input.currency,
          ...(input.dueDate
            ? {
                payment_term: {
                  due_date: `${input.dueDate}T00:00:00Z`,
                },
              }
            : {}),
        },
        invoicer: {
          business_name: this.credentials.invoicerBusinessName,
        },
        primary_recipients: [
          {
            billing_info: { email_address: input.recipientEmail },
          },
        ],
        items: input.items.map((item) => ({
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
          quantity: String(item.quantity),
          unit_amount: {
            currency_code: input.currency,
            value: item.unitAmount,
          },
        })),
      };

      const response = await this.requestApi("/v2/invoicing/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
      const resource = await this.parseSuccessfulResponse(response);
      const id = readString(resource.id);
      const status = readString(resource.status);
      if (!id || !status) {
        throw new PayPalServiceError("invalid_response");
      }

      return {
        id,
        status,
        approvalUrl: null,
        invoiceUrl: getPayPalLink(resource.links, ["payer-view", "view"]),
      };
    });
  }

  private async createIdempotently(
    resourceType: "order" | "invoice",
    requestId: string,
    input: PayPalCreateOrderInput | PayPalCreateInvoiceInput,
    createResource: () => Promise<PayPalCreatedResource>,
  ): Promise<PayPalCreatedResource> {
    this.removeExpiredIdempotencyEntries();
    const key = `${resourceType}:${requestId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = this.idempotencyEntries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new PayPalServiceError("idempotency_conflict");
      }
      return existing.promise;
    }
    if (this.idempotencyEntries.size >= idempotencyCacheLimit) {
      throw new PayPalServiceError("upstream");
    }

    const entry: IdempotencyEntry = {
      fingerprint,
      expiresAt: this.now() + idempotencyTtlMs,
      promise: createResource(),
    };
    this.idempotencyEntries.set(key, entry);
    try {
      return await entry.promise;
    } catch (error) {
      if (this.idempotencyEntries.get(key) === entry) {
        this.idempotencyEntries.delete(key);
      }
      throw error;
    }
  }

  private removeExpiredIdempotencyEntries(): void {
    const currentTime = this.now();
    for (const [key, entry] of this.idempotencyEntries) {
      if (entry.expiresAt <= currentTime) {
        this.idempotencyEntries.delete(key);
      }
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }

    const authorization = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString("base64");
    const response = await this.fetch(
      `${sandboxApiBaseUrl}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authorization}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      },
    );
    const payload = await this.parseResponse(response);
    const accessToken = isRecord(payload) ? readString(payload.access_token) : undefined;
    const expiresIn = isRecord(payload) ? payload.expires_in : undefined;
    if (!response.ok || !accessToken || typeof expiresIn !== "number" || expiresIn <= 0) {
      throw new PayPalServiceError("authentication");
    }

    this.cachedToken = {
      value: accessToken,
      expiresAt: this.now() + Math.max(1, expiresIn - 60) * 1000,
    };
    return accessToken;
  }

  private async requestApi(path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getAccessToken();
      const response = await this.fetch(`${sandboxApiBaseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status !== 401) {
        return response;
      }

      this.cachedToken = undefined;
      if (attempt === 1) {
        throw new PayPalServiceError("authentication");
      }
    }

    throw new PayPalServiceError("authentication");
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new PayPalServiceError("timeout");
      }
      throw new PayPalServiceError("network");
    }
  }

  private async parseSuccessfulResponse(response: Response): Promise<Record<string, unknown>> {
    const payload = await this.parseResponse(response);
    if (!response.ok) {
      throw new PayPalServiceError("upstream");
    }
    if (!isRecord(payload)) {
      throw new PayPalServiceError("invalid_response");
    }
    return payload;
  }

  private async parseResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new PayPalServiceError(response.ok ? "invalid_response" : "upstream");
    }
  }
}

let sharedService: PayPalRestService | undefined;

export function getPayPalRestService(): PayPalRestService {
  const credentials = getPayPalCredentials();
  if (!credentials) {
    throw new PayPalServiceError("credentials_missing");
  }
  if (!sharedService) {
    sharedService = new PayPalRestService({
      ...credentials,
      invoicerBusinessName: config.PAYPAL_INVOICER_BUSINESS_NAME,
    });
  }
  return sharedService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getPayPalLink(
  links: unknown,
  relations: string[],
): string | null {
  if (!Array.isArray(links)) {
    return null;
  }

  for (const link of links) {
    if (!isRecord(link) || !relations.includes(String(link.rel))) {
      continue;
    }
    const href = readString(link.href);
    if (!href) {
      continue;
    }
    try {
      const parsed = new URL(href);
      if (
        parsed.protocol === "https:" &&
        (parsed.hostname === "paypal.com" || parsed.hostname.endsWith(".paypal.com"))
      ) {
        return href;
      }
    } catch {
      continue;
    }
  }

  return null;
}
