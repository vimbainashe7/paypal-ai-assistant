# PayPal AI Assistant

A hackathon prototype for small-business merchants to prepare PayPal Sandbox orders and invoice drafts with natural language, review them, and inspect Sandbox activity. It does not process live payments.

## Architecture

- `frontend/`: React, TypeScript, Vite, Tailwind CSS, and AG Grid React.
- `backend/`: Node.js, Express, TypeScript, OpenAI function calling, and the official PayPal Agent Toolkit.
- `render.yaml`: Blueprint for one Render web service; Express serves the built frontend in production. A blueprint is configuration, not proof of deployment.

The backend uses OpenAI function calling with a fixed, validated tool allow-list. The merchant must review and explicitly confirm an exact server-stored action before the backend calls PayPal Sandbox. Orders are not captured/paid, and invoice drafts are not sent. All AI and PayPal credentials stay on the server. The PayPal toolkit's OpenAI adapter and backend use compatible OpenAI Node SDK `4.86.1`.

## Prerequisites

- Node.js 22.12 or later.
- npm.
- PayPal Sandbox app credentials and an OpenAI API key to use connected features. The interface and automated tests run without credentials.

## Local setup

From the project root in PowerShell:

```powershell
npm install
Copy-Item .env.example .env
```

Open `.env` in VS Code and enter your own PayPal **Sandbox** credentials and OpenAI API key. Keep the keys private; do not put them in frontend variables, screenshots, source control, or chat. Leave them blank to explore the shell without making external API calls.

Start the app:

```powershell
npm run dev
```

Open **http://localhost:5173**. Vite serves the frontend and forwards `/api` calls to the Express API at `http://localhost:3001`.

## Commands

Run these at the repository root:

```powershell
npm install
npm run dev
npm run build
npm run lint
npm test
```

`npm run build` builds both workspaces, `npm run lint` runs ESLint, and `npm test` runs frontend tests and backend API/service tests. No test creates a PayPal resource or calls a live service.

## Environment variables

See [.env.example](./.env.example). `PAYPAL_ENVIRONMENT` defaults to and only accepts `SANDBOX`. The backend never returns credentials to the browser. Never set real/live PayPal credentials for this prototype.

## Phase 2A: PayPal Sandbox payment API

The installed `@paypal/agent-toolkit@1.11.0` package exports `PayPalAgentToolkit` from its `/openai` entry point, accepts `clientId`, `clientSecret`, and a `configuration` with `context.sandbox` and per-product `actions`, and provides `create_order` and `create_invoice` tools. It also exposes other write tools, so the app must keep its allow-list narrow. The toolkit's order tool has return/cancel URL options, but its invoice create schema does not expose a due date. For the Phase 2A endpoints below, both order and invoice creation use PayPal's official REST API directly; this gives the service explicit fixed redirect URLs, bounded validation, a PayPal request ID for orders, and the supported invoice due-date field. No raw tool name or endpoint is accepted from a browser.

The OAuth client-credentials request, PayPal REST calls, and in-memory token cache run only on the backend. Tokens are refreshed when expired or after a single 401; create calls are not blindly retried on timeouts. All endpoints are fixed to `https://api-m.sandbox.paypal.com`. `PAYPAL_ENVIRONMENT` rejects any value other than `SANDBOX`, and configured return/cancel URLs must share the validated frontend origin (HTTPS except localhost). PayPal secrets and tokens are never returned or logged.

### `POST /api/payments/orders`

Creates a Checkout Orders v2 order with `intent: CAPTURE`. This creates an order only; the buyer must complete PayPal checkout, and this prototype does not capture the order or mark it paid.

Request:

```json
{
  "requestId": "ae1f8c56-0a08-4dcf-a617-909aa8123123",
  "amount": "25.00",
  "currency": "USD",
  "description": "Consultation"
}
```

`requestId` must be a UUID and should be reused for a retry of the same request; use a new UUID for a different order. Only USD is enabled, and the amount must be positive and no greater than USD 10,000. Redirect URLs are configured on the server and cannot be supplied in the request.

Successful response (PayPal IDs, status, and links come from the actual response):

```json
{
  "orderId": "PAYPAL_ORDER_ID",
  "status": "CREATED",
  "approvalUrl": "https://www.sandbox.paypal.com/checkoutnow?...",
  "amount": "25.00",
  "currency": "USD",
  "environment": "SANDBOX",
  "buyerMustCompleteCheckout": true
}
```

`approvalUrl` is `null` when the response has no recognized PayPal payer-action link. The service sends `PayPal-Request-Id` to PayPal, which documents request-id storage for six hours by default.

### `POST /api/payments/invoices`

