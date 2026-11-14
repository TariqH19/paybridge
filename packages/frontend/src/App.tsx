import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Box,
  Headphones,
  Plus,
  RotateCcw,
  ShoppingBag,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import CartDrawer from "./CartDrawer";
import AdminDashboard from "./AdminDashboard";
import NotFoundPage from "./NotFoundPage";
import PaymentReturnPage from "./PaymentReturnPage";
import ProjectLandingPage from "./ProjectLandingPage";
import { apiUrl, getApiErrorMessage, requestJson } from "./api";
import { readStoredCart, saveCart } from "./cart";
import type { CartItem, Product } from "./types";

function isProduct(value: unknown): value is Product {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const product = value as Record<string, unknown>;
  return (
    typeof product.id === "string" &&
    typeof product.name === "string" &&
    typeof product.description === "string" &&
    typeof product.price === "number" &&
    typeof product.currency === "string" &&
    typeof product.category === "string" &&
    typeof product.imageUrl === "string" &&
    typeof product.stock === "number" &&
    typeof product.active === "boolean"
  );
}

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(price / 100);
}

function ProductCard({
  product,
  index,
  cartQuantity,
  onAdd,
}: {
  product: Product;
  index: number;
  cartQuantity: number;
  onAdd: (product: Product) => void;
}) {
  return (
    <article
      className="product-card group animate-card-in"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <a className="product-image-wrap" href="#catalogue" aria-label={product.name}>
        <img
          className="product-image"
          src={product.imageUrl}
          alt={product.name}
          loading="lazy"
        />
        <span className="product-category">{product.category}</span>
        <span className="image-arrow" aria-hidden="true">
          <ArrowUpRight size={17} />
        </span>
      </a>
      <div className="product-copy">
        <div>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
        </div>
        <div className="product-bottom">
          <span className="product-price">{formatPrice(product.price, product.currency)}</span>
          <span className="stock-status">
            <span className="stock-dot" />
            {product.stock > 0 ? "In stock" : "Sold out"}
          </span>
        </div>
        <button
          className="add-to-bag-button"
          onClick={() => onAdd(product)}
          disabled={product.stock === 0 || cartQuantity >= Math.min(product.stock, 99)}
        >
          <Plus size={14} />
          {product.stock === 0
            ? "Sold out"
            : cartQuantity >= Math.min(product.stock, 99)
              ? "In your bag"
              : cartQuantity > 0
                ? "Add another"
                : "Add to bag"}
        </button>
      </div>
    </article>
  );
}

