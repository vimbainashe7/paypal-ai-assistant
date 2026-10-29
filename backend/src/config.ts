import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const currentDirectoryEnvFile = resolve(process.cwd(), ".env");
const parentDirectoryEnvFile = resolve(process.cwd(), "..", ".env");
dotenv.config({
  path: existsSync(currentDirectoryEnvFile)
    ? currentDirectoryEnvFile
    : parentDirectoryEnvFile,
});

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  PAYPAL_ENVIRONMENT: z.literal("SANDBOX").default("SANDBOX"),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  PAYPAL_RETURN_URL: z.string().url().optional(),
  PAYPAL_CANCEL_URL: z.string().url().optional(),
  PAYPAL_INVOICER_BUSINESS_NAME: z.string().trim().min(1).max(300).optional(),
});

const validatedEnvironment = environmentSchema.parse(process.env);
const frontendUrl = new URL(validatedEnvironment.FRONTEND_URL);
if (
  frontendUrl.username ||
  frontendUrl.password ||
  frontendUrl.pathname !== "/" ||
  frontendUrl.search ||
  frontendUrl.hash
) {
  throw new Error("FRONTEND_URL must be an origin without credentials, path, query, or fragment.");
}

function getTrustedRedirectUrl(
  configuredUrl: string | undefined,
  fallbackPath: string,
): string {
  const redirectUrl = new URL(configuredUrl ?? fallbackPath, frontendUrl);
  const isLocalhost = redirectUrl.hostname === "localhost" || redirectUrl.hostname === "127.0.0.1";
  if (
    redirectUrl.origin !== frontendUrl.origin ||
    (redirectUrl.protocol !== "https:" && !isLocalhost)
  ) {
    throw new Error("PayPal return and cancel URLs must use the configured frontend origin over HTTPS.");
  }

  return redirectUrl.toString();
}

export const config = {
  ...validatedEnvironment,
  FRONTEND_URL: frontendUrl.origin,
  PAYPAL_RETURN_URL: getTrustedRedirectUrl(
    validatedEnvironment.PAYPAL_RETURN_URL,
    "/payments/return",
  ),
  PAYPAL_CANCEL_URL: getTrustedRedirectUrl(
    validatedEnvironment.PAYPAL_CANCEL_URL,
    "/payments/cancel",
  ),
};

export function getPayPalCredentials():
  | { clientId: string; clientSecret: string }
  | undefined {
  const clientId = config.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = config.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }

  return { clientId, clientSecret };
}

export function hasPayPalCredentials(): boolean {
  return getPayPalCredentials() !== undefined;
}
