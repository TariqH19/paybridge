import Stripe from "stripe";
import { config } from "../config.js";

export class StripeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigurationError";
  }
}

let client: Stripe | undefined;
let configuredKey: string | undefined;

export function getStripeClient(): Stripe {
  const secretKey = config.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new StripeConfigurationError(
      "Stripe Checkout is not configured. Set STRIPE_SECRET_KEY in the backend environment.",
    );
  }
  if (!secretKey.startsWith("sk_test_")) {
    throw new StripeConfigurationError(
      "PayBridge accepts Stripe test-mode secret keys only (sk_test_...).",
    );
  }

  if (!client || configuredKey !== secretKey) {
    client = new Stripe(secretKey);
    configuredKey = secretKey;
  }

  return client;
}

export function getStripeWebhookSecret(): string {
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new StripeConfigurationError(
      "Stripe webhook verification is not configured. Set STRIPE_WEBHOOK_SECRET in the backend environment.",
    );
  }
  return webhookSecret;
}
