import { ObjectId, type ClientSession, type Db } from "mongodb";
import type Stripe from "stripe";
import { getDatabase, getMongoClient } from "../db.js";
import { OrderSchema } from "../orders/order.schema.js";
import { PaymentSchema, type Payment } from "./payment.schema.js";
import { getStripeClient } from "./stripe-client.js";
import {
  RefundSchema,
  type Refund,
  type RefundRequest,
} from "./refund.schema.js";

type RefundStatus = Refund["status"];
type AggregateRefundStatus =
  | "none"
  | "pending"
  | "partially_refunded"
  | "fully_refunded"
  | "failed";
type RefundTotals = {
  refundedAmount: number;
  pendingRefundAmount: number;
  failedRefunds: number;
};

export class RefundServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409 | 502,
  ) {
    super(message);
    this.name = "RefundServiceError";
  }
}

export async function createStripeRefund(
  orderId: ObjectId,
  input: RefundRequest,
): Promise<{ refund: Refund; payment: Payment }> {
  const stripe = getStripeClient();
  const reservation = await reserveRefund(orderId, input);
  let refund = reservation.refund;
  let payment = reservation.payment;

  if (refund.status !== "pending") {
    return { refund, payment };
  }

  if (refund.stripeRefundId) {
    let storedRefund: Stripe.Refund;
    try {
      storedRefund = await stripe.refunds.retrieve(refund.stripeRefundId);
    } catch {
      console.error("Unable to retrieve a pending Stripe refund");
      throw new RefundServiceError(
        "Stripe could not confirm the pending refund. Retry with the same request key.",
        502,
      );
    }
    await reconcileStripeRefund(getDatabase(), undefined, storedRefund);
    return loadRefundState(refund._id, payment._id);
  }

  let paymentIntentId: string | null;
  try {
    paymentIntentId = await getPaymentIntentId(payment, stripe);
  } catch {
    console.error("Unable to retrieve the Stripe PaymentIntent for a refund");
    throw new RefundServiceError(
      "Stripe could not confirm the payment reference. The refund remains pending; retry with the same request key.",
      502,
    );
  }
  if (!paymentIntentId) {
    throw new RefundServiceError(
      "No Stripe PaymentIntent is associated with this paid payment.",
      409,
    );
  }

  let stripeRefund: Stripe.Refund;
  try {
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refund.amount,
        ...(refund.reason ? { reason: refund.reason } : {}),
        metadata: {
          paybridgeOrderId: refund.orderId.toHexString(),
          paybridgePaymentId: refund.paymentId.toHexString(),
          paybridgeRefundId: refund._id.toHexString(),
          paybridgeOrderReference: refund.orderReference,
        },
      },
      { idempotencyKey: `paybridge-refund-${refund._id.toHexString()}` },
    );
  } catch {
    console.error("Stripe refund request failed; its balance reservation remains pending");
    throw new RefundServiceError(
      "Stripe could not confirm the refund request. It remains pending; retry with the same request key.",
      502,
    );
  }

  await reconcileStripeRefund(getDatabase(), undefined, stripeRefund);
  ({ refund, payment } = await loadRefundState(refund._id, payment._id));
  return { refund, payment };
}

