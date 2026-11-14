import { apiUrl, getApiErrorMessage, requestJson } from "./api";

export async function createStripeCheckoutUrl(orderId: string): Promise<string> {
  if (!/^[a-f\d]{24}$/i.test(orderId)) {
    throw new Error("This order does not have a valid ID.");
  }

  const { response, body } = await requestJson(
    `${apiUrl}/orders/${encodeURIComponent(orderId)}/checkout`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(body, `Checkout request failed (${response.status})`),
    );
  }

  if (typeof body !== "object" || body === null) {
    throw new Error("The Checkout response was not in the expected format.");
  }

  const checkoutUrlValue = (body as Record<string, unknown>).checkoutUrl;
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
