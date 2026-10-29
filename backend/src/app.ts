import cors from "cors";
import rateLimit from "express-rate-limit";
import express from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { assistantRouter } from "./routes/assistant.js";
import { paymentsRouter } from "./routes/payments.js";
import { paypalDataRouter } from "./routes/paypalData.js";

function getBodyErrorStatus(error: unknown): 400 | 413 | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 400 || error.status === 413)
  ) {
    return error.status;
  }

  return undefined;
}

export const app = express();
app.set("trust proxy", 1);
app.use(helmet());
const frontendBuildPath = fileURLToPath(new URL("../../frontend/dist", import.meta.url));
const frontendIndexPath = fileURLToPath(new URL("../../frontend/dist/index.html", import.meta.url));

app.use(cors({ origin: config.FRONTEND_URL }));
app.use(express.json({ limit: "20kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", environment: config.PAYPAL_ENVIRONMENT });
});

app.use("/api/assistant", assistantRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api", paypalDataRouter);

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API endpoint not found" });
});

if (existsSync(frontendIndexPath)) {
  app.use(express.static(frontendBuildPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(frontendIndexPath);
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const bodyErrorStatus = getBodyErrorStatus(error);
  if (bodyErrorStatus === 400) {
    response.status(400).json({ error: "Request body must contain valid JSON." });
    return;
  }
  if (bodyErrorStatus === 413) {
    response.status(413).json({ error: "Request body must be smaller than 20 KB." });
    return;
  }

  console.error("Unhandled API error", error instanceof Error ? error.name : "UnknownError");
  response.status(500).json({ error: "An unexpected server error occurred" });
});