async function reserveRefund(
  orderId: ObjectId,
  input: RefundRequest,
): Promise<{ refund: Refund; payment: Payment }> {
  const database = getDatabase();
  const session = getMongoClient().startSession();
  let result: { refund: Refund; payment: Payment } | undefined;

  try {
    await session.withTransaction(async () => {
      const orders = database.collection("orders");
      const payments = database.collection<Payment>("payments");
      const refunds = database.collection<Refund>("refunds");
      const rawOrder = await orders.findOne({ _id: orderId }, { session });
      if (!rawOrder) {
        throw new RefundServiceError("Order not found.", 404);
      }
      const order = OrderSchema.parse(rawOrder);
      if (order.status !== "paid") {
        throw new RefundServiceError("Only paid orders can be refunded.", 409);
      }

      const rawPayment = await payments.findOne(
        {
          _id: new ObjectId(input.paymentId),
          orderId,
          orderReference: order.reference,
          status: "paid",
        },
        { session },
      );
      if (!rawPayment) {
        throw new RefundServiceError("No paid payment is associated with this order.", 409);
      }
      const payment = PaymentSchema.parse(rawPayment);
      if (payment.amount !== order.total || payment.currency !== order.currency) {
        throw new RefundServiceError("The paid payment does not match the stored order.", 409);
      }

      const existing = await refunds.findOne(
        { idempotencyKey: input.idempotencyKey },
        { session },
      );
      if (existing) {
        const refund = RefundSchema.parse(existing);
        if (
          !refund.orderId.equals(orderId) ||
          !refund.paymentId.equals(payment._id) ||
          refund.amount !== input.amount ||
          refund.reason !== (input.reason ?? null)
        ) {
          throw new RefundServiceError(
            "This idempotency key was already used for a different refund request.",
            409,
          );
        }
        result = { refund, payment };
        return;
      }

      const remaining =
        payment.amount - payment.refundedAmount - payment.pendingRefundAmount;
      if (input.amount > remaining) {
        throw new RefundServiceError(
          `Refund amount exceeds the remaining refundable balance (${remaining} minor units).`,
          409,
        );
      }

      const now = new Date();
      const reserved = await payments.updateOne(
        {
          _id: payment._id,
          status: "paid",
          $expr: {
            $lte: [
              {
                $add: [
                  { $ifNull: ["$refundedAmount", 0] },
                  { $ifNull: ["$pendingRefundAmount", 0] },
                  input.amount,
                ],
              },
              "$amount",
            ],
          },
        },
        {
          $inc: { pendingRefundAmount: input.amount },
          $set: { refundStatus: "pending", updatedAt: now },
        },
        { session },
      );
      if (reserved.matchedCount !== 1) {
        throw new RefundServiceError(
          "The refundable balance changed. Refresh the order and try again.",
          409,
        );
      }

      const refund: Refund = {
        _id: new ObjectId(),
        idempotencyKey: input.idempotencyKey,
        orderId,
        paymentId: payment._id,
        orderReference: order.reference,
        amount: input.amount,
        currency: payment.currency,
        status: "pending",
        reason: input.reason ?? null,
        failureReason: null,
        source: "admin",
        createdAt: now,
        updatedAt: now,
      };
      await refunds.insertOne(refund, { session });

      const orderUpdate = await orders.updateOne(
        { _id: orderId, status: "paid" },
        { $set: { refundStatus: "pending", updatedAt: now } },
        { session },
      );
      if (orderUpdate.matchedCount !== 1) {
        throw new RefundServiceError("The order is no longer eligible for a refund.", 409);
      }

      result = {
        refund,
        payment: {
          ...payment,
          refundStatus: "pending",
          pendingRefundAmount: payment.pendingRefundAmount + input.amount,
          updatedAt: now,
        },
      };
    });

    if (!result) {
      throw new Error("Refund reservation did not produce a result.");
    }
    return result;
  } finally {
    await session.endSession();
  }
}