Creates a **draft invoice only**. It does not send an invoice or claim the recipient was notified. PayPal requires the merchant to have an account in good standing; `PAYPAL_INVOICER_BUSINESS_NAME` must also be set. The recipient email must be valid; the selected merchant account must be able to invoice that recipient.

Request:

```json
{
  "requestId": "ae1f8c56-0a08-4dcf-a617-909aa8123124",
  "recipientEmail": "customer@example.com",
  "currency": "USD",
  "dueDate": "2026-11-10",
  "items": [
    { "name": "Consultation", "description": "One-hour session", "quantity": 1, "unitAmount": "50.00" }
  ]
}
```

`dueDate` is optional and, when provided, must be a real calendar date that is today or later. Each item quantity is 1–100; there can be 1–20 items; each unit price is at most USD 10,000 and the invoice total is at most USD 100,000. The response includes PayPal's invoice ID and status. `invoiceUrl` is returned only if PayPal actually supplies a payer-view link; it is otherwise `null`. `sent` is always `false` for this create-draft endpoint.

PayPal's current Invoicing v2 OpenAPI does not declare `PayPal-Request-Id` for invoice creation. This service therefore prevents duplicate invoice creation only within one running process for the same request ID and details; that protection is lost after a process restart. If a request times out, check the PayPal Sandbox dashboard before retrying with a new request ID.

### Status and testing

Both POST endpoints return `400` for invalid input, `409` if a request ID is reused with different details in the running process, `503` if required Sandbox or invoice configuration is missing, `504` on a timeout, `429` when rate limited, and a safe `502` for PayPal authentication/upstream/network failures. Global Helmet security headers, API rate limiting, a 20 KB JSON limit, and CORS restricted to `FRONTEND_URL` are enabled. Rate-limit/idempotency state is per application process, not a distributed store.

Automated service tests mock OAuth and PayPal responses; they create no PayPal resources. After rotating and configuring your own Sandbox credentials, you can separately verify the integration manually:

```powershell
$order = @{
  requestId = [guid]::NewGuid().ToString()
  amount = "1.00"
  currency = "USD"
  description = "Sandbox integration check"
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3001/api/payments/orders `
  -Method Post -ContentType "application/json" -Body $order
