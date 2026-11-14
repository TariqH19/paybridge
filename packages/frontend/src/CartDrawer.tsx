import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  CreditCard,
  LoaderCircle,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import type { CartRow, CreatedOrder, OrderItem } from "./types";
import { apiUrl, getApiErrorMessage, requestJson } from "./api";
import { createStripeCheckoutUrl } from "./checkoutClient";

type CartDrawerProps = {
  rows: CartRow[];
  subtotal: number;
  currency: string;
  mixedCurrencies: boolean;
  productsLoading: boolean;
  storageError: string | null;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onClose: () => void;
  onOrderCreated: () => void;
};

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price / 100);
}

function isOrderItem(value: unknown): value is OrderItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.productId === "string" &&
    typeof item.name === "string" &&
    typeof item.imageUrl === "string" &&
    typeof item.unitPrice === "number" &&
    typeof item.quantity === "number" &&
    typeof item.lineTotal === "number" &&
    typeof item.currency === "string"
  );
}

function isCreatedOrder(value: unknown): value is CreatedOrder {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const order = value as Record<string, unknown>;
  if (typeof order.customer !== "object" || order.customer === null) {
    return false;
  }

  const customer = order.customer as Record<string, unknown>;
  return (
    typeof order.id === "string" &&
    typeof order.reference === "string" &&
    typeof customer.name === "string" &&
    typeof customer.email === "string" &&
    Array.isArray(order.items) &&
    order.items.every(isOrderItem) &&
    typeof order.subtotal === "number" &&
    typeof order.total === "number" &&
    typeof order.currency === "string" &&
    order.status === "pending" &&
    typeof order.createdAt === "string" &&
    typeof order.updatedAt === "string"
  );
}

