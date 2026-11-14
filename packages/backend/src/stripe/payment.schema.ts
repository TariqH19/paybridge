import { ObjectId } from "mongodb";
import { z } from "zod";
import { RefundAggregateStatusSchema } from "./refund.schema.js";

export const PaymentStatusSchema = z.enum([
  "pending",
  "paid",
  "payment_failed",
  "cancelled",
]);

export const PaymentSchema = z.object({
  _id: z.instanceof(ObjectId),
  orderId: z.instanceof(ObjectId),
  orderReference: z.string().min(1),
  stripeCheckoutSessionId: z.string().min(1),
  stripePaymentIntentId: z.string().nullable(),
  amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: PaymentStatusSchema,
  refundStatus: RefundAggregateStatusSchema.default("none"),
  refundedAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  pendingRefundAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  provider: z.literal("stripe"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Payment = z.infer<typeof PaymentSchema>;
export type NewPayment = Omit<Payment, "_id">;

export type StripeWebhookEventDocument = {
  eventId: string;
  type: string;
  status: "processed";
  createdAt: Date;
  processedAt: Date;
};
