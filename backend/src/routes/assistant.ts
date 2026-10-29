import { Router } from "express";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { assistantAgent } from "../services/assistantAgent.js";
import { PayPalServiceError } from "../services/paypalRest.js";

const chatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    conversationId: z.string().uuid().optional(),
  })
  .strict();

const confirmRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    actionId: z.string().uuid(),
  })
  .strict();

export const assistantRouter = Router();

const assistantRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    sendError(response, 429, "Too many assistant requests. Wait before trying again.");
  },
});

assistantRouter.post("/chat", assistantRateLimit, async (request, response) => {
  const parsed = chatRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(
      response,
      400,
      "Provide a message between 1 and 2,000 characters and an optional valid conversationId.",
    );
    return;
  }
  if (!config.OPENAI_API_KEY) {
    sendError(response, 503, "Configure OPENAI_API_KEY in the server environment to use the assistant.");
    return;
  }

  try {
    response.json(
      await assistantAgent.chat(parsed.data.message, parsed.data.conversationId),
    );
  } catch (error) {
    sendAssistantError(response, error, "The assistant could not complete this request.");
  }
});

assistantRouter.post("/confirm-action", assistantRateLimit, async (request, response) => {
  const parsed = confirmRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(
      response,
      400,
      "Confirm using the conversation and pending action shown in the review preview.",
    );
    return;
  }

  try {
    response.json(
      await assistantAgent.confirm(parsed.data.conversationId, parsed.data.actionId),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "pending_action_not_found") {
      sendError(
        response,
        404,
        "This confirmation expired or does not belong to this conversation. Prepare it again.",
      );
      return;
    }
    if (error instanceof Error && error.message === "action_failed_do_not_retry") {
      sendError(
        response,
        409,
        "The result of the previous attempt is uncertain. Check PayPal Sandbox before creating another request.",
      );
      return;
    }
    sendAssistantError(response, error, "PayPal Sandbox could not complete the confirmed action.");
  }
});

assistantRouter.post("/cancel-action", assistantRateLimit, (request, response) => {
  const parsed = confirmRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(
      response,
      400,
      "Cancel using the conversation and pending action shown in the review preview.",
    );
    return;
  }

  try {
    response.json(assistantAgent.cancel(parsed.data.conversationId, parsed.data.actionId));
  } catch (error) {
    if (error instanceof Error && error.message === "pending_action_not_found") {
      sendError(response, 404, "This confirmation expired or does not belong to this conversation.");
      return;
    }
    if (error instanceof Error && error.message === "action_cannot_be_cancelled") {
      sendError(response, 409, "This action has already started and cannot be cancelled.");
      return;
    }
    sendAssistantError(response, error, "The pending action could not be cancelled.");
  }
});

function sendAssistantError(
  response: import("express").Response,
  error: unknown,
  genericMessage: string,
): void {
  if (error instanceof Error && error.message === "provider_not_configured") {
    sendError(response, 503, "Configure OPENAI_API_KEY in the server environment to use the assistant.");
    return;
  }
  if (error instanceof Error && error.message === "provider_arguments_invalid") {
    sendError(response, 502, "The assistant returned invalid action details. Please rephrase your request.");
    return;
  }
  if (error instanceof Error && error.message === "conversation_capacity") {
    sendError(response, 503, "The assistant is temporarily at capacity. Please try again later.");
    return;
  }
  if (error instanceof OpenAI.APIError && error.status === 429) {
    if (
      error.code === "insufficient_quota" ||
      error.code === "billing_hard_limit_reached" ||
      error.type === "insufficient_quota"
    ) {
      sendError(
        response,
        503,
        "OpenAI API quota is unavailable. Check API billing, usage limits, and that this key belongs to the intended project.",
      );
      return;
    }
    sendError(
      response,
      503,
      "OpenAI is rate limiting requests. Wait briefly and try again; if it continues, check your project's API rate limits and usage.",
    );
    return;
  }
  if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403)) {
    sendError(response, 503, "The AI provider configuration is not authorized. Check the server key configuration.");
    return;
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    sendError(response, 504, "The AI provider did not respond in time. Please retry.");
    return;
  }
  if (error instanceof PayPalServiceError && error.code === "credentials_missing") {
    sendError(response, 503, "Configure PayPal Sandbox credentials in the server environment.");
    return;
  }
  if (error instanceof PayPalServiceError && error.code === "timeout") {
    sendError(
      response,
      504,
      "PayPal Sandbox did not respond in time. Check your Sandbox account before retrying.",
    );
    return;
  }
  if (error instanceof PayPalServiceError && error.code === "idempotency_conflict") {
    sendError(response, 409, "This action ID conflicts with a previous PayPal request.");
    return;
  }

  console.error(
    "Assistant request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  sendError(response, 502, genericMessage);
}

function sendError(
  response: import("express").Response,
  status: number,
  error: string,
): void {
  response.status(status).json({ kind: "error", error });
}