```

Only run the above with Sandbox credentials. Confirm the response says `environment: SANDBOX`, inspect the resulting order in the Sandbox dashboard, and do not complete checkout unless you intend to test the buyer flow. Repeat invoice checks only after setting `PAYPAL_INVOICER_BUSINESS_NAME`. A mocked test pass is not proof of a live Sandbox API call.

For official API details, see [PayPal Orders v2](https://developer.paypal.com/docs/api/orders/v2/), [PayPal Invoicing v2](https://developer.paypal.com/docs/api/invoicing/v2/), the [PayPal REST authentication guide](https://developer.paypal.com/api/rest/authentication/), and PayPal's published [Orders v2 OpenAPI](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/checkout_orders_v2.json) and [Invoicing v2 OpenAPI](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/invoicing_v2.json).

## Phase 2B: AI assistant and action confirmation

The assistant endpoint is `POST /api/assistant/chat`. It accepts a message (1–2,000 characters) and an optional UUID conversation ID. OpenAI may answer normally, ask for a missing or ambiguous detail, return a read-only account result, or propose a validated order/invoice action. An AI tool call only creates a preview in server memory; it does not call PayPal's create API. Successful responses have a `kind` of `message`, `clarification`, `read_result`, or `confirmation_required`; safe endpoint errors use `kind: "error"` and an `error` message.

Example chat request:

```json
{ "message": "Create a $10 Sandbox checkout order for candles." }
```

Confirmation-required response (illustrative IDs and data only):

```json
{
  "kind": "confirmation_required",
  "conversationId": "2e327bba-786a-4609-81f1-c7919db49e8c",
  "message": "Review Sandbox checkout order: USD 10.00 for candles.",
  "proposedAction": {
    "type": "create_sandbox_order",
    "actionId": "b0fd38e4-e6db-4890-8725-4db4fc46df6c",
    "amount": "10.00",
    "currency": "USD",
    "description": "candles"
  }
}
```

The frontend displays exact amounts and, for invoices, the recipient, item and due date before confirmation. `POST /api/assistant/confirm-action` accepts only `{ "conversationId": "...", "actionId": "..." }`. The server retrieves the associated validated action from its pending-action store and uses that stored data; client-edited amounts, recipients, URLs or draft objects are not accepted. The merchant must press **Confirm this exact action**. Success responses use `kind: "created"` and contain the PayPal-returned resource ID/status and any approval/invoice link that PayPal actually returned. An order still needs buyer checkout, while an invoice remains an unsent draft.

`POST /api/assistant/cancel-action` accepts the same two IDs and removes an unstarted proposal from the server's pending-action store. It returns `{ "kind": "cancelled", "actionId": "..." }`; expired IDs return `404`, and actions whose execution has started return `409`. All three assistant endpoints share the assistant request limit.

The model's restricted read-only `list_application_transactions` and `get_invoice_status` tools use the PayPal Agent Toolkit's OpenAI adapter and query the configured Sandbox account. The create-order and create-invoice operations run through the existing validated direct PayPal REST service only after confirmation; the model is not given arbitrary toolkit tools or backend functions. Transaction summaries are limited to the successful records returned for at most 31 days and 100 records; invoice status cannot explain why a recipient has not paid.

Conversation history, pending actions, and duplicate-confirmation results are kept in process memory with expiry and bounded capacity. They do not survive a server restart and are not shared across multiple Render instances. Keep this as a single-instance Sandbox prototype; durable state, authentication, and production financial controls are not implemented.

Automated Phase 2B tests mock OpenAI and PayPal/toolkit results; they do not create Sandbox resources or prove provider connectivity. Run `npm test` and `npm run build` at the repository root. The earlier, separately authorized Phase 2A Sandbox order check is not an end-to-end Phase 2B verification.

## Phase 2C: React chat interface

The React assistant sends chat, confirmation, and cancellation requests to the backend endpoints above; the browser never calls PayPal directly and has no secret-bearing Vite variables. It shows a responsive conversation, suggested prompts, loading and safe error states, an exact proposal card, and PayPal-returned order/invoice links. The **Cancel proposal** button cancels the server-side pending action, rather than only hiding it. A confirmation is submitted once per click sequence; expired proposals are removed from the review UI and reported safely.

Displayed payment-state explanations are derived only from recognized PayPal status values (`CREATED`, `PAYER_ACTION_REQUIRED`, `APPROVED`, `COMPLETED`, `FAILED`, and the documented invoice states handled by the UI). Other values are shown as PayPal-reported without interpreting them. An approved order is not described as paid, a created invoice is described as an unsent draft, and provider/API errors remain failures rather than success-shaped results.

Run the app from PowerShell in the repository root:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173. For real assistant responses, configure `OPENAI_API_KEY` and PayPal Sandbox credentials in the server `.env` only; do not add them to any `VITE_` variable. The automated frontend interactions and backend APIs can be tested without creating PayPal resources:

```powershell
npm test
npm run build
npm run lint
```

The frontend tests use mocked backend responses for chat, confirmation, cancellation, loading, failures, malformed responses, invoice links, and Sandbox order approval links. A mock pass is not proof of an OpenAI or PayPal live connection.

## Phase 2D: AG Grid transaction and activity dashboard

The Activity & Transactions section uses AG Grid Community (`^36.2.0`) to display both application-created records (orders awaiting checkout, draft invoices) and settled PayPal Sandbox transactions loaded via `GET /api/dashboard/records`.

### Grid columns and data behavior
- **Record ID:** Unique internal application record ID (`recordId`).
- **PayPal ID:** Official PayPal resource ID (`paypalId`), or `—` if not assigned.
- **Resource Type:** Explicitly distinguishes `Order`, `Invoice Draft`, and `Settled Payment`.
- **Recipient / Customer:** Displayed for invoices or customer transactions, or `—`.
- **Description:** Purpose or itemized summary.
- **Amount & Currency:** Formatted currency values (e.g. `USD 25.00`).
- **Current Status:** Color-coded status badge (`PAYER_ACTION_REQUIRED`, `CREATED`, `DRAFT`, `COMPLETED`, `PAID`).
- **Creation Date:** Localized date and time.
- **AI Confidence Score:** Intentionally omitted. OpenAI deterministic function calling constraints provide structured parameters without calibrated token logprobs; fabricating percentage scores is strictly disallowed.
- **Sorting & Filtering:** Client-side sorting on all supported columns; text, date, and number column filters; type tabs (`All`, `Orders`, `Invoices`, `Settled`); and status filter (`All`, `Pending`, `Completed`).
- **Pagination:** AG Grid Community client-side pagination with selectable page sizes (10, 25, 50).
- **Row Detail View:** Selecting a row opens an accessible slide-over/modal with full record details, financial state explanation, and direct Sandbox links.
- **Summary Cards:** Accurately calculates separate metrics: Application Orders count & pending value, Invoice Drafts count, Settled Payments count, and Confirmed Received Total with a visible disclaimer (*"Pending orders and drafts are not money received"*).

## Phase 2E: Full application integration and audit

The end-to-end user journeys are verified across the system:
1. App initialization (`/api/health` status check).
2. Natural language prompt processing.
3. OpenAI intent identification with restricted function calling.
4. Server-side Zod parameter validation.
5. Exact proposal review card display.
6. Merchant explicit confirmation or proposal cancellation.
7. Confirmed execution via PayPal Sandbox REST API v2.
8. Real PayPal Sandbox response handling.
9. UI display of reference ID and checkout/invoice approval URLs.
10. Automatic application record logging and display in the AG Grid dashboard.

All secrets remain server-only (`.env` ignored in Git, absent from client bundles). Server endpoints enforce Helmet, CORS, input limits, and error sanitization.

## Product behavior and limits

- **Assistant:** OpenAI uses a fixed function allow-list to answer, clarify, read supported Sandbox data, or prepare a pending order/invoice proposal. The server validates it and binds confirmation to its stored action ID. No side-effecting create happens before explicit confirmation.
- **Orders and invoices:** Only the explicit confirmation route invokes PayPal's Sandbox create operation. The app does not capture/pay orders, send invoices, issue refunds, or claim a payment happened. An order approval link, when returned by PayPal, is a Sandbox link.
- **Transactions:** The dashboard requests both locally recorded application activity and successful PayPal Sandbox transactions from the last 31 days. AG Grid Community supports sorting, per-column text/date/number filters, quick search, pagination, and detail views. Summary cards distinguish confirmed settled payments from uncaptured orders and draft invoices.
- **Invoices:** Account records are loaded from PayPal Sandbox. If transaction loading fails, labeled sample rows are shown; invoice data is never substituted with fabricated records.
- **Availability:** The assistant needs both Sandbox credentials and `OPENAI_API_KEY`; account sections need Sandbox credentials. Health checks, shell UI, and tests can run without keys.
- **Security scope:** This is a Sandbox-only demo, not a production payment service. It has no merchant login or account-level authorization. Keep any public deployment restricted to Sandbox credentials and do not use it to manage real money.

## Render deployment

Deployment has not been performed by this repository setup. To deploy:

1. Push this project to a GitHub repository you control.
2. In Render, create a Blueprint from that repository and review the `paypal-ai-assistant` web service.
3. Enter `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `OPENAI_API_KEY` as private values in Render's environment settings. The Blueprint declares them as unsynced secrets so values are not stored in Git.
4. Set `FRONTEND_URL` to the exact public Render URL and `PAYPAL_INVOICER_BUSINESS_NAME` to your Sandbox merchant business name. The order return/cancel URLs default to fixed paths on that frontend origin.
5. Confirm `PAYPAL_ENVIRONMENT=SANDBOX`, deploy, and open the Render-provided URL.
6. Verify `/api/health` returns `{"status":"ok","environment":"SANDBOX"}`, then test the assistant with a small Sandbox draft and explicitly confirm it. Confirm the result is in the Sandbox account only.

