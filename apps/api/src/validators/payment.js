import { z } from "zod";

export const createPaymentSchema = z.object({
  amount: z.number({ required_error: "amount is required" })
    .int("amount must be a positive integer in the smallest currency unit")
    .positive("amount must be a positive integer in the smallest currency unit")
    .safe(),
  currency: z.string().regex(/^[a-zA-Z]{3}$/, "currency must be a three-letter code")
    .nullish().transform((value) => value?.toLowerCase() ?? "usd"),
  metadata: z.record(
    z.string().min(1).max(40).regex(/^[^\[\]]+$/, "metadata keys cannot contain brackets"),
    z.string().max(500)
  ).refine((value) => Object.keys(value).length <= 50, "metadata cannot exceed 50 entries")
    .optional()
});
