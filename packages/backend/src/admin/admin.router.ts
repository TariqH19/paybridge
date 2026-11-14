import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDatabase } from "../db.js";
import { OrderItemSchema, OrderSchema, type Order } from "../orders/order.schema.js";
import type { Payment, StripeWebhookEventDocument } from "../stripe/payment.schema.js";
import {
  RefundRequestSchema,
  RefundSchema,
  type Refund,
} from "../stripe/refund.schema.js";
import { createStripeRefund, RefundServiceError } from "../stripe/refund.service.js";
import { StripeConfigurationError } from "../stripe/stripe-client.js";
import { AdminAnalyticsQuerySchema } from "./analytics.schema.js";
import { buildAdminAnalytics } from "./analytics.service.js";
import { createAdminSession, requireAdmin } from "./admin-auth.js";

const AdminOrderStatusSchema = z.enum(["pending", "paid", "payment_failed", "cancelled"]);
const OrdersQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional().default(""),
    status: AdminOrderStatusSchema.optional(),
    sort: z.enum(["newest", "oldest"]).optional().default("newest"),
  })
  .strict();

const PENDING_ORDER_REFERENCE = "PB-528825A7-BC2C-4324-82F1-EC0EF87E7F8B";
const PAYMENT_PROJECTION = {
  orderReference: 1,
  stripeCheckoutSessionId: 1,
  amount: 1,
  currency: 1,
  status: 1,
  provider: 1,
  refundStatus: 1,
  refundedAmount: 1,
  pendingRefundAmount: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;
type AdminPaymentRecord = Pick<
  Payment,
  | "_id"
  | "orderReference"
  | "stripeCheckoutSessionId"
  | "amount"
  | "currency"
  | "status"
  | "provider"
  | "refundStatus"
  | "refundedAmount"
  | "pendingRefundAmount"
  | "createdAt"
  | "updatedAt"
>;
const WEBHOOK_EVENT_PROJECTION = {
  eventId: 1,
  type: 1,
  status: 1,
  createdAt: 1,
  processedAt: 1,
} as const;
const PendingOrderEvidenceSchema = z
  .object({
    _id: z.instanceof(ObjectId),
    reference: z.string().min(1),
    status: z.enum(["pending", "paid", "payment_failed", "cancelled"]),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
    items: z.array(OrderItemSchema).min(1),
    stripeCheckoutSessionId: z.string().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export const adminRouter = Router();

adminRouter.post("/session", createAdminSession);
adminRouter.use(requireAdmin);

adminRouter.get("/overview", async (_request, response, next) => {
  try {
    const database = getDatabase();
    const [orderSummary, paymentSummary, recentOrders] = await Promise.all([
      database
        .collection("orders")
        .aggregate<{
          totals: Array<{ totalOrders: number; pendingOrders: number }>;
          revenue: Array<{ _id: string; amount: number }>;
        }>([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    pendingOrders: {
                      $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                    },
                  },
                },
              ],
              revenue: [
                { $match: { status: "paid" } },
                { $group: { _id: "$currency", amount: { $sum: "$total" } } },
                { $sort: { _id: 1 } },
              ],
            },
          },
        ])
        .next(),
      database
        .collection("payments")
        .aggregate<{
          paidPayments: number;
          failedPayments: number;
          terminalPayments: number;
        }>([
          {
            $group: {
              _id: null,
              paidPayments: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
              failedPayments: {
                $sum: { $cond: [{ $eq: ["$status", "payment_failed"] }, 1, 0] },
              },
              terminalPayments: {
                $sum: {
                  $cond: [{ $in: ["$status", ["paid", "payment_failed"]] }, 1, 0],
                },
              },
            },
          },
        ])
        .next(),
      database
        .collection("orders")
        .find({})
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray(),
    ]);

    const recentParsed = recentOrders.map((raw) => OrderSchema.parse(raw));
    const recentPayments = recentParsed.length
      ? await database
          .collection<Payment>("payments")
          .find({ orderId: { $in: recentParsed.map((order) => order._id) } })
          .sort({ updatedAt: -1 })
          .toArray()
      : [];
    const latestPaymentByOrder = new Map<string, Payment["status"]>();
    for (const payment of recentPayments) {
      const key = payment.orderId.toHexString();
      if (!latestPaymentByOrder.has(key)) {
        latestPaymentByOrder.set(key, payment.status);
      }
    }

    const terminalPaymentCount = paymentSummary?.terminalPayments ?? 0;
    response.json({
      totalOrders: orderSummary?.totals[0]?.totalOrders ?? 0,
      pendingOrders: orderSummary?.totals[0]?.pendingOrders ?? 0,
      paidRevenue: (orderSummary?.revenue ?? []).map(({ _id, amount }) => ({
        currency: _id,
        amount,
      })),
      failedPayments: paymentSummary?.failedPayments ?? 0,
      paymentSuccessRate:
        terminalPaymentCount > 0
          ? {
              percentage: ((paymentSummary?.paidPayments ?? 0) / terminalPaymentCount) * 100,
              paid: paymentSummary?.paidPayments ?? 0,
              terminal: terminalPaymentCount,
            }
          : null,
      recentOrders: recentParsed.map((order) =>
        serializeOrderSummary(order, latestPaymentByOrder.get(order._id.toHexString())),
      ),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/analytics", async (request, response, next) => {
  const parsed = AdminAnalyticsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid analytics filters.",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  try {
    response.json(await buildAdminAnalytics(getDatabase(), parsed.data));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/orders", async (request, response, next) => {
  const parsed = OrdersQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid order filters." });
    return;
  }

  try {
    const database = getDatabase();
    const { search, status, sort } = parsed.data;
    const filter: Record<string, unknown> = {};
    if (status) {
      filter.status = status;
    }
    if (search) {
      const safeSearch = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { reference: safeSearch },
        { "customer.name": safeSearch },
        { "customer.email": safeSearch },
      ];
    }

    const [total, rawOrders] = await Promise.all([
      database.collection("orders").countDocuments(filter),
      database
        .collection("orders")
        .find(filter)
        .sort({ createdAt: sort === "oldest" ? 1 : -1 })
        .limit(100)
        .toArray(),
    ]);
    const orders = rawOrders.map((raw) => OrderSchema.parse(raw));
    const payments = orders.length
      ? await database
          .collection<Payment>("payments")
          .find({ orderId: { $in: orders.map((order) => order._id) } })
          .sort({ updatedAt: -1 })
          .toArray()
      : [];
    const latestPaymentByOrder = new Map<string, Payment["status"]>();
    for (const payment of payments) {
      const key = payment.orderId.toHexString();
      if (!latestPaymentByOrder.has(key)) {
        latestPaymentByOrder.set(key, payment.status);
      }
    }

    response.json({
      total,
      limit: 100,
      orders: orders.map((order) =>
        serializeOrderSummary(order, latestPaymentByOrder.get(order._id.toHexString())),
      ),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/orders/:id", async (request, response, next) => {
  const { id } = request.params;
  if (!ObjectId.isValid(id)) {
    response.status(400).json({ error: "Invalid order ID." });
    return;
  }

  try {
    const database = getDatabase();
    const rawOrder = await database.collection("orders").findOne({ _id: new ObjectId(id) });
    if (!rawOrder) {
      response.status(404).json({ error: "Order not found." });
      return;
    }
    const order = OrderSchema.parse(rawOrder);
    const payments = await database
      .collection<Payment>("payments")
      .find({ orderId: order._id })
      .project<AdminPaymentRecord>(PAYMENT_PROJECTION)
      .sort({ createdAt: -1 })
      .toArray();
    response.json({
      order: serializeOrderSummary(order, payments[0]?.status),
      customer: order.customer,
      items: order.items,
      subtotal: order.subtotal,
      total: order.total,
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      payments: payments.map(serializePayment),
      refunds: (
        await database
          .collection<Refund>("refunds")
          .find({ orderId: order._id })
          .sort({ createdAt: -1 })
          .toArray()
      ).map(serializeRefund),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/orders/:id/refunds", async (request, response, next) => {
  const { id } = request.params;
  if (!ObjectId.isValid(id)) {
    response.status(400).json({ error: "Invalid order ID." });
    return;
  }
  const parsed = RefundRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid refund request.",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  try {
    const result = await createStripeRefund(new ObjectId(id), parsed.data);
    response.status(201).json({
      refund: serializeRefund(result.refund),
      payment: serializePayment(result.payment),
      remainingRefundableAmount: Math.max(
        0,
        result.payment.amount -
          result.payment.refundedAmount -
          result.payment.pendingRefundAmount,
      ),
    });
  } catch (error) {
    if (error instanceof RefundServiceError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof StripeConfigurationError) {
      response.status(503).json({ error: error.message });
      return;
    }
    next(error);
  }
});

adminRouter.get("/payments", async (_request, response, next) => {
  try {
    const payments = await getDatabase()
      .collection<Payment>("payments")
      .find({})
      .project<AdminPaymentRecord>(PAYMENT_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    response.json(payments.map(serializePayment));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/webhook-events", async (_request, response, next) => {
  try {
    const events = await getDatabase()
      .collection<StripeWebhookEventDocument>("stripeWebhookEvents")
      .find({}, { projection: WEBHOOK_EVENT_PROJECTION })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    response.json(events.map(serializeWebhookEvent));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/webhook-events/:eventId", async (request, response, next) => {
  const { eventId } = request.params;
  if (!/^evt_[A-Za-z0-9]+$/.test(eventId)) {
    response.status(400).json({ error: "Invalid Stripe event ID." });
    return;
  }

  try {
    const event = await getDatabase().collection<StripeWebhookEventDocument>("stripeWebhookEvents").findOne(
      { eventId },
      { projection: WEBHOOK_EVENT_PROJECTION },
    );
    if (!event) {
      response.status(404).json({ error: "Webhook event not found." });
      return;
    }
    response.json(serializeWebhookEvent(event));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/investigations/pending-order", async (_request, response, next) => {
  try {
    const database = getDatabase();
    const rawOrder = await database
      .collection("orders")
      .findOne(
        { reference: PENDING_ORDER_REFERENCE },
        {
          projection: {
            reference: 1,
            status: 1,
            total: 1,
            currency: 1,
            items: 1,
            stripeCheckoutSessionId: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      );
    if (!rawOrder) {
      response.json({ found: false, reference: PENDING_ORDER_REFERENCE });
      return;
    }

    const order = PendingOrderEvidenceSchema.parse(rawOrder);
    const [payments, checkoutEvents] = await Promise.all([
      database
        .collection<Payment>("payments")
        .find({ $or: [{ orderId: order._id }, { orderReference: order.reference }] })
        .project<AdminPaymentRecord>(PAYMENT_PROJECTION)
        .sort({ createdAt: -1 })
        .toArray(),
      database
        .collection<StripeWebhookEventDocument>("stripeWebhookEvents")
        .find({ type: /^checkout\.session\./ }, { projection: WEBHOOK_EVENT_PROJECTION })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
    ]);

    response.json({
      found: true,
      order: {
        id: order._id.toHexString(),
        reference: order.reference,
        status: order.status,
        total: order.total,
        currency: order.currency,
        items: order.items.map(({ name, quantity, unitPrice }) => ({
          name,
          quantity,
          unitPrice,
        })),
        hasCheckoutSessionId: Boolean(rawOrder.stripeCheckoutSessionId),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      payments: payments.map(serializePayment),
      recentCheckoutEvents: checkoutEvents.map(serializeWebhookEvent),
      eventOrderCorrelationAvailable: false,
    });
  } catch (error) {
    next(error);
  }
});

function serializeOrderSummary(
  order: Order,
  paymentStatus?: Payment["status"],
): {
  id: string;
  reference: string;
  customer: Order["customer"];
  createdAt: Date;
  total: number;
  currency: string;
  status: Order["status"];
  paymentStatus: Payment["status"] | "not_started";
  refundStatus: Order["refundStatus"];
  refundedAmount: number;
} {
  return {
    id: order._id.toHexString(),
    reference: order.reference,
    customer: order.customer,
    createdAt: order.createdAt,
    total: order.total,
    currency: order.currency,
    status: order.status,
    paymentStatus: paymentStatus ?? "not_started",
    refundStatus: order.refundStatus,
    refundedAmount: order.refundedAmount,
  };
}

function serializePayment(payment: AdminPaymentRecord) {
  return {
    id: payment._id.toHexString(),
    orderReference: payment.orderReference,
    stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    refundStatus: payment.refundStatus ?? "none",
    refundedAmount: payment.refundedAmount ?? 0,
    pendingRefundAmount: payment.pendingRefundAmount ?? 0,
    remainingRefundableAmount:
      payment.status === "paid"
        ? Math.max(
            0,
            payment.amount - (payment.refundedAmount ?? 0) - (payment.pendingRefundAmount ?? 0),
          )
        : 0,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function serializeRefund(refund: Refund) {
  const parsed = RefundSchema.parse(refund);
  return {
    id: parsed._id.toHexString(),
    stripeRefundId: parsed.stripeRefundId ?? null,
    paymentId: parsed.paymentId.toHexString(),
    orderReference: parsed.orderReference,
    amount: parsed.amount,
    currency: parsed.currency,
    status: parsed.status,
    reason: parsed.reason,
    failureReason: parsed.failureReason,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

function serializeWebhookEvent(event: StripeWebhookEventDocument) {
  return {
    eventId: event.eventId,
    type: event.type,
    status: event.status,
    createdAt: event.createdAt,
    processedAt: event.processedAt ?? null,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
