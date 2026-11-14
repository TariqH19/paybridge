import { Router } from "express";
import { ObjectId } from "mongodb";
import type Stripe from "stripe";
import { config } from "../config.js";
import { getDatabase } from "../db.js";
import { OrderSchema } from "../orders/order.schema.js";
import { getStripeClient, StripeConfigurationError } from "./stripe-client.js";
import type { NewPayment, Payment } from "./payment.schema.js";

export const checkoutRouter = Router();

checkoutRouter.post("/:id/checkout", async (request, response, next) => {
  const { id } = request.params;
  if (!ObjectId.isValid(id)) {
    response.status(400).json({ error: "Invalid order ID" });
    return;
  }

  const database = getDatabase();
  const orderId = new ObjectId(id);

  try {
    const storedOrder = await database.collection("orders").findOne({ _id: orderId });
    if (!storedOrder) {
      response.status(404).json({ error: "Order not found" });
      return;
    }

    const order = OrderSchema.parse(storedOrder);
    if (order.status !== "pending") {
      response.status(409).json({ error: "Only pending orders can be checked out" });
      return;
    }

    const stripe = getStripeClient();
    const payments = database.collection<Payment>("payments");
    const existingPayment = await payments.findOne(
      { orderId, status: "pending" },
      { sort: { createdAt: -1 } },
    );

    if (existingPayment) {
      let existingSession: Stripe.Checkout.Session;
      try {
        existingSession = await stripe.checkout.sessions.retrieve(
          existingPayment.stripeCheckoutSessionId,
        );
      } catch {
        console.error("Unable to retrieve an existing Stripe Checkout session");
        response.status(502).json({ error: "Unable to check the existing Checkout session" });
        return;
      }

      if (existingSession.status === "open" && existingSession.url) {
        await database.collection("orders").updateOne(
          { _id: orderId, status: "pending" },
          { $set: { stripeCheckoutSessionId: existingSession.id } },
        );
        response.json({ checkoutUrl: existingSession.url });
        return;
      }
      if (existingSession.status === "complete") {
        response.status(409).json({
          error: "Checkout is complete and payment confirmation is still pending",
        });
        return;
      }

      if (existingSession.status === "expired") {
        const retryAt = new Date();
        await payments.updateOne(
          { _id: existingPayment._id, status: "pending" },
          { $set: { status: "cancelled", updatedAt: retryAt } },
        );
        await database.collection("orders").updateOne(
          { _id: orderId, status: "pending" },
          { $set: { updatedAt: retryAt } },
        );
        order.updatedAt = retryAt;
      }
    }

    const baseSuccessUrl = new URL("/checkout/success", config.FRONTEND_URL).toString();
    const baseCancelUrl = new URL("/checkout/cancelled", config.FRONTEND_URL).toString();
    const successUrl =
      `${baseSuccessUrl}?session_id={CHECKOUT_SESSION_ID}` +
      `&order_id=${encodeURIComponent(orderId.toHexString())}` +
      `&order_reference=${encodeURIComponent(order.reference)}`;
    const cancelUrl =
      `${baseCancelUrl}?order_id=${encodeURIComponent(orderId.toHexString())}` +
      `&order_reference=${encodeURIComponent(order.reference)}`;

    let checkoutSession: Stripe.Checkout.Session;
    try {
      checkoutSession = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: order.items.map((item) => ({
            price_data: {
              currency: item.currency.toLowerCase(),
              product_data: { name: item.name },
              unit_amount: item.unitPrice,
            },
            quantity: item.quantity,
          })),
          customer_email: order.customer.email,
          client_reference_id: order.reference,
          metadata: {
            orderId: orderId.toHexString(),
            orderReference: order.reference,
          },
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        {
          idempotencyKey: `paybridge-order-${orderId.toHexString()}-${order.updatedAt.getTime()}`,
        },
      );
    } catch (error) {
      if (error instanceof StripeConfigurationError) {
        response.status(503).json({ error: error.message });
        return;
      }
      console.error("Stripe Checkout session creation failed");
      response.status(502).json({ error: "Unable to start Stripe Checkout; please try again" });
      return;
    }

    if (!checkoutSession.url) {
      response.status(502).json({ error: "Stripe did not return a Checkout URL" });
      return;
    }

    const now = new Date();
    const payment: NewPayment = {
      orderId,
      orderReference: order.reference,
      stripeCheckoutSessionId: checkoutSession.id,
      stripePaymentIntentId: getPaymentIntentId(checkoutSession.payment_intent),
      amount: order.total,
      currency: order.currency,
      status: "pending",
      refundStatus: "none",
      refundedAmount: 0,
      pendingRefundAmount: 0,
      provider: "stripe",
      createdAt: now,
      updatedAt: now,
    };

    await payments.updateOne(
      { stripeCheckoutSessionId: checkoutSession.id },
      { $setOnInsert: payment },
      { upsert: true },
    );
    const orderUpdate = await database.collection("orders").updateOne(
      { _id: orderId, status: "pending" },
      { $set: { stripeCheckoutSessionId: checkoutSession.id, updatedAt: now } },
    );
    if (orderUpdate.matchedCount === 0) {
      response.status(409).json({ error: "Order status changed; refresh before retrying" });
      return;
    }

    response.json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      response.status(503).json({ error: error.message });
      return;
    }
    next(error);
  }
});

function getPaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null,
): string | null {
  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }
  return paymentIntent?.id ?? null;
}
