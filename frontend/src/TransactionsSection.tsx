import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  DateFilterModule,
  ModuleRegistry,
  NumberFilterModule,
  PaginationModule,
  QuickFilterModule,
  TextFilterModule,
  ValidationModule,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  getDashboardRecords,
  type ApplicationResourceType,
  type DashboardRecord,
} from "./api";

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  PaginationModule,
  CellStyleModule,
  DateFilterModule,
  NumberFilterModule,
  TextFilterModule,
  QuickFilterModule,
  ...(import.meta.env.DEV ? [ValidationModule] : []),
]);

const fallbackDemoRecords: DashboardRecord[] = [
  {
    recordId: "demo-rec-001",
    paypalId: "SANDBOX-ORDER-991",
    resourceType: "order",
    recipient: null,
    description: "Handmade Scented Candle Gift Set · Demo order",
    amount: 45.0,
    currency: "USD",
    status: "PAYER_ACTION_REQUIRED",
    isSettledPayment: false,
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=demo-order-1",
    invoiceUrl: null,
  },
  {
    recordId: "demo-rec-002",
    paypalId: "SANDBOX-INV-882",
    resourceType: "invoice",
    recipient: "client@example.com",
    description: "Quarterly Strategy Consultation · Demo draft",
    amount: 175.0,
    currency: "USD",
    status: "DRAFT",
    isSettledPayment: false,
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
    approvalUrl: null,
    invoiceUrl: "https://www.sandbox.paypal.com/invoice/p/#demo-inv-2",
  },
  {
    recordId: "demo-rec-003",
    paypalId: "PAYPAL-TX-773",
    resourceType: "settled_payment",
    recipient: null,
    description: "Website Maintenance Package · Settled payment",
    amount: 220.0,
    currency: "USD",
    status: "COMPLETED",
    isSettledPayment: true,
    createdAt: new Date(Date.now() - 3600000 * 120).toISOString(),
    approvalUrl: null,
    invoiceUrl: null,
  },
];

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return isoString;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return isoString;
  }
}

