import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { createStripeCheckoutUrl } from "./checkoutClient";

type PaymentReturnPageProps = {
  variant: "success" | "cancelled";
};

export default function PaymentReturnPage({ variant }: PaymentReturnPageProps) {
  const parameters = new URLSearchParams(window.location.search);
  const orderId = parameters.get("order_id");
  const orderReference = parameters.get("order_reference");
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retryCheckout() {
    if (!orderId) {
      setError("This page is missing the order ID needed to retry checkout.");
      return;
    }

    setError(null);
    setRetrying(true);
    try {
      const checkoutUrl = await createStripeCheckoutUrl(orderId);
      window.location.assign(checkoutUrl);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Unable to restart Stripe Checkout.",
      );
    } finally {
      setRetrying(false);
    }
  }

  const succeeded = variant === "success";

  return (
    <main className="payment-return-page">
      <a className="brand payment-return-brand" href="/">
        <span className="brand-mark">p<span>.</span></span>
        <span>paybridge</span>
      </a>
      <section className="payment-return-card">
        <span className={`payment-return-icon ${succeeded ? "is-success" : "is-cancelled"}`}>
          {succeeded ? <Check size={25} /> : <CircleAlert size={25} />}
        </span>
        <span className="eyebrow"><span /> {succeeded ? "STRIPE CHECKOUT" : "CHECKOUT PAUSED"}</span>
        <h1>{succeeded ? "Thanks, we’re confirming." : "No worries. Your order is waiting."}</h1>
        <p>
          {succeeded
            ? "Payment confirmation can take a moment. PayBridge updates your order only after a verified Stripe notification."
            : "Your order remains pending. If you stopped before paying, you can return to Stripe Checkout and try again."}
        </p>
        {orderReference && (
          <div className="return-order-reference">
            <span>Order reference</span>
            <strong>{orderReference}</strong>
          </div>
        )}
        {error && <p className="return-error" role="alert">{error}</p>}
        {!succeeded && (
          <button
            className="primary-button return-primary-button"
            onClick={() => void retryCheckout()}
            disabled={retrying || !orderId}
          >
            {retrying ? <LoaderCircle className="spin-icon" size={16} /> : <ArrowRight size={16} />}
            {retrying ? "Reopening Checkout…" : "Retry with Stripe"}
          </button>
        )}
        <a className="return-shop-link" href="/#catalogue">
          <ArrowLeft size={14} /> Back to the shop
        </a>
      </section>
      <span className="return-footnote">PayBridge · Thoughtfully picked for everyday.</span>
    </main>
  );
}