export default function CartDrawer({
  rows,
  subtotal,
  currency,
  mixedCurrencies,
  productsLoading,
  storageError,
  onQuantityChange,
  onRemove,
  onClose,
  onOrderCreated,
}: CartDrawerProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const unavailable = rows.some(({ product }) => !product);
  const stockExceeded = rows.some(
    ({ item, product }) => product && item.quantity > product.stock,
  );
  const totalIsSafe = Number.isSafeInteger(subtotal);
  const canSubmit =
    rows.length > 0 &&
    !productsLoading &&
    !unavailable &&
    !stockExceeded &&
    !mixedCurrencies &&
    totalIsSafe;

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderError(null);
    setSubmitting(true);

    try {
      const { response, body } = await requestJson(`${apiUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: customerName, email: customerEmail },
          items: rows.map(({ item }) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(body, `Order request failed (${response.status})`),
        );
      }
      if (!isCreatedOrder(body)) {
        throw new Error("The order response was not in the expected format.");
      }

      setOrder(body);
      onOrderCreated();
    } catch (error) {
      setOrderError(
        error instanceof Error ? error.message : "Something went wrong while placing your order.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function payWithStripe() {
    if (!order) {
      return;
    }

    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const checkoutUrl = await createStripeCheckoutUrl(order.id);
      window.location.assign(checkoutUrl);
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "Unable to start Stripe Checkout.",
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  return (
    <div className="cart-overlay">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close shopping cart" />
      <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <div className="drawer-header">
          <div className="drawer-heading">
            {order ? (
              <span className="drawer-icon confirmation-icon"><Check size={18} /></span>
            ) : (
              <span className="drawer-icon"><ShoppingBag size={18} /></span>
            )}
            <div>
              <span className="drawer-kicker">{order ? "ALL SET" : "YOUR EVERYDAY EDIT"}</span>
              <h2 id="cart-title">{order ? "Order received" : "Your bag"}</h2>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close cart">
            <X size={19} />
          </button>
        </div>

        {storageError && !order && (
          <p className="cart-storage-warning" role="status">{storageError}</p>
        )}

        {order ? (
          <div className="order-confirmation">
            <span className="confirmation-check"><Check size={25} /></span>
            <p className="drawer-kicker">THANK YOU, {order.customer.name.toUpperCase()}</p>
            <h3>Your order is in good hands.</h3>
            <p className="confirmation-copy">
              Your order is pending. No payment has been collected.
            </p>
            <div className="confirmation-summary">
              <span>Order reference</span>
              <strong>{order.reference}</strong>
              <span>Order total</span>
              <strong>{formatPrice(order.total, order.currency)}</strong>
            </div>
            <button
              className="details-toggle"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? "Hide order details" : "View order details"}
              <span>{detailsOpen ? "−" : "+"}</span>
            </button>
            {detailsOpen && (
              <div className="order-details">
                <div className="order-customer">
                  <strong>{order.customer.name}</strong>
                  <span>{order.customer.email}</span>
                  <span>Pending · {new Date(order.createdAt).toLocaleString()}</span>
                </div>
                {order.items.map((item) => (
                  <div className="order-detail-row" key={item.productId}>
                    <img src={item.imageUrl} alt="" />
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.quantity} × {formatPrice(item.unitPrice, item.currency)}
                      </span>
                    </div>
                    <b>{formatPrice(item.lineTotal, item.currency)}</b>
                  </div>
                ))}
                <div className="order-total-row">
                  <span>Total</span>
                  <strong>{formatPrice(order.total, order.currency)}</strong>
                </div>
              </div>
            )}
            {order.status === "pending" && (
              <div className="stripe-payment-action">
                {checkoutError && <p className="order-error" role="alert">{checkoutError}</p>}
                <button
                  className="stripe-payment-button"
                  onClick={() => void payWithStripe()}
                  disabled={checkoutLoading}
                >
                  {checkoutLoading ? (
                    <LoaderCircle className="spin-icon" size={16} />
                  ) : (
                    <CreditCard size={16} />
                  )}
                  {checkoutLoading ? "Connecting to Stripe…" : "Pay with Stripe"}
                </button>
                <span>Secure test-mode checkout · {formatPrice(order.total, order.currency)}</span>
              </div>
            )}
            <button className="drawer-continue-button" onClick={onClose}>
              <ArrowLeft size={15} /> Back to the shop
            </button>
          </div>
        ) : (
          <>
            <div className="drawer-content">
              {rows.length === 0 ? (
                <div className="cart-empty">
                  <span className="empty-bag-icon"><ShoppingBag size={23} /></span>
                  <h3>Your bag is taking a breather.</h3>
                  <p>Find something useful for your everyday.</p>
                  <button className="drawer-continue-button" onClick={onClose}>
                    <ArrowLeft size={15} /> Keep exploring
                  </button>
                </div>
              ) : (
                <div className="cart-lines">
                  {rows.map(({ item, product }) => (
                    <article className="cart-line" key={item.productId}>
                      {product ? (
                        <img className="cart-line-image" src={product.imageUrl} alt={product.name} />
                      ) : (
                        <div className="cart-line-placeholder"><ShoppingBag size={18} /></div>
                      )}
                      <div className="cart-line-main">
                        <div className="cart-line-heading">
                          <div>
                            <h3>{product?.name ?? "Product unavailable"}</h3>
                            <span className="cart-unit-price">
                              {product ? formatPrice(product.price, product.currency) : "No longer available"}
                            </span>
                          </div>
                          <button
                            className="remove-line"
                            onClick={() => onRemove(item.productId)}
                            aria-label={`Remove ${product?.name ?? "unavailable product"}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="cart-line-bottom">
                          <div className="quantity-control" aria-label="Product quantity">
                            <button
                              onClick={() => onQuantityChange(item.productId, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              aria-label={`Decrease ${product?.name ?? "product"} quantity`}
                            >
                              <Minus size={13} />
                            </button>
                            <span>{item.quantity}</span>
                            <button
                              onClick={() => onQuantityChange(item.productId, item.quantity + 1)}
                              disabled={
                                !product ||
                                item.quantity >= Math.min(product.stock, 99) ||
                                submitting
                              }
                              aria-label={`Increase ${product?.name ?? "product"} quantity`}
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                          <strong className="cart-line-total">
                            {product
                              ? formatPrice(product.price * item.quantity, product.currency)
                              : "—"}
                          </strong>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {rows.length > 0 && (
              <div className="drawer-checkout">
                {productsLoading && <p className="cart-validation-note">Checking product availability…</p>}
                {!productsLoading && unavailable && (
                  <p className="cart-validation-note" role="alert">
                    Remove unavailable products before placing your order.
                  </p>
                )}
                {!productsLoading && stockExceeded && (
                  <p className="cart-validation-note" role="alert">
                    Adjust quantities to match the available stock.
                  </p>
                )}
                {mixedCurrencies && (
                  <p className="cart-validation-note" role="alert">
                    Items in a single order must use the same currency.
                  </p>
                )}
                {!totalIsSafe && (
                  <p className="cart-validation-note" role="alert">
                    The cart total is too large to place as one order.
                  </p>
                )}
                <div className="cart-subtotal-row">
                  <span>Subtotal</span>
                  <strong>
                    {mixedCurrencies || !totalIsSafe ? "—" : formatPrice(subtotal, currency)}
                  </strong>
                </div>
                <p className="cart-total-note">Shipping and taxes are not included.</p>
                <form className="checkout-form" onSubmit={submitOrder}>
                  <label>
                    Your name
                    <input
                      name="name"
                      autoComplete="name"
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      maxLength={100}
                      required
                    />
                  </label>
                  <label>
                    Email address
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      maxLength={254}
                      required
                    />
                  </label>
                  {orderError && <p className="order-error" role="alert">{orderError}</p>}
                  <button
                    className="checkout-button"
                    type="submit"
                    disabled={!canSubmit || submitting}
                  >
                    {submitting ? "Placing your order…" : "Place order"}
                    {!submitting && <span>{mixedCurrencies || !totalIsSafe ? "—" : formatPrice(subtotal, currency)}</span>}
                  </button>
                  <p className="checkout-footnote">No payment is collected at this stage.</p>
                </form>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
