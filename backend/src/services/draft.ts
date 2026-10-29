import { z } from "zod";

const draftItemSchema = z
  .object({
    name: z.string().trim().min(1).max(127),
    description: z.string().trim().max(255),
    quantity: z.number().int().min(1).max(100),
    unitAmount: z.number().finite().positive().max(100000),
  })
  .strict()
  .superRefine((item, context) => {
    if (Number(item.unitAmount.toFixed(2)) !== item.unitAmount) {
      context.addIssue({
        code: "custom",
        path: ["unitAmount"],
        message: "Prices must have no more than two decimal places.",
      });
    }
  });

export const assistantDraftSchema = z
  .object({
    action: z.enum(["order", "invoice"]),
    currencyCode: z.literal("USD"),
    items: z.array(draftItemSchema).max(50),
    recipientEmail: z.union([z.string().trim().email().max(254), z.null()]),
    needsInfo: z.boolean(),
    clarification: z.union([z.string().trim().min(1).max(500), z.null()]),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.needsInfo) {
      if (!draft.clarification) {
        context.addIssue({
          code: "custom",
          path: ["clarification"],
          message: "Ask the merchant for the missing details.",
        });
      }
      return;
    }

    if (draft.items.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Add at least one item before confirming.",
      });
    }
    if (draft.action === "invoice" && !draft.recipientEmail) {
      context.addIssue({
        code: "custom",
        path: ["recipientEmail"],
        message: "An invoice needs a recipient email address.",
      });
    }

    const totalCents = draft.items.reduce(
      (total, item) => total + Math.round(item.unitAmount * 100) * item.quantity,
      0,
    );
    if (!Number.isSafeInteger(totalCents) || totalCents > 100_000_000) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "The draft total must not exceed USD 1,000,000.",
      });
    }
  });

export type AssistantDraft = z.infer<typeof assistantDraftSchema>;

export function getDraftTotal(draft: AssistantDraft): number {
  const totalCents = draft.items.reduce(
    (total, item) => total + Math.round(item.unitAmount * 100) * item.quantity,
    0,
  );
  return totalCents / 100;
}
