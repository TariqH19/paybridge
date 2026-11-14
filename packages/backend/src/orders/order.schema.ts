import { ObjectId } from "mongodb";
import { z } from "zod";
import { RefundAggregateStatusSchema } from "../stripe/refund.schema.js";

export const CreateOrderRequestSchema = z
  .object({
    customer: z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z.string().trim().email().max(254),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            productId: z.string().regex(/^[a-f\d]{24}$/i),
            quantity: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

export const OrderItemSchema = z.object({
  productId: z.string().regex(/^[a-f\d]{24}$/i),
  name: z.string().min(1),
  imageUrl: z.url(),
  unitPrice: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  quantity: z.number().int().positive(),
  lineTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const OrderSchema = z.object({
  _id: z.instanceof(ObjectId),
  reference: z.string().min(1),
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  items: z.array(OrderItemSchema).min(1),
  subtotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(["pending", "paid", "payment_failed", "cancelled"]),
  refundStatus: RefundAggregateStatusSchema.default("none"),
  refundedAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  stripeCheckoutSessionId: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Order = z.infer<typeof OrderSchema>;
export type NewOrder = Omit<Order, "_id">;

export const OrderResponseSchema = OrderSchema.transform(({ _id, ...order }) => ({
  ...order,
  id: _id.toHexString(),
}));

export type OrderResponse = z.infer<typeof OrderResponseSchema>;
