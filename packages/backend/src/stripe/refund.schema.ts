import { ObjectId } from "mongodb";
import { z } from "zod";

export const RefundStatusSchema = z.enum(["pending", "succeeded", "failed"]);
export const RefundAggregateStatusSchema = z.enum([
  "none",
  "pending",
  "partially_refunded",
  "fully_refunded",
  "failed",
]);
export const RefundReasonSchema = z.enum([
  "duplicate",
  "fraudulent",
  "requested_by_customer",
]);

export const RefundRequestSchema = z
  .object({
    paymentId: z.string().regex(/^[a-f\d]{24}$/i),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    reason: RefundReasonSchema.optional(),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const RefundSchema = z.object({
  _id: z.instanceof(ObjectId),
  stripeRefundId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  orderId: z.instanceof(ObjectId),
  paymentId: z.instanceof(ObjectId),
  orderReference: z.string().min(1),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: RefundStatusSchema,
  reason: z.string().nullable(),
  failureReason: z.string().nullable(),
  source: z.enum(["admin", "stripe_webhook"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type RefundRequest = z.infer<typeof RefundRequestSchema>;
export type Refund = z.infer<typeof RefundSchema>;
export type NewRefund = Omit<Refund, "_id">;