export default function TransactionsSection() {
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [resourceFilter, setResourceFilter] = useState<"ALL" | ApplicationResourceType>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "COMPLETED">("ALL");
  const [selectedRecord, setSelectedRecord] = useState<DashboardRecord | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const data = await getDashboardRecords();
      setRecords(data.records);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Dashboard data could not be loaded from the backend.",
      );
      setRecords(fallbackDemoRecords);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    let orderCount = 0;
    let invoiceCount = 0;
    let settledPaymentCount = 0;
    let settledGrossUSD = 0;
    let pendingOrderGrossUSD = 0;

    for (const record of records) {
      if (record.resourceType === "order") {
        orderCount += 1;
        if (!record.isSettledPayment) {
          pendingOrderGrossUSD += record.amount;
        }
      } else if (record.resourceType === "invoice") {
        invoiceCount += 1;
      }

      if (record.isSettledPayment || record.status === "COMPLETED" || record.status === "PAID") {
        settledPaymentCount += 1;
        settledGrossUSD += record.amount;
      }
    }

    return {
      orderCount,
      invoiceCount,
      settledPaymentCount,
      settledGrossUSD,
      pendingOrderGrossUSD,
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (resourceFilter !== "ALL" && record.resourceType !== resourceFilter) {
        return false;
      }

      if (statusFilter === "COMPLETED") {
        const isCompleted =
          record.isSettledPayment || record.status === "COMPLETED" || record.status === "PAID";
        if (!isCompleted) return false;
      } else if (statusFilter === "PENDING") {
        const isCompleted =
          record.isSettledPayment || record.status === "COMPLETED" || record.status === "PAID";
        if (isCompleted) return false;
      }

      if (!searchText.trim()) return true;

      const query = searchText.trim().toLowerCase();
      const searchable = [
        record.recordId,
        record.paypalId ?? "",
        record.recipient ?? "",
        record.description,
        record.status,
        record.resourceType,
        String(record.amount),
        record.currency,
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [records, resourceFilter, statusFilter, searchText]);

  const columns = useMemo<ColDef<DashboardRecord>[]>(
    () => [
      {
        field: "recordId",
        headerName: "Record ID",
        width: 155,
        filter: "agTextColumnFilter",
        cellRenderer: (params: ICellRendererParams<DashboardRecord>) => (
          <span className="font-mono text-xs text-slate-700" title={params.value}>
            {params.value}
          </span>
        ),
      },
      {
        field: "paypalId",
        headerName: "PayPal ID",
        width: 170,
        filter: "agTextColumnFilter",
        valueFormatter: (params) => params.value ?? "—",
        cellRenderer: (params: ICellRendererParams<DashboardRecord>) =>
          params.value ? (
            <span className="font-mono text-xs font-semibold text-blue-900" title={params.value}>
              {params.value}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      {
        field: "resourceType",
        headerName: "Type",
        width: 135,
        filter: "agTextColumnFilter",
        cellRenderer: (params: ICellRendererParams<DashboardRecord>) => {
          const type = params.data?.resourceType;
          if (type === "order") {
            return (
              <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                Order
              </span>
            );
          }
          if (type === "invoice") {
            return (
              <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 border border-purple-200">
                Invoice Draft
              </span>
            );
          }
          return (
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 border border-emerald-200">
              Settled Payment
            </span>
          );
        },
      },
      {
        field: "recipient",
        headerName: "Recipient / Customer",
        width: 180,
        filter: "agTextColumnFilter",
        valueFormatter: (params) => params.value ?? "—",
      },
      {
        field: "description",
        headerName: "Description",
        minWidth: 200,
        flex: 1,
        filter: "agTextColumnFilter",
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 125,
        type: "rightAligned",
        filter: "agNumberColumnFilter",
        valueFormatter: (params) =>
          typeof params.value === "number"
            ? `${params.data?.currency ?? "USD"} ${params.value.toFixed(2)}`
            : "—",
        cellRenderer: (params: ICellRendererParams<DashboardRecord>) => (
          <span className="font-semibold text-slate-900">
            {typeof params.value === "number"
              ? `${params.data?.currency ?? "USD"} ${params.value.toFixed(2)}`
              : "—"}
          </span>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 155,
        filter: "agTextColumnFilter",
        cellRenderer: (params: ICellRendererParams<DashboardRecord>) => {
          const status = params.value as string;
          const isSettled = params.data?.isSettledPayment;

          if (isSettled || status === "COMPLETED" || status === "PAID") {
            return (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {status}
              </span>
            );
          }

          if (status === "PAYER_ACTION_REQUIRED" || status === "CREATED" || status === "DRAFT") {
            return (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                <span className="size-1.5 rounded-full bg-amber-500" />
                {status === "PAYER_ACTION_REQUIRED" ? "Checkout Required" : status}
              </span>
            );
          }

          return (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
              {status}
            </span>
          );
        },
      },
      {
        field: "createdAt",
        headerName: "Creation Date",
        width: 175,
        filter: "agDateColumnFilter",
        valueFormatter: (params) => (params.value ? formatDate(params.value) : "—"),
      },
      {
        headerName: "Action",
        width: 90,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<DashboardRecord>) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (params.data) setSelectedRecord(params.data);
            }}
            className="rounded px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
          >
            View
          </button>
        ),
      },
    ],
    [],
  );

  const handleRowClicked = (event: RowClickedEvent<DashboardRecord>) => {
    if (event.data) {
      setSelectedRecord(event.data);
    }
  };

  return (
    <section aria-labelledby="dashboard-title" className="space-y-6">
      {/* Header and Title */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              Activity &amp; Dashboard
            </p>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
              SANDBOX
            </span>
          </div>
          <h1 id="dashboard-title" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Transactions &amp; Activity
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Review PayPal Sandbox orders, invoice drafts, and settled payments with live AG Grid data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData(true)}
          disabled={isLoading || isRefreshing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Analytics Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Application Orders</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{metrics.orderCount}</p>
          <p className="mt-1 text-xs text-slate-500">
            Pending buyer checkout: USD {metrics.pendingOrderGrossUSD.toFixed(2)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Invoice Drafts</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{metrics.invoiceCount}</p>
          <p className="mt-1 text-xs text-slate-500">Created as unsent drafts in Sandbox</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Settled Payments</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{metrics.settledPaymentCount}</p>
          <p className="mt-1 text-xs text-slate-500">Verified completed payments</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Confirmed Received Total</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            USD {metrics.settledGrossUSD.toFixed(2)}
          </p>
          <p className="mt-1 text-xs font-medium text-amber-700">
            *Excludes uncaptured orders &amp; drafts
          </p>
        </div>
      </div>

      {/* Financial Notice / Disclaimer */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
        <p className="font-semibold">Financial Data Integrity &amp; AI Confidence Policy</p>
        <p className="mt-0.5">
          Locally created orders require buyer checkout before capture; draft invoices have not been sent.
          Only records labeled <span className="font-bold text-emerald-900">Settled Payment</span> represent confirmed funds received in PayPal Sandbox.
          AI confidence score column is intentionally omitted to avoid fabricating percentages, adhering to strict OpenAI deterministic function calling constraints.
        </p>
      </div>

      {/* Controls: Search & Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-slate-400">Filter by Type:</span>
          {(["ALL", "order", "invoice", "settled_payment"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setResourceFilter(type)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                resourceFilter === type
                  ? "bg-[#003087] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {type === "ALL"
                ? `All (${records.length})`
                : type === "order"
                  ? `Orders (${metrics.orderCount})`
                  : type === "invoice"
                    ? `Invoices (${metrics.invoiceCount})`
                    : `Settled (${metrics.settledPaymentCount})`}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-slate-400">Status:</span>
          {(["ALL", "PENDING", "COMPLETED"] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                statusFilter === status
                  ? "bg-slate-800 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {status === "ALL" ? "All" : status === "PENDING" ? "Pending / Draft" : "Completed"}
            </button>
          ))}
        </div>

        <div className="relative min-w-56">
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search records, IDs, amounts…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {/* States: Loading, Error, Table */}
      {isLoading && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-600" role="status">
          <span className="inline-block animate-spin mr-2">⏳</span> Loading dashboard activity records…
        </div>
      )}

      {error && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">Notice: Live Sandbox query unavailable</p>
          <p className="mt-1">{error}</p>
          <p className="mt-1 text-xs text-amber-800">
            Displaying local application records and sample demonstration records below.
          </p>
        </div>
      )}

      {!isLoading && filteredRecords.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-slate-900">No records found</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
            No transactions match the selected filters. Clear filters or ask the assistant to prepare an order or invoice.
          </p>
          {(resourceFilter !== "ALL" || statusFilter !== "ALL" || searchText) && (
            <button
              type="button"
              onClick={() => {
                setResourceFilter("ALL");
                setStatusFilter("ALL");
                setSearchText("");
              }}
              className="mt-4 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {filteredRecords.length > 0 && (
        <div className="h-[28rem] w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <AgGridReact
            rowData={filteredRecords}
            columnDefs={columns}
            defaultColDef={{
              sortable: true,
              resizable: true,
              floatingFilter: true,
            }}
            pagination={true}
            paginationPageSize={10}
            paginationPageSizeSelector={[10, 25, 50]}
            onRowClicked={handleRowClicked}
            animateRows={true}
            theme={themeQuartz}
          />
        </div>
      )}

      {/* Selected Row Detail View Modal / Drawer */}
      {selectedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-detail-title"
          onClick={() => setSelectedRecord(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700">
                  Record Details
                </span>
                <h3 id="record-detail-title" className="text-lg font-bold text-slate-900">
                  {selectedRecord.resourceType === "order"
                    ? "PayPal Checkout Order"
                    : selectedRecord.resourceType === "invoice"
                      ? "PayPal Invoice Draft"
                      : "Settled Transaction"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close details"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div
                className={`rounded-lg p-3 ${
                  selectedRecord.isSettledPayment
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
                    : "border border-amber-200 bg-amber-50 text-amber-950"
                }`}
              >
                <p className="font-semibold">
                  Status: {selectedRecord.status}
                </p>
                <p className="mt-1 text-xs">
                  {selectedRecord.isSettledPayment
                    ? "This payment is confirmed and settled in your PayPal Sandbox account."
                    : selectedRecord.resourceType === "order"
                      ? "This order requires buyer checkout completion. Funds have NOT been captured."
                      : "This invoice is an unsent draft and has NOT been paid."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-medium text-slate-500">Record ID:</span>
                  <p className="font-mono text-slate-800 break-all">{selectedRecord.recordId}</p>
                </div>
                <div>
                  <span className="font-medium text-slate-500">PayPal Resource ID:</span>
                  <p className="font-mono font-semibold text-blue-900">
                    {selectedRecord.paypalId ?? "Not assigned"}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-slate-500">Amount &amp; Currency:</span>
                  <p className="font-semibold text-slate-900">
                    {selectedRecord.currency} {selectedRecord.amount.toFixed(2)}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-slate-500">Created:</span>
                  <p className="text-slate-800">{formatDate(selectedRecord.createdAt)}</p>
                </div>
              </div>

              {selectedRecord.recipient && (
                <div className="text-xs">
                  <span className="font-medium text-slate-500">Recipient / Customer:</span>
                  <p className="text-slate-800">{selectedRecord.recipient}</p>
                </div>
              )}

              <div className="text-xs">
                <span className="font-medium text-slate-500">Description:</span>
                <p className="mt-0.5 rounded border border-slate-100 bg-slate-50 p-2 text-slate-700">
                  {selectedRecord.description}
                </p>
              </div>

              {selectedRecord.approvalUrl && (
                <div className="pt-2">
                  <a
                    href={selectedRecord.approvalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center rounded-lg bg-[#003087] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-900"
                  >
                    Open PayPal Sandbox Checkout Link ↗
                  </a>
                </div>
              )}

              {selectedRecord.invoiceUrl && (
                <div className="pt-2">
                  <a
                    href={selectedRecord.invoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center rounded-lg bg-[#003087] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-900"
                  >
                    Open PayPal Sandbox Invoice Link ↗
                  </a>
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-slate-100 pt-3 text-right">
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
