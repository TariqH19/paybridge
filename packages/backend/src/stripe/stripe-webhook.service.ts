import { ObjectId, type ClientSession, type Db } from "mongodb";
import type Stripe from "stripe";
import { getDatabase, getMongoClient } from "../db.js";
import { OrderSchema } from "../orders/order.schema.js";
import type { Payment, StripeWebhookEventDocument } from "./payment.schema.js";
import { reconcileStripeRefund } from "./refund.service.js";

type CheckoutUpdate = {
  session: Stripe.Checkout.Session;
  status: "pending" | "paid" | "payment_failed" | "cancelled";
};

export async function processStripeEvent(event: Stripe.Event): Promise<boolean> {
  const database = getDatabase();
  const events = database.collection<StripeWebhookEventDocument>("stripeWebhookEvents");
  const session = getMongoClient().startSession();
  let duplicate = false;

  try {
    try {
      await session.withTransaction(async () => {
        const existingEvent = await events.findOne({ eventId: event.id }, { session });
        if (existingEvent) {
          duplicate = true;
          return;
        }

        const checkoutUpdate = getCheckoutUpdate(event);
        if (checkoutUpdate) {
          await applyCheckoutUpdate(database, session, checkoutUpdate);
        } else {
          for (const refundUpdate of getRefundUpdates(event)) {
            await reconcileStripeRefund(
              database,
              session,
              refundUpdate.refund,
              refundUpdate.paymentIntentId,
            );
          }
        }

        const now = new Date();
        await events.insertOne(
          {
            eventId: event.id,
            type: event.type,
            status: "processed",
            createdAt: now,
            processedAt: now,
          },
          { session },
        );
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const duplicateEvent = await events.findOne({ eventId: event.id });
        if (duplicateEvent) {
          return true;
        }
      }
      throw error;
    }

    return duplicate;
  } finally {
    await session.endSession();
  }
}

function getCheckoutUpdate(event: Stripe.Event): CheckoutUpdate | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        session,
        status: session.payment_status === "paid" ? "paid" : "pending",
      };
    }
    case "checkout.session.async_payment_succeeded":
      return {
        session: event.data.object as Stripe.Checkout.Session,
        status: "paid",
      };
    case "checkout.session.async_payment_failed":
      return {
        session: event.data.object as Stripe.Checkout.Session,
        status: "payment_failed",
      };
    case "checkout.session.expired":
      return {
        session: event.data.object as Stripe.Checkout.Session,
        status: "cancelled",
      };
    default:
      return null;
  }
}

function getRefundUpdates(
  event: Stripe.Event,
): Array<{ refund: Stripe.Refund; paymentIntentId?: string }> {
  switch (event.type) {
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      return [{ refund: event.data.object as Stripe.Refund }];
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = getPaymentIntentId(charge.payment_intent);
      return (charge.refunds?.data ?? []).map((refund) => ({
        refund,
        ...(paymentIntentId ? { paymentIntentId } : {}),
      }));
    }
    default:
      return [];
  }
}

async function applyCheckoutUpdate(
  database: Db,
  transaction: ClientSession,
  { session, status }: CheckoutUpdate,
): Promise<void> {
  const payments = database.collection<Payment>("payments");
  const orders = database.collection("orders");
  let payment = await payments.findOne(
    { stripeCheckoutSessionId: session.id },
    { session: transaction },
  );

  if (!payment) {
    const orderIdValue = session.metadata?.orderId;
    const orderReference = session.metadata?.orderReference;
    if (!orderIdValue || !ObjectId.isValid(orderIdValue) || !orderReference) {
      return;
    }

    const orderId = new ObjectId(orderIdValue);
    const storedOrder = await orders.findOne({ _id: orderId }, { session: transaction });
    if (!storedOrder || storedOrder.reference !== orderReference) {
      return;
    }

    const order = OrderSchema.parse(storedOrder);
    const now = new Date();
    await payments.updateOne(
      { stripeCheckoutSessionId: session.id },
      {
        $setOnInsert: {
          orderId,
          orderReference: order.reference,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: getPaymentIntentId(session.payment_intent),
          amount: order.total,
          currency: order.currency,
          status: "pending",
          refundStatus: "none",
          refundedAmount: 0,
          pendingRefundAmount: 0,
          provider: "stripe",
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, session: transaction },
    );
    payment = await payments.findOne(
      { stripeCheckoutSessionId: session.id },
      { session: transaction },
    );
  }

  if (!payment) {
    return;
  }

  const storedOrder = await orders.findOne({ _id: payment.orderId }, { session: transaction });
  if (
    !storedOrder ||
    storedOrder.reference !== payment.orderReference ||
    session.metadata?.orderId !== payment.orderId.toHexString() ||
    session.metadata?.orderReference !== payment.orderReference ||
    session.amount_total !== payment.amount ||
    session.currency?.toUpperCase() !== payment.currency
  ) {
    console.error("Ignoring Stripe Checkout event that did not match its stored order");
    return;
  }

  const order = OrderSchema.parse(storedOrder);
  const currentPaymentStatus = order.status === "paid" ? "paid" : payment.status;
  const nextStatus = mergePaymentStatus(currentPaymentStatus, status);
  const now = new Date();

  await payments.updateOne(
    { _id: payment._id },
    {
      $set: {
        status: nextStatus,
        stripePaymentIntentId:
          getPaymentIntentId(session.payment_intent) ?? payment.stripePaymentIntentId,
        updatedAt: now,
      },
    },
    { session: transaction },
  );

  if (nextStatus === "paid") {
    await orders.updateOne(
      { _id: payment.orderId, status: { $ne: "paid" } },
      { $set: { status: "paid", updatedAt: now } },
      { session: transaction },
    );
  } else if (nextStatus === "payment_failed" && order.status === "pending") {
    await orders.updateOne(
      { _id: payment.orderId, status: "pending" },
      { $set: { status: "payment_failed", updatedAt: now } },
      { session: transaction },
    );
  } else if (nextStatus === "cancelled" && order.status === "pending") {
    await orders.updateOne(
      { _id: payment.orderId, status: "pending" },
      { $set: { updatedAt: now } },
      { session: transaction },
    );
  }
}

function mergePaymentStatus(
  current: Payment["status"],
  incoming: CheckoutUpdate["status"],
): Payment["status"] {
  if (current === "paid" || incoming === "paid") {
    return "paid";
  }
  if (incoming === "pending" && current !== "pending") {
    return current;
  }
  return incoming;
}

function getPaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null,
): string | null {
  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }
  return paymentIntent?.id ?? null;
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
