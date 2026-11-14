import { Router } from "express";
import type Stripe from "stripe";
import { getStripeClient, getStripeWebhookSecret, StripeConfigurationError } from "./stripe-client.js";
import { processStripeEvent } from "./stripe-webhook.service.js";

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post("/", async (request, response) => {
  if (!Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: "Expected the raw Stripe webhook request body" });
    return;
  }

  const signature = request.get("stripe-signature");
  if (!signature) {
    response.status(400).json({ error: "Missing Stripe signature" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      request.body,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      response.status(503).json({ error: error.message });
      return;
    }
    response.status(400).json({ error: "Invalid Stripe webhook signature or payload" });
    return;
  }

  try {
    const duplicate = await processStripeEvent(event);
    response.status(200).json({ received: true, duplicate });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "stripe_webhook_processing_failed",
        stripeEventId: event.id,
        stripeEventType: event.type,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    response.status(500).json({ error: "Unable to process Stripe webhook event" });
  }
});