function Storefront() {
  const [initialCart] = useState(readStoredCart);
  const [cart, setCart] = useState<CartItem[]>(initialCart.items);
  const [cartStorageError, setCartStorageError] = useState<string | null>(initialCart.error);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartNotice, setCartNotice] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cartWasInitialized = useRef(false);

  async function loadProducts(signal?: AbortSignal) {
    setLoading(true);
    setError(null);

    try {
      const { response, body } = await requestJson(`${apiUrl}/products`, { signal });
      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(body, `Catalogue request failed (${response.status})`),
        );
      }

      const result = body;
      if (!Array.isArray(result) || !result.every(isProduct)) {
        throw new Error("The catalogue response was not in the expected format");
      }
      setProducts(result);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") {
        return;
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Something went wrong while loading the catalogue.",
      );
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadProducts(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      saveCart(cart);
      if (cartWasInitialized.current) {
        setCartStorageError(null);
      }
    } catch {
      setCartStorageError("Cart changes could not be saved in this browser.");
    }
    cartWasInitialized.current = true;
  }, [cart]);

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartRows = cart.map((item) => ({
    item,
    product: products.find((product) => product.id === item.productId),
  }));
  const currencies = [
    ...new Set(cartRows.flatMap(({ product }) => (product ? [product.currency] : []))),
  ];
  const mixedCurrencies = currencies.length > 1;
  const cartCurrency = currencies[0] ?? "USD";
  const cartSubtotal = cartRows.reduce(
    (total, { item, product }) =>
      product ? total + product.price * item.quantity : total,
    0,
  );

  function addToCart(product: Product) {
    const currentQuantity = cart.find((item) => item.productId === product.id)?.quantity ?? 0;
    if (currentQuantity >= Math.min(product.stock, 99)) {
      setCartNotice(`${product.name} has reached its available quantity.`);
      return;
    }

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.productId === product.id);
      return existing
        ? currentCart.map((item) =>
            item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
          )
        : [...currentCart, { productId: product.id, quantity: 1 }];
    });
    setCartNotice(`${product.name} added to your bag.`);
  }

  function changeQuantity(productId: string, quantity: number) {
    const product = products.find((item) => item.id === productId);
    const currentQuantity = cart.find((item) => item.productId === productId)?.quantity ?? 0;
    if (quantity > currentQuantity && (!product || quantity > Math.min(product.stock, 99))) {
      return;
    }

    setCart((currentCart) =>
      currentCart.map((item) =>
        item.productId === productId
          ? { ...item, quantity: Math.max(1, Math.min(99, quantity)) }
          : item,
      ),
    );
  }

  function removeFromCart(productId: string) {
    setCart((currentCart) => currentCart.filter((item) => item.productId !== productId));
  }

  return (
    <div className="site-shell">
      <div className="announcement">
        <Sparkles size={14} strokeWidth={2} />
        <span>Good finds. Better everyday.</span>
        <span className="announcement-divider">·</span>
        <span>Thoughtfully picked for you</span>
      </div>

      <header className="site-header">
        <a className="brand" href="/" aria-label="PayBridge project overview">
          <span className="brand-mark">p<span>.</span></span>
          <span>paybridge</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-active" href="#catalogue">Shop all</a>
          <a href="#promise">Our promise</a>
          <a href="#footer">Say hello</a>
        </nav>
        <div className="header-actions">
          <a className="header-link" href="/admin">
            Admin <ArrowUpRight size={15} />
          </a>
          <button
            className="cart-nav-button"
            onClick={() => setCartOpen(true)}
            aria-label={`Open shopping bag, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
          >
            <ShoppingBag size={18} />
            <span>Bag</span>
            <span className="cart-count">{cartCount}</span>
          </button>
        </div>
      </header>
      <span className="visually-hidden" aria-live="polite">{cartNotice}</span>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span /> THE EVERYDAY EDIT</div>
            <h1>Good things,<br />well <span>chosen.</span></h1>
            <p className="hero-description">
              Useful little upgrades. Thoughtful tech. Everyday essentials that just make sense.
            </p>
            <a className="primary-button" href="#catalogue">
              Find your next favourite <ArrowRight size={17} />
            </a>
            <div className="hero-note">
              <span className="note-icon"><BadgeCheck size={17} /></span>
              <span>Picked with care, made for real life.</span>
            </div>
          </div>
          <div className="hero-art">
            <img
              src="https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=1400&q=90"
              alt="Carefully arranged everyday tech essentials"
            />
            <div className="hero-sticker">
              <span className="sticker-star">✳</span>
              <span>THE LITTLE<br />THINGS MATTER</span>
            </div>
            <div className="hero-caption">
              <span>01 — 08</span>
              <span>Everyday, elevated</span>
            </div>
          </div>
          <a className="scroll-cue" href="#catalogue">
            <ArrowDown size={15} /> SCROLL TO EXPLORE
          </a>
        </section>

        <section className="promise-strip" id="promise">
          <div className="promise-item">
            <span className="promise-icon"><Box size={19} /></span>
            <div><strong>Good things, shipped</strong><span>Carefully packed, always.</span></div>
          </div>
          <div className="promise-item">
            <span className="promise-icon"><ShieldCheck size={19} /></span>
            <div><strong>Picked with purpose</strong><span>Useful, considered, loved.</span></div>
          </div>
          <div className="promise-item">
            <span className="promise-icon"><RotateCcw size={19} /></span>
            <div><strong>Here if you need us</strong><span>Real help, no runaround.</span></div>
          </div>
        </section>

        <section className="catalogue-section" id="catalogue">
          <div className="section-heading">
            <div>
              <div className="eyebrow"><span /> THE GOOD STUFF</div>
              <h2>A few things<br className="mobile-break" /> worth finding.</h2>
            </div>
            <p>Less scrolling, better picking.<br />Meet the things we think you’ll love.</p>
          </div>

          {loading ? (
            <div className="product-grid" aria-label="Loading products">
              {Array.from({ length: 8 }, (_, index) => (
                <div className="skeleton-card" key={index}>
                  <div className="skeleton-image" />
                  <div className="skeleton-line skeleton-title" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line skeleton-price" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="state-panel error-panel" role="alert">
              <span className="state-icon"><Headphones size={22} /></span>
              <h3>We couldn’t load the good stuff.</h3>
              <p>{error}</p>
              <button className="secondary-button" onClick={() => void loadProducts()}>
                Try again <RotateCcw size={15} />
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="state-panel">
              <span className="state-icon"><Box size={22} /></span>
              <h3>It’s a little quiet in here.</h3>
              <p>There aren’t any products to show just yet. Check back soon.</p>
            </div>
          ) : (
            <div className="product-grid">
              {products.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  index={index}
                  cartQuantity={cart.find((item) => item.productId === product.id)?.quantity ?? 0}
                  onAdd={addToCart}
                />
              ))}
            </div>
          )}
        </section>

        <section className="closing-banner">
          <div className="closing-mark">p<span>.</span></div>
          <div>
            <span className="closing-kicker">A LITTLE MORE THOUGHTFUL</span>
            <h2>Everyday, a bit better.</h2>
          </div>
          <a href="#catalogue" aria-label="Back to the catalogue"><ArrowUpRight size={21} /></a>
        </section>
      </main>

      <footer className="site-footer" id="footer">
        <a className="brand footer-brand" href="/">
          <span className="brand-mark">p<span>.</span></span>
          <span>paybridge</span>
        </a>
        <span>Useful things for your everyday.</span>
        <a className="store-footer-link" href="/">Project overview</a>
        <a className="store-footer-link" href="/admin">Admin dashboard</a>
        <span>© {new Date().getFullYear()} PayBridge</span>
      </footer>
      {cartOpen && (
        <CartDrawer
          rows={cartRows}
          subtotal={cartSubtotal}
          currency={cartCurrency}
          mixedCurrencies={mixedCurrencies}
          productsLoading={loading}
          storageError={cartStorageError}
          onQuantityChange={changeQuantity}
          onRemove={removeFromCart}
          onClose={() => setCartOpen(false)}
          onOrderCreated={() => setCart([])}
        />
      )}
    </div>
  );
}

function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    return <ProjectLandingPage />;
  }
  if (path === "/shop") {
    return <Storefront />;
  }
  if (path === "/admin" || path === "/admin/") {
    return <AdminDashboard />;
  }
  if (path === "/checkout/success") {
    return <PaymentReturnPage variant="success" />;
  }
  if (path === "/checkout/cancelled") {
    return <PaymentReturnPage variant="cancelled" />;
  }
  return <NotFoundPage />;
}

export default App;