export async function reconcileStripeRefund(
  database: Db,
  transaction: ClientSession | undefined,
  stripeRefund: Stripe.Refund,
  fallbackPaymentIntentId?: string,
): Promise<void> {
  if (!transaction) {
    const session = getMongoClient().startSession();
    try {
      await session.withTransaction(() =>
        reconcileStripeRefund(database, session, stripeRefund, fallbackPaymentIntentId),
      );
    } finally {
      await session.endSession();
    }
    return;
  }

  const refunds = database.collection<Refund>("refunds");
  const payments = database.collection<Payment>("payments");
  const orders = database.collection("orders");
  const sessionOptions = { session: transaction };
  let storedRefund = await refunds.findOne(
    { stripeRefundId: stripeRefund.id },
    sessionOptions,
  );

  const metadataRefundId = stripeRefund.metadata?.paybridgeRefundId;
  if (!storedRefund && metadataRefundId && ObjectId.isValid(metadataRefundId)) {
    storedRefund = await refunds.findOne(
      { _id: new ObjectId(metadataRefundId) },
      sessionOptions,
    );
  }

  let payment: Payment;
  if (!storedRefund) {
    const paymentIntentId =
      getStripePaymentIntentId(stripeRefund.payment_intent) ?? fallbackPaymentIntentId;
    if (!paymentIntentId) {
      console.error("Ignoring Stripe refund without a PaymentIntent reference");
      return;
    }
    const rawPayment = await payments.findOne(
      { stripePaymentIntentId: paymentIntentId },
      sessionOptions,
    );
    if (!rawPayment) {
      console.error("Ignoring Stripe refund that does not match a stored payment");
      return;
    }
    payment = PaymentSchema.parse(rawPayment);
    const rawOrder = await orders.findOne({ _id: payment.orderId }, sessionOptions);
    if (
      payment.status !== "paid" ||
      !rawOrder ||
      rawOrder.reference !== payment.orderReference ||
      stripeRefund.amount <= 0 ||
      stripeRefund.amount > payment.amount ||
      stripeRefund.currency.toUpperCase() !== payment.currency
    ) {
      console.error("Ignoring Stripe refund that does not match its stored order or payment");
      return;
    }

    const refund: Refund = {
      _id: new ObjectId(),
      stripeRefundId: stripeRefund.id,
      idempotencyKey: `stripe-webhook-${stripeRefund.id}`,
      orderId: payment.orderId,
      paymentId: payment._id,
      orderReference: payment.orderReference,
      amount: stripeRefund.amount,
      currency: payment.currency,
      status: mapStripeRefundStatus(stripeRefund.status),
      reason: stripeRefund.reason ?? null,
      failureReason: stripeRefund.failure_reason ?? null,
      source: "stripe_webhook",
      createdAt: new Date(stripeRefund.created * 1000),
      updatedAt: new Date(),
    };
    await refunds.updateOne(
      { idempotencyKey: refund.idempotencyKey },
      { $setOnInsert: refund },
      { upsert: true, ...sessionOptions },
    );
    storedRefund = await refunds.findOne(
      { idempotencyKey: refund.idempotencyKey },
      sessionOptions,
    );
    if (!storedRefund) {
      throw new Error("Unable to persist the Stripe refund event.");
    }
  } else {
    const rawPayment = await payments.findOne(
      { _id: storedRefund.paymentId },
      sessionOptions,
    );
    const rawOrder = await orders.findOne(
      { _id: storedRefund.orderId },
      sessionOptions,
    );
    if (!rawPayment || !rawOrder) {
      throw new Error("Refund references a missing payment or order.");
    }
    payment = PaymentSchema.parse(rawPayment);
    if (
      rawOrder.reference !== storedRefund.orderReference ||
      payment.orderId.toHexString() !== storedRefund.orderId.toHexString() ||
      payment.orderReference !== storedRefund.orderReference ||
      stripeRefund.amount !== storedRefund.amount ||
      stripeRefund.currency.toUpperCase() !== storedRefund.currency ||
      (getStripePaymentIntentId(stripeRefund.payment_intent) &&
        payment.stripePaymentIntentId &&
        getStripePaymentIntentId(stripeRefund.payment_intent) !== payment.stripePaymentIntentId) ||
      (storedRefund.stripeRefundId &&
        storedRefund.stripeRefundId !== stripeRefund.id)
    ) {
      console.error("Ignoring Stripe refund that did not match its reserved refund record");
      return;
    }
  }

  const incomingStatus = mapStripeRefundStatus(stripeRefund.status);
  const currentRefund = RefundSchema.parse(storedRefund);
  const nextStatus = mergeRefundStatus(currentRefund.status, incomingStatus);
  const now = new Date();
  await refunds.updateOne(
    { _id: currentRefund._id },
    {
      $set: {
        stripeRefundId: stripeRefund.id,
        status: nextStatus,
        reason: stripeRefund.reason ?? currentRefund.reason,
        failureReason:
          nextStatus === "failed"
            ? stripeRefund.failure_reason ?? currentRefund.failureReason ?? "Stripe refund failed"
            : null,
        updatedAt: now,
      },
    },
    sessionOptions,
  );

  await refreshRefundTotals(
    database,
    transaction,
    payment,
    currentRefund.orderId,
    currentRefund.orderReference,
    getStripePaymentIntentId(stripeRefund.payment_intent),
  );
}

