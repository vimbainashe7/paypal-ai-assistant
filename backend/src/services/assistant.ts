import OpenAI from "openai";
import { config } from "../config.js";
import { assistantDraftSchema, type AssistantDraft } from "./draft.js";

const proposalTool = {
  type: "function" as const,
  function: {
    name: "prepare_payment_draft",
    description:
      "Prepare a PayPal Sandbox order or invoice draft for the merchant to review. " +
      "Never create it. If a necessary detail is missing, ask one concise clarification question.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["order", "invoice"] },
        currencyCode: { type: "string", enum: ["USD"] },
        items: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              quantity: { type: "integer" },
              unitAmount: { type: "number" },
            },
            required: ["name", "description", "quantity", "unitAmount"],
          },
        },
        recipientEmail: { type: ["string", "null"] },
        needsInfo: { type: "boolean" },
        clarification: { type: ["string", "null"] },
      },
      required: [
        "action",
        "currencyCode",
        "items",
        "recipientEmail",
        "needsInfo",
        "clarification",
      ],
    },
  },
};

export async function prepareWithAssistant(message: string): Promise<AssistantDraft> {
  if (!config.OPENAI_API_KEY) {
    throw new Error("The OpenAI API key is not configured.");
  }

  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
    {
      role: "system",
      content:
        "You help a small-business merchant draft a PayPal Sandbox order or invoice for review. " +
        "You must never create a PayPal resource or claim a payment happened. " +
        "Ask for clarification when the item name, positive unit price, or whole-number quantity is missing. " +
        "Invoice drafts also require the recipient's email. Only USD is supported. " +
        "Use the prepare_payment_draft function exactly once. Prices are per item, not line totals.",
    },
    { role: "user", content: message },
    ],
    tools: [proposalTool],
    tool_choice: { type: "function", function: { name: proposalTool.function.name } },
  });

  const proposal = completion.choices[0]?.message.tool_calls?.[0];
  if (!proposal || proposal.type !== "function" || proposal.function.name !== proposalTool.function.name) {
    throw new Error("OpenAI did not return a valid payment draft.");
  }

  const parsed = assistantDraftSchema.safeParse(JSON.parse(proposal.function.arguments));
  if (!parsed.success) {
    throw new Error("OpenAI returned a payment draft with invalid details.");
  }

  return parsed.data;
}
