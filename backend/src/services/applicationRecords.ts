export type ApplicationResourceType = "order" | "invoice" | "settled_payment";

export interface ApplicationRecord {
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

const MAX_STORED_RECORDS = 1_000;

class ApplicationRecordStore {
  private records: ApplicationRecord[] = [];

  constructor() {
    this.seedDemoRecords();
  }

  addRecord(record: ApplicationRecord): void {
    // Prevent duplicate entries by recordId
    const existingIndex = this.records.findIndex((r) => r.recordId === record.recordId);
    if (existingIndex >= 0) {
      this.records[existingIndex] = record;
      return;
    }

    this.records.unshift(record);
    if (this.records.length > MAX_STORED_RECORDS) {
      this.records = this.records.slice(0, MAX_STORED_RECORDS);
    }
  }

  getRecords(): ApplicationRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
  }

  resetWithDemo(): void {
    this.clear();
    this.seedDemoRecords();
  }

  private seedDemoRecords(): void {
    // Initial sample records labeled as demo data to allow immediate exploration
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    this.records = [
      {
        recordId: "app-rec-demo-1",
        paypalId: "SANDBOX-ORDER-DEMO-01",
        resourceType: "order",
        recipient: null,
        description: "Handmade Scented Candles · Sample Order",
        amount: 36.0,
        currency: "USD",
        status: "PAYER_ACTION_REQUIRED",
        isSettledPayment: false,
        createdAt: twoDaysAgo.toISOString(),
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=demo-order",
        invoiceUrl: null,
      },
      {
        recordId: "app-rec-demo-2",
        paypalId: "SANDBOX-INV-DEMO-02",
        resourceType: "invoice",
        recipient: "client@example.com",
        description: "Consulting & Strategy Session · Sample Draft",
        amount: 150.0,
        currency: "USD",
        status: "DRAFT",
        isSettledPayment: false,
        createdAt: fiveDaysAgo.toISOString(),
        approvalUrl: null,
        invoiceUrl: "https://www.sandbox.paypal.com/invoice/p/#demo-invoice",
      },
    ];
  }
}

export const applicationRecordStore = new ApplicationRecordStore();