async function refreshRefundTotals(
  database: Db,
  transaction: ClientSession | undefined,
  payment: Payment,
  orderId: ObjectId,
  orderReference: string,
  stripePaymentIntentId?: string,
): Promise<void> {
  const sessionOptions = transaction ? { session: transaction } : undefined;
  const refunds = database.collection<Refund>("refunds");
  const paymentTotals = await refunds
    .aggregate<RefundTotals>(
      [
        { $match: { paymentId: payment._id } },
        {
          $group: {
            _id: null,
            refundedAmount: {
              $sum: { $cond: [{ $eq: ["$status", "succeeded"] }, "$amount", 0] },
            },
            pendingRefundAmount: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] },
            },
            failedRefunds: {
              $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
            },
          },
        },
        { $project: { _id: 0 } },
      ],
      sessionOptions,
    )
    .next();
  const orderRefundRows = await refunds
    .aggregate<RefundTotals>(
      [
        { $match: { orderId } },
        {
          $group: {
            _id: null,
            refundedAmount: {
              $sum: { $cond: [{ $eq: ["$status", "succeeded"] }, "$amount", 0] },
            },
            pendingRefundAmount: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] },
            },
            failedRefunds: {
              $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
            },
          },
        },
        { $project: { _id: 0 } },
      ],
      sessionOptions,
    )
    .next();
  const paidPayments = await database
    .collection<Payment>("payments")
    .aggregate<{ originalAmount: number }>(
      [
        { $match: { orderId, status: "paid" } },
        { $group: { _id: null, originalAmount: { $sum: "$amount" } } },
        { $project: { _id: 0 } },
      ],
      sessionOptions,
    )
    .next();
  const paymentRefundedAmount = paymentTotals?.refundedAmount ?? 0;
  const paymentPendingAmount = paymentTotals?.pendingRefundAmount ?? 0;
  const orderRefundedAmount = orderRefundRows?.refundedAmount ?? 0;
  const orderPendingAmount = orderRefundRows?.pendingRefundAmount ?? 0;
  const originalOrderAmount = paidPayments?.originalAmount ?? 0;
  if (
    !Number.isSafeInteger(paymentRefundedAmount) ||
    !Number.isSafeInteger(paymentPendingAmount) ||
    !Number.isSafeInteger(orderRefundedAmount) ||
    !Number.isSafeInteger(orderPendingAmount) ||
    !Number.isSafeInteger(originalOrderAmount) ||
    paymentRefundedAmount + paymentPendingAmount > payment.amount ||
    orderRefundedAmount + orderPendingAmount > originalOrderAmount
  ) {
    throw new Error("Stored refund totals exceed the original paid amount.");
  }

  const paymentRefundStatus = getAggregateRefundStatus(
    paymentRefundedAmount,
    paymentPendingAmount,
    payment.amount,
    paymentTotals?.failedRefunds ?? 0,
  );
  const orderRefundStatus = getAggregateRefundStatus(
    orderRefundedAmount,
    orderPendingAmount,
    originalOrderAmount,
    orderRefundRows?.failedRefunds ?? 0,
  );
  const now = new Date();
  await database.collection<Payment>("payments").updateOne(
    { _id: payment._id, orderId, status: "paid" },
    {
      $set: {
        refundedAmount: paymentRefundedAmount,
        pendingRefundAmount: paymentPendingAmount,
        refundStatus: paymentRefundStatus,
        ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
        updatedAt: now,
      },
    },
    sessionOptions,
  );
  await database.collection("orders").updateOne(
    { _id: orderId, reference: orderReference },
    {
      $set: {
        refundedAmount: orderRefundedAmount,
        refundStatus: orderRefundStatus,
        updatedAt: now,
      },
    },
    sessionOptions,
  );
}

async function loadRefundState(
  refundId: ObjectId,
  paymentId: ObjectId,
): Promise<{ refund: Refund; payment: Payment }> {
  const database = getDatabase();
  const [refund, payment] = await Promise.all([
    database.collection<Refund>("refunds").findOne({ _id: refundId }),
    database.collection<Payment>("payments").findOne({ _id: paymentId }),
  ]);
  if (!refund || !payment) {
    throw new Error("Refund state could not be loaded after Stripe reconciliation.");
  }
  return {
    refund: RefundSchema.parse(refund),
    payment: PaymentSchema.parse(payment),
  };
}

async function getPaymentIntentId(payment: Payment, stripe: Stripe): Promise<string | null> {
  if (payment.stripePaymentIntentId) {
    return payment.stripePaymentIntentId;
  }
  const session = await stripe.checkout.sessions.retrieve(payment.stripeCheckoutSessionId);
  const paymentIntentId = getStripePaymentIntentId(session.payment_intent);
  if (paymentIntentId) {
    await getDatabase().collection<Payment>("payments").updateOne(
      { _id: payment._id, orderId: payment.orderId },
      { $set: { stripePaymentIntentId: paymentIntentId, updatedAt: new Date() } },
    );
  }
  return paymentIntentId ?? null;
}

function getStripePaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null,
): string | undefined {
  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }
  return paymentIntent?.id;
}

function mapStripeRefundStatus(status: string | null): RefundStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "canceled") return "failed";
  return "pending";
}

function mergeRefundStatus(current: RefundStatus, incoming: RefundStatus): RefundStatus {
  if (current === "succeeded" || (current === "failed" && incoming === "pending")) {
    return current;
  }
  return incoming;
}

function getAggregateRefundStatus(
  refundedAmount: number,
  pendingRefundAmount: number,
  originalAmount: number,
  failedRefunds: number,
): AggregateRefundStatus {
  if (pendingRefundAmount > 0) return "pending";
  if (refundedAmount > 0 && refundedAmount >= originalAmount) return "fully_refunded";
  if (refundedAmount > 0) return "partially_refunded";
  if (failedRefunds > 0) return "failed";
  return "none";
}