Do not announce a public demo until the deployment URL and these checks have actually been verified. If a separate frontend domain is introduced, set `FRONTEND_URL` to that exact origin in Render; for the current single-service build, the UI and API share an origin.

## Demo plan

1. Name the merchant problem: preparing an accurate payment request takes repetitive form-filling and review.
2. Ask the assistant to prepare an example order with a clear item, quantity, and unit price. Show that it only proposes a draft.
3. Review the exact total and purpose; confirm the Sandbox order; show the PayPal Sandbox reference/approval link and explain that no payment was captured. Also show that a proposal can be cancelled without creating a PayPal item.
4. Open Transactions, demonstrate search, a column filter/sort, and the loaded-row gross summary. Point out the Sandbox/date/row limits.
5. If credentials, network, or provider availability fail, show the prerecorded walkthrough only if you have made one, and label it as a recording. Otherwise use the automated test results and clearly labelled sample rows; do not claim a live integration succeeded.

For a truthful impact result, ask a small number of target merchants to complete the same payment-preparation task with their current process and with this prototype. Record participant count, task definition, elapsed time, completion/error counts, and consent. Report the observed results and limitations only; no impact study has been run yet, so no savings claim is made.

## Outstanding before submission

- Add your own secret keys locally or in Render, then verify real Sandbox behavior; this has not been verified without credentials.
- Publish to a user-approved GitHub repository and deploy from Render; neither has happened yet.
- Provide the official hackathon rules/page to verify category eligibility, judging weights, and the deadline. Prize eligibility and event requirements are not asserted here.
- Run a real user task study and record the demo/backup recording if desired. Neither has been completed.

## Dependency audit note

The current official PayPal Agent Toolkit release pulls transitive runtime dependencies that `npm audit --omit=dev` reported as 12 vulnerabilities (11 high, 1 moderate), with no fixes offered by npm at the time checked. Keep the prototype Sandbox-only and review current toolkit/vendor advisories before any production use.
