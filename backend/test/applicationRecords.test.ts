import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import {
  applicationRecordStore,
  type ApplicationRecord,
} from "../src/services/applicationRecords.js";

describe("Application Record Store & Dashboard Records API", () => {
  beforeEach(() => {
    applicationRecordStore.resetWithDemo();
  });

  it("adds and retrieves application records accurately", () => {
    const testRecord: ApplicationRecord = {
      recordId: "test-rec-1",
      paypalId: "SANDBOX-ORDER-999",
      resourceType: "order",
      recipient: null,
      description: "Test product order",
      amount: 42.5,
      currency: "USD",
      status: "CREATED",
      isSettledPayment: false,
      createdAt: new Date().toISOString(),
      approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=test",
      invoiceUrl: null,
    };

    applicationRecordStore.addRecord(testRecord);
    const records = applicationRecordStore.getRecords();
    expect(records[0]).toEqual(testRecord);
  });

  it("distinguishes pending orders from settled payments in the store", () => {
    const orderRecord: ApplicationRecord = {
      recordId: "order-pending",
      paypalId: "ORDER-1",
      resourceType: "order",
      recipient: null,
      description: "Order awaiting buyer checkout",
      amount: 50.0,
      currency: "USD",
      status: "PAYER_ACTION_REQUIRED",
      isSettledPayment: false,
      createdAt: new Date().toISOString(),
    };

    const settledRecord: ApplicationRecord = {
      recordId: "payment-settled",
      paypalId: "TX-1",
      resourceType: "settled_payment",
      recipient: null,
      description: "Captured payment",
      amount: 50.0,
      currency: "USD",
      status: "COMPLETED",
      isSettledPayment: true,
      createdAt: new Date().toISOString(),
    };

    applicationRecordStore.addRecord(orderRecord);
    applicationRecordStore.addRecord(settledRecord);

    const records = applicationRecordStore.getRecords();
    const foundOrder = records.find((r) => r.recordId === "order-pending");
    const foundSettled = records.find((r) => r.recordId === "payment-settled");

    expect(foundOrder?.isSettledPayment).toBe(false);
    expect(foundSettled?.isSettledPayment).toBe(true);
  });

  it("serves GET /api/dashboard/records with application records and sandbox environment tag", async () => {
    const response = await request(app).get("/api/dashboard/records");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("records");
    expect(Array.isArray(response.body.records)).toBe(true);
    expect(response.body.environment).toBe("SANDBOX");
    expect(response.body.records.length).toBeGreaterThan(0);

    const firstRecord = response.body.records[0];
    expect(firstRecord).toHaveProperty("recordId");
    expect(firstRecord).toHaveProperty("resourceType");
    expect(firstRecord).toHaveProperty("amount");
    expect(firstRecord).toHaveProperty("currency");
    expect(firstRecord).toHaveProperty("status");
    expect(firstRecord).toHaveProperty("isSettledPayment");
  });
});
