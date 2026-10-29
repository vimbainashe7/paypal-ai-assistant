import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ApiError,
  cancelPendingAction,
  chatAssistant,
  confirmPendingAction,
  getHealth,
  getInvoices,
  type AssistantChatResult,
  type AssistantExecutionResult,
  type ProposedPaymentAction,
  type InvoiceRow,
} from "./api";

const TransactionsSection = lazy(() => import("./TransactionsSection"));

type Section = "AI Assistant" | "Transactions" | "Invoices";

const navigation: Section[] = ["AI Assistant", "Transactions", "Invoices"];
const examplePrompts = [
  "Create a $10 Sandbox checkout order for candles.",
  "Prepare a $45 invoice for consulting for customer@example.com.",
  "Summarize my recent Sandbox transactions.",
];

function App() {
  const [section, setSection] = useState<Section>("AI Assistant");
  const [apiState, setApiState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function checkBackend() {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (!active) {
          return;
        }

        try {
          await getHealth();
          if (active) {
            setApiState("ready");
          }
          return;
        } catch {
          if (attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        }
      }

      if (active) {
        setApiState("error");
      }
    }

    void checkBackend();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a className="flex items-center gap-3" href="/" aria-label="PayPal AI Assistant home">
            <span className="grid size-10 place-items-center rounded-xl bg-[#003087] text-lg font-bold text-white">
              P
            </span>
            <span>
              <span className="block text-base font-semibold">PayPal AI Assistant</span>
              <span className="block text-xs text-slate-500">Small business workspace</span>
            </span>
          </a>
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">
            <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
            SANDBOX · Demo environment
          </span>
        </div>
      </header>

      <div className="mx-auto grid min-w-0 max-w-7xl grid-cols-1 gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="min-w-0" aria-label="Main navigation">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <ul className="flex min-w-0 max-w-full gap-2 overflow-x-auto lg:flex-col">
            {navigation.map((item, index) => (
              <li key={item}>
                <button
                  type="button"
                  aria-current={section === item ? "page" : undefined}
                  onClick={() => setSection(item)}
                  className={`flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    section === item
                      ? "bg-blue-50 text-[#003087]"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  <span className="grid size-6 place-items-center rounded-md bg-white text-xs text-slate-500">
                    {index + 1}
                  </span>
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          <div
            className={`mb-5 rounded-lg px-4 py-3 text-sm ${
              apiState === "error"
                ? "border border-red-200 bg-red-50 text-red-800"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
            role="status"
            aria-live="polite"
          >
            {apiState === "loading" && "Checking backend connection…"}
            {apiState === "ready" && "Backend is ready"}
            {apiState === "error" && "Backend unavailable. Start the server to enable API features."}
          </div>
          {section === "AI Assistant" && <AssistantSection />}
          {section === "Transactions" && (
            <Suspense fallback={<p role="status">Loading the transaction dashboard…</p>}>
              <TransactionsSection />
            </Suspense>
          )}
          {section === "Invoices" && <InvoicesSection />}
        </main>
      </div>
    </div>
  );
}

function InvoicesSection() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getInvoices()
      .then(setInvoices)
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Sandbox invoice data could not be loaded.",
        );
      })
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <section aria-labelledby="invoices-title">
      <PageHeading
        eyebrow="Billing"
        title="Invoices"
        description="Review invoice drafts and records in your PayPal sandbox account."
      />
      {isLoading && <p className="mb-4 text-sm text-slate-600" role="status">Loading sandbox invoices…</p>}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}
      {!isLoading && !error && invoices.length === 0 && (
        <EmptyState
          title="No sandbox invoices found"
          message="No invoices are available for this sandbox account yet. Ask the assistant to prepare an invoice draft."
        />
      )}
      {invoices.length > 0 && (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{invoice.id}</p>
                <p className="mt-1 text-sm text-slate-600">{invoice.date} · {invoice.status}</p>
              </div>
              <span className="text-sm font-semibold">{invoice.amount}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssistantSection() {
  const [prompt, setPrompt] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [pendingAction, setPendingAction] = useState<{
    conversationId: string;
    action: ProposedPaymentAction;
  } | null>(null);
  const [created, setCreated] = useState<AssistantExecutionResult | null>(null);
  const [lastReadResult, setLastReadResult] = useState<AssistantChatResult | null>(null);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const confirmationInFlight = useRef(false);

  async function handleChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || isSending || isConfirming || pendingAction) return;
    setError("");
    setPendingAction(null);
    setCreated(null);
    setLastReadResult(null);
    setMessages((current) => [...current, { role: "user", text: message }]);
    setPrompt("");
    setIsSending(true);

    try {
      const result = await chatAssistant(message, conversationId);
      setConversationId(result.conversationId);
      setMessages((current) => [...current, { role: "assistant", text: result.message }]);
      if (result.kind === "confirmation_required") {
        setPendingAction({
          conversationId: result.conversationId,
          action: result.proposedAction,
        });
      } else if (result.kind === "read_result") {
        setLastReadResult(result);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The assistant could not complete this request.",
      );
    } finally {
      setIsSending(false);
    }
  }

  async function handleConfirm() {
    if (!pendingAction || confirmationInFlight.current) {
      return;
    }

    confirmationInFlight.current = true;
    setError("");
    setCreated(null);
    const action = pendingAction;
    setPendingAction(null);
    setIsConfirming(true);
    try {
      const execution = await confirmPendingAction(
        action.conversationId,
        action.action.actionId,
      );
      setCreated(execution);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The confirmed Sandbox action could not be completed. Check PayPal before retrying.",
      );
    } finally {
      confirmationInFlight.current = false;
      setIsConfirming(false);
    }
  }

  async function handleCancel() {
    if (!pendingAction || isCancelling || confirmationInFlight.current) {
      return;
    }

    setError("");
    setIsCancelling(true);
    try {
      await cancelPendingAction(
        pendingAction.conversationId,
        pendingAction.action.actionId,
      );
      setPendingAction(null);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "The pending proposal was cancelled. No PayPal item was created." },
      ]);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 404) {
        setPendingAction(null);
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The proposal could not be cancelled. Check its status before continuing.",
      );
    } finally {
      setIsCancelling(false);
    }
  }

  function chooseExample(example: string) {
    setPrompt(example);
    document.getElementById("assistant-prompt")?.focus();
  }

  return (
    <section aria-labelledby="assistant-title">
      <PageHeading
        eyebrow="Your business, in plain language"
        title="Ask your PayPal assistant"
        description="Ask a question, review Sandbox activity, or prepare an order or invoice. Nothing is created until you review and confirm the exact proposal."
      />
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-7">
          <div>
            <h2 className="font-semibold text-slate-900">Merchant assistant</h2>
            <p className="mt-1 text-xs text-slate-600">AI-assisted · Sandbox only</p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
            SANDBOX
          </span>
        </div>
        <div
          className="max-h-[28rem] min-h-48 space-y-3 overflow-y-auto bg-slate-50 p-4 sm:p-6"
          aria-label="Assistant conversation"
          aria-live="polite"
          role="log"
        >
          {messages.length === 0 ? (
            <div className="mx-auto flex min-h-40 max-w-lg flex-col items-center justify-center text-center">
              <span className="mb-3 grid size-11 place-items-center rounded-full bg-blue-100 font-bold text-[#003087]" aria-hidden="true">
                AI
              </span>
              <p className="font-semibold text-slate-900">What would you like help with?</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Ask a question or describe a Sandbox order or invoice to prepare.
              </p>
            </div>
          ) : (
            messages.map((entry, index) => (
              <div
                key={`${entry.role}-${index}`}
                className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <article
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm sm:max-w-[80%] ${
                    entry.role === "user"
                      ? "rounded-br-md bg-[#003087] text-white"
                      : "rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm"
                  }`}
                >
                  <p className={`mb-1 text-xs font-semibold ${entry.role === "user" ? "text-blue-100" : "text-slate-500"}`}>
                    {entry.role === "user" ? "You" : "PayPal AI Assistant"}
                  </p>
                  <p className="whitespace-pre-wrap leading-6">{entry.text}</p>
                </article>
              </div>
            ))
          )}
          {isSending && (
            <div className="flex justify-start">
              <p className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600" role="status">
                Assistant is thinking…
              </p>
            </div>
          )}
        </div>
        {messages.length === 0 && (
          <div className="border-t border-slate-100 px-4 py-4 sm:px-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Try an example</p>
            <div className="flex flex-wrap gap-2">
              {examplePrompts.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => chooseExample(example)}
                  disabled={isSending || isConfirming}
                  className="rounded-full border border-slate-300 bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 hover:border-blue-500 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        <form onSubmit={handleChat} className="border-t border-slate-200 p-4 sm:p-6">
          <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="assistant-prompt">
            Message
          </label>
          <textarea
            id="assistant-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
            maxLength={2000}
            required
            disabled={Boolean(pendingAction) || isSending || isConfirming}
            placeholder="Ask a question or describe what you need…"
            aria-describedby="assistant-input-help"
            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition placeholder:text-slate-500 focus:border-blue-700 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id="assistant-input-help" className="text-xs leading-5 text-slate-600">
              Up to 2,000 characters · Press Ctrl+Enter to send. Orders are not paid automatically; invoices are not sent.
            </p>
            <button
              type="submit"
              disabled={!prompt.trim() || isSending || isConfirming || Boolean(pendingAction)}
              className="min-h-11 w-full rounded-lg bg-[#003087] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isSending ? "Thinking…" : "Send message"}
            </button>
          </div>
        </form>
      </div>
      {isSending && <p className="mt-4 text-sm text-slate-600" role="status">Assistant is responding…</p>}
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}
      {pendingAction && (
        <section
          aria-labelledby="pending-action-title"
          className="mt-5 space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950"
        >
          <div>
            <h2 id="pending-action-title" className="font-semibold">
              Proposed action · Review before confirming
            </h2>
            {pendingAction.action.type === "create_sandbox_order" ? (
              <>
                <p className="mt-2">
                  Checkout order: {pendingAction.action.currency} {pendingAction.action.amount}
                </p>
                <p>Purpose: {pendingAction.action.description ?? "Not specified"}</p>
                <p className="mt-1">The buyer must complete checkout. This does not take payment.</p>
              </>
            ) : (
              <>
                <p className="mt-2">
                  Invoice draft: {pendingAction.action.currency} {pendingAction.action.amount}
                </p>
                <p>Recipient: {pendingAction.action.recipientEmail}</p>
                <p>Item or service: {pendingAction.action.description}</p>
                {pendingAction.action.dueDate && <p>Due date: {pendingAction.action.dueDate}</p>}
                <p className="mt-1">Confirmation creates a draft only; it will not be sent.</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirming || isSending}
            className="min-h-11 w-full rounded-lg bg-[#003087] px-5 py-2.5 font-semibold text-white transition hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isConfirming ? "Submitting confirmation…" : "Confirm this exact action"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isCancelling || isConfirming || isSending}
            className="min-h-11 w-full rounded-lg border border-slate-400 bg-white px-5 py-2.5 font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-2 sm:w-auto"
          >
            {isCancelling ? "Cancelling…" : "Cancel proposal"}
          </button>
        </section>
      )}
      {created && (
        <section
          aria-labelledby="action-result-title"
          className="mt-5 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950"
          role="status"
        >
          <h2 id="action-result-title" className="font-semibold">
            {created.action.type === "create_sandbox_order"
              ? "Sandbox checkout order created"
              : "Sandbox invoice draft created"}
          </h2>
          <p>{created.message}</p>
          <p>PayPal reference: {created.resource.id}</p>
          <p>
            PayPal status: <span className="font-semibold">{created.resource.status}</span>
            {" · "}{describeExecutionStatus(created.action.type, created.resource.status)}
          </p>
          {created.action.type === "create_invoice" && (
            <div className="rounded-lg border border-emerald-200 bg-white/70 p-3">
              <p>Invoice total: {created.action.currency} {created.action.amount}</p>
              <p>Recipient: {created.action.recipientEmail}</p>
              <p>Item or service: {created.action.description}</p>
              {created.action.dueDate && <p>Due date: {created.action.dueDate}</p>}
              <p className="mt-1 text-xs">This invoice was not sent unless PayPal explicitly reports otherwise.</p>
            </div>
          )}
          {created.resource.approvalUrl && (
            <a
              className="inline-flex font-semibold text-blue-800 underline"
              href={created.resource.approvalUrl}
              target="_blank"
              rel="noreferrer"
            >
              Continue to PayPal Sandbox checkout
            </a>
          )}
          {created.resource.invoiceUrl && (
            <a
              className="inline-flex font-semibold text-blue-800 underline"
              href={created.resource.invoiceUrl}
              target="_blank"
              rel="noreferrer"
            >
              View PayPal Sandbox invoice
            </a>
          )}
          {created.action.type === "create_invoice" &&
            !created.resource.invoiceUrl && (
              <p className="text-xs text-emerald-900">
                PayPal did not return an invoice link. The invoice is an unsent draft.
              </p>
            )}
        </section>
      )}
      {lastReadResult?.kind === "read_result" && (
        <section
          aria-labelledby="read-result-title"
          className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm"
          role="status"
        >
          <h2 id="read-result-title" className="font-semibold">PayPal Sandbox account data</h2>
          {lastReadResult.data.type === "transaction_summary" ? (
            <>
              <p className="mt-2">
                {lastReadResult.data.count} successful transaction records in the last{" "}
                {lastReadResult.data.periodDays} days.
              </p>
              {lastReadResult.data.grossByCurrency.map((total) => (
                <p key={total.currency}>
                  Gross amount returned by PayPal: {total.currency} {total.amount}
                </p>
              ))}
            </>
          ) : (
            <>
              <p className="mt-2">
                Invoice {lastReadResult.data.invoiceId}: {lastReadResult.data.status}
              </p>
              {lastReadResult.data.dueAmount && lastReadResult.data.dueCurrency && (
                <p>
                  PayPal-reported amount due: {lastReadResult.data.dueCurrency}{" "}
                  {lastReadResult.data.dueAmount}
                </p>
              )}
              <p className="mt-1 text-slate-600">
                The status alone does not explain why a recipient has not paid.
              </p>
            </>
          )}
        </section>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {["Prepare a payment order", "Draft an invoice", "Ask about Sandbox activity"].map((item) => (
          <div key={item} className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function describeExecutionStatus(actionType: ProposedPaymentAction["type"], status: string): string {
  if (actionType === "create_sandbox_order") {
    switch (status) {
      case "CREATED":
      case "PAYER_ACTION_REQUIRED":
        return "Pending — buyer checkout is still required.";
      case "APPROVED":
        return "Approved by the buyer; PayPal does not report it as completed.";
      case "COMPLETED":
        return "Completed according to the PayPal order status.";
      case "VOIDED":
        return "Voided according to PayPal.";
      case "FAILED":
        return "Failed according to PayPal.";
      default:
        return `PayPal reports ${status}; no further payment state is inferred.`;
    }
  }

  switch (status) {
    case "DRAFT":
      return "Pending — this invoice draft has not been sent.";
    case "SENT":
    case "SCHEDULED":
      return "Pending — PayPal reports the invoice is awaiting payment.";
    case "PARTIALLY_PAID":
      return "Partially paid according to PayPal; the remaining balance is not assumed.";
    case "PAID":
      return "Completed — PayPal reports the invoice as paid.";
    case "CANCELLED":
      return "Cancelled according to PayPal.";
    case "REFUNDED":
      return "Refunded according to PayPal.";
    default:
      return `PayPal reports ${status}; no further payment state is inferred.`;
  }
}

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-700">{eyebrow}</p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">{message}</p>
    </div>
  );
}

export default App;
