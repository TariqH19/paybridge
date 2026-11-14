const apiUrl = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

function getErrorMessage(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const message = (value as Record<string, unknown>).error;
  return typeof message === "string" ? message : fallback;
}

export async function createStripeCheckoutUrl(orderId: string): Promise<string> {
  if (!/^[a-f\d]{24}$/i.test(orderId)) {
    throw new Error("This order does not have a valid ID.");
  }

  const response = await fetch(`${apiUrl}/orders/${encodeURIComponent(orderId)}/checkout`, {
    method: "POST",
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Checkout request failed (${response.status})`));
  }

  if (typeof payload !== "object" || payload === null) {
    throw new Error("The Checkout response was not in the expected format.");
  }

  const checkoutUrlValue = (payload as Record<string, unknown>).checkoutUrl;
  if (typeof checkoutUrlValue !== "string") {
    throw new Error("The Checkout response was not in the expected format.");
  }

  const checkoutUrl = checkoutUrlValue;
  const parsedUrl = new URL(checkoutUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "checkout.stripe.com") {
    throw new Error("Stripe returned an unexpected Checkout URL.");
  }

  return checkoutUrl;
}
