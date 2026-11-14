import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  CreditCard,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Undo2,
  Users,
  X,
} from "lucide-react";
import {
  AdminApiError,
  createAdminRefund,
  createAdminSession,
  getAdminOrder,
  getAdminAnalytics,
  getAdminOrders,
  getAdminOverview,
  getAdminPayments,
  getAdminWebhookEvent,
  getAdminWebhookEvents,
  getPendingOrderInvestigation,
  type AdminOrderDetail,
  type AdminAnalytics,
  type AdminRefund,
  type AdminRefundReason,
  type AdminOrderSummary,
  type AdminOverview,
  type AdminPayment,
  type AdminWebhookEvent,
  type PendingOrderInvestigation,
} from "./adminClient";

type AdminView = "overview" | "orders" | "payments" | "webhooks" | "analytics";

const SESSION_STORAGE_KEY = "paybridge-admin-session";
const statusLabels: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  payment_failed: "Failed",
  cancelled: "Cancelled",
  not_started: "Not started",
  processed: "Processed",
  none: "Not refunded",
  partially_refunded: "Partially refunded",
  fully_refunded: "Fully refunded",
  succeeded: "Succeeded",
  failed: "Failed",
};

function formatCurrency(amount: number, currency: string): string {
  const fractionDigits = currencyFractionDigits(currency);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount / 10 ** fractionDigits);
}

function currencyFractionDigits(currency: string): number {
  const fractionDigits = new Intl.NumberFormat(undefined, { style: "currency", currency })
    .resolvedOptions().maximumFractionDigits;
  if (fractionDigits === undefined) {
    throw new Error(`Unable to determine currency precision for ${currency}.`);
  }
  return fractionDigits;
}

function amountToInput(amount: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const scale = 10n ** BigInt(digits);
  const minor = BigInt(amount);
  const units = minor / scale;
  if (digits === 0) return units.toString();
  const fraction = (minor % scale).toString().padStart(digits, "0");
  return `${units}.${fraction}`;
}

function inputToMinorUnits(value: string, currency: string): number | null {
  const digits = currencyFractionDigits(currency);
  const expression = digits
    ? new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`)
    : /^\d+$/;
  if (!expression.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(digits);
  const minor = BigInt(whole) * scale + BigInt(digits ? fraction.padEnd(digits, "0") : "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function displayStatus(status: string): string {
  return statusLabels[status] ?? status.replaceAll("_", " ");
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`admin-status admin-status-${status.replaceAll("_", "-")}`}>
      <span />
      {displayStatus(status)}
    </span>
  );
}

function AdminLogin({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(username, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login-page">
      <a className="admin-login-brand" href="/">
        <span className="admin-brand-mark">p.</span>
        <span>paybridge<span className="admin-brand-suffix"> / operations</span></span>
      </a>
      <section className="admin-login-card">
        <span className="admin-login-icon"><LockKeyhole size={21} /></span>
        <div className="admin-eyebrow">PRIVATE WORKSPACE</div>
        <h1>Welcome back.</h1>
        <p>Sign in with the admin credentials configured on the backend.</p>
        <form className="admin-login-form" onSubmit={(event) => void submit(event)}>
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <div className="admin-inline-error" role="alert">{error}</div>}
          <button className="admin-primary-button" disabled={busy}>
            {busy ? <LoaderCircle className="admin-spin" size={16} /> : <ShieldCheck size={16} />}
            {busy ? "Signing in..." : "Sign in securely"}
          </button>
        </form>
        <div className="admin-login-foot"><ShieldCheck size={14} /> Admin APIs are protected by backend authentication.</div>
      </section>
      <a className="admin-back-link" href="/">← Back to the storefront</a>
    </main>
  );
}

function AdminDashboard() {
  const [token, setToken] = useState<string | null>(() =>
    window.sessionStorage.getItem(SESSION_STORAGE_KEY),
  );
  const [view, setView] = useState<AdminView>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [investigation, setInvestigation] = useState<PendingOrderInvestigation | null>(null);
  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [events, setEvents] = useState<AdminWebhookEvent[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [analyticsFrom, setAnalyticsFrom] = useState("");
  const [analyticsTo, setAnalyticsTo] = useState("");
  const [analyticsCurrency, setAnalyticsCurrency] = useState("");
  const [analyticsOrderStatus, setAnalyticsOrderStatus] = useState("");
  const [analyticsRefundStatus, setAnalyticsRefundStatus] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<AdminOrderDetail | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [orderDetailError, setOrderDetailError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<AdminWebhookEvent | null>(null);
  const [eventDetailLoading, setEventDetailLoading] = useState(false);
  const [eventDetailError, setEventDetailError] = useState("");

  async function signIn(username: string, password: string) {
    const session = await createAdminSession(username, password);
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, session.token);
    setToken(session.token);
  }

  function signOut() {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setToken(null);
    setOverview(null);
    setInvestigation(null);
    setOrders([]);
    setPayments([]);
    setEvents([]);
    setAnalytics(null);
    setSelectedOrder(null);
    setSelectedEvent(null);
  }

  useEffect(() => {
    if (!token) return;
    let active = true;

    async function loadView() {
      setLoading(true);
      setError("");
      try {
        if (view === "overview") {
          const [nextOverview, nextInvestigation] = await Promise.all([
            getAdminOverview(token!),
            getPendingOrderInvestigation(token!),
          ]);
          if (active) {
            setOverview(nextOverview);
            setInvestigation(nextInvestigation);
          }
        } else if (view === "orders") {
          const result = await getAdminOrders(token!, { search, status: statusFilter, sort });
          if (active) {
            setOrders(result.orders);
            setOrderTotal(result.total);
          }
        } else if (view === "payments") {
          const result = await getAdminPayments(token!);
          if (active) setPayments(result);
        } else if (view === "analytics") {
          const result = await getAdminAnalytics(token!, {
            from: analyticsFrom,
            to: analyticsTo,
            currency: analyticsCurrency,
            orderStatus: analyticsOrderStatus,
            refundStatus: analyticsRefundStatus,
          });
          if (active) setAnalytics(result);
        } else {
          const result = await getAdminWebhookEvents(token!);
          if (active) setEvents(result);
        }
      } catch (loadError) {
        if (!active) return;
        if (loadError instanceof AdminApiError && loadError.status === 401) {
          signOut();
          setError("Your admin session expired. Please sign in again.");
        } else {
          setError(loadError instanceof Error ? loadError.message : "Unable to load admin data.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadView();
    return () => {
      active = false;
    };
  }, [
    token,
    view,
    search,
    statusFilter,
    sort,
    analyticsFrom,
    analyticsTo,
    analyticsCurrency,
    analyticsOrderStatus,
    analyticsRefundStatus,
    refreshVersion,
  ]);

  async function openOrder(orderId: string) {
    if (!token) return;
    setSelectedOrder(null);
    setOrderDetailError("");
    setOrderDetailLoading(true);
    try {
      setSelectedOrder(await getAdminOrder(token, orderId));
    } catch (detailError) {
      setOrderDetailError(
        detailError instanceof Error ? detailError.message : "Unable to load order details.",
      );
    } finally {
      setOrderDetailLoading(false);
    }
  }

  async function openEvent(eventId: string) {
    if (!token) return;
    setSelectedEvent(null);
    setEventDetailError("");
    setEventDetailLoading(true);
    try {
      setSelectedEvent(await getAdminWebhookEvent(token, eventId));
    } catch (detailError) {
      setEventDetailError(
        detailError instanceof Error ? detailError.message : "Unable to load event details.",
      );
    } finally {
      setEventDetailLoading(false);
    }
  }

  async function submitRefund(
    orderId: string,
    input: {
      paymentId: string;
      amount: number;
      reason?: AdminRefundReason;
      idempotencyKey: string;
    },
  ) {
    if (!token) throw new Error("Admin authentication is required.");
    const result = await createAdminRefund(token, orderId, input);
    setRefreshVersion((value) => value + 1);
    try {
      setSelectedOrder(await getAdminOrder(token, orderId));
      return { refund: result.refund };
    } catch (refreshError) {
      return {
        refund: result.refund,
        refreshWarning:
          refreshError instanceof Error
            ? `Refund was submitted, but order details could not be refreshed: ${refreshError.message}`
            : "Refund was submitted, but order details could not be refreshed.",
      };
    }
  }

  if (!token) {
    return <AdminLogin onLogin={signIn} />;
  }

  const navigation: Array<{ id: AdminView; label: string; icon: typeof LayoutDashboard }> = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "orders", label: "Orders", icon: ShoppingBag },
    { id: "payments", label: "Payments", icon: CreditCard },
    { id: "webhooks", label: "Webhooks", icon: Radio },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/admin">
          <span className="admin-brand-mark">p.</span>
          <span>paybridge<span className="admin-brand-suffix"> / admin</span></span>
        </a>
        <div className="admin-sidebar-label">WORKSPACE</div>
        <nav className="admin-side-nav" aria-label="Admin sections">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "is-active" : ""}
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={17} />
              <span>{label}</span>
              {view === id && <ChevronRight className="admin-nav-chevron" size={14} />}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-secure-note"><ShieldCheck size={15} /> Protected admin session</div>
          <a className="admin-sidebar-store" href="/">View storefront <ChevronRight size={14} /></a>
          <button className="admin-signout" onClick={signOut}><LogOut size={15} /> Sign out</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-mobile-brand">
            <a className="admin-brand" href="/admin"><span className="admin-brand-mark">p.</span> PayBridge</a>
            <button className="admin-signout-mobile" onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button>
          </div>
          <div className="admin-breadcrumb">PayBridge <span>/</span> {navigation.find((item) => item.id === view)?.label}</div>
          <div className="admin-topbar-actions">
            <span className="admin-live-indicator"><i /> Live data</span>
            <button
              className="admin-refresh-button"
              onClick={() => setRefreshVersion((value) => value + 1)}
              disabled={loading}
              aria-label="Refresh dashboard data"
            >
              <RefreshCw className={loading ? "admin-spin" : ""} size={15} />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <div className="admin-content">
          <div className="admin-page-heading">
            <div>
              <div className="admin-eyebrow">PAYBRIDGE OPERATIONS</div>
              <h1>{navigation.find((item) => item.id === view)?.label}</h1>
              <p>{pageDescription(view)}</p>
            </div>
            <div className="admin-heading-date"><Clock3 size={15} /> {new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date())}</div>
          </div>

          {error && (
            <div className="admin-data-error" role="alert">
              <CircleAlert size={18} /><span>{error}</span>
              <button onClick={() => setRefreshVersion((value) => value + 1)}>Try again</button>
            </div>
          )}

          {loading && !overview && view === "overview" ? (
            <LoadingPanel />
          ) : view === "overview" ? (
            <OverviewView
              overview={overview}
              investigation={investigation}
              loading={loading}
              onOpenOrder={(id) => void openOrder(id)}
            />
          ) : view === "orders" ? (
            <OrdersView
              orders={orders}
              total={orderTotal}
              loading={loading}
              searchDraft={searchDraft}
              onSearchDraft={setSearchDraft}
              onSearch={() => setSearch(searchDraft.trim())}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              sort={sort}
              onSort={setSort}
              onOpenOrder={(id) => void openOrder(id)}
            />
          ) : view === "payments" ? (
            <PaymentsView payments={payments} loading={loading} />
          ) : view === "webhooks" ? (
            <WebhooksView
              events={events}
              loading={loading}
              onOpenEvent={(id) => void openEvent(id)}
            />
          ) : (
            <AnalyticsView
              analytics={analytics}
              loading={loading}
              from={analyticsFrom}
              to={analyticsTo}
              currency={analyticsCurrency}
              orderStatus={analyticsOrderStatus}
              refundStatus={analyticsRefundStatus}
              onFromChange={setAnalyticsFrom}
              onToChange={setAnalyticsTo}
              onCurrencyChange={setAnalyticsCurrency}
              onOrderStatusChange={setAnalyticsOrderStatus}
              onRefundStatusChange={setAnalyticsRefundStatus}
            />
          )}
        </div>
      </main>

      {(selectedOrder || orderDetailLoading || orderDetailError) && (
        <OrderDialog
          order={selectedOrder}
          loading={orderDetailLoading}
          error={orderDetailError}
          onRefund={(input) =>
            selectedOrder
              ? submitRefund(selectedOrder.order.id, input)
              : Promise.reject(new Error("Order details are unavailable."))
          }
          onClose={() => {
            setSelectedOrder(null);
            setOrderDetailError("");
          }}
        />
      )}
      {(selectedEvent || eventDetailLoading || eventDetailError) && (
        <EventDialog
          event={selectedEvent}
          loading={eventDetailLoading}
          error={eventDetailError}
          onClose={() => {
            setSelectedEvent(null);
            setEventDetailError("");
          }}
        />
      )}
    </div>
  );
}

function pageDescription(view: AdminView): string {
  switch (view) {
    case "overview": return "A clear view of orders, payments, and recent activity.";
    case "orders": return "Search, review, and inspect customer orders.";
    case "payments": return "Stripe Checkout records persisted by PayBridge.";
    case "webhooks": return "Verified Stripe event receipts stored by the backend.";
    case "analytics": return "MongoDB-backed sales, payment, and refund analysis.";
  }
}

function LoadingPanel() {
  return <div className="admin-loading"><LoaderCircle className="admin-spin" size={22} /> Loading workspace data…</div>;
}

function MetricCard({
  label,
  value,
  footnote,
  icon: Icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  footnote: string;
  icon: typeof ShoppingBag;
  tone: string;
}) {
  return (
    <article className="admin-metric-card">
      <div className={`admin-metric-icon ${tone}`}><Icon size={18} /></div>
      <span className="admin-metric-label">{label}</span>
      <strong className="admin-metric-value">{value}</strong>
      <span className="admin-metric-footnote">{footnote}</span>
    </article>
  );
}

function OverviewView({
  overview,
  investigation,
  loading,
  onOpenOrder,
}: {
  overview: AdminOverview | null;
  investigation: PendingOrderInvestigation | null;
  loading: boolean;
  onOpenOrder: (id: string) => void;
}) {
  if (!overview && loading) return <LoadingPanel />;
  if (!overview) return <EmptyPanel title="Overview unavailable" copy="Refresh to try loading dashboard data again." />;

  const revenue = overview.paidRevenue.length
    ? overview.paidRevenue.map((line) => `${formatCurrency(line.amount, line.currency)} ${line.currency}`).join(" · ")
    : "—";
  const successValue = overview.paymentSuccessRate
    ? `${overview.paymentSuccessRate.percentage.toFixed(1)}%`
    : "—";
  const successFootnote = overview.paymentSuccessRate
    ? `${overview.paymentSuccessRate.paid} of ${overview.paymentSuccessRate.terminal} completed or failed payments`
    : "No completed or failed payment records";

  return (
    <>
      <section className="admin-metrics-grid" aria-label="Store metrics">
        <MetricCard label="Total orders" value={overview.totalOrders} footnote="All recorded orders" icon={ShoppingBag} tone="tone-green" />
        <MetricCard label="Paid revenue" value={revenue} footnote="Paid orders only · grouped by currency" icon={BadgeDollarSign} tone="tone-blue" />
        <MetricCard label="Pending orders" value={overview.pendingOrders} footnote="Awaiting payment confirmation" icon={Clock3} tone="tone-amber" />
        <MetricCard label="Failed payments" value={overview.failedPayments} footnote="Payment records marked failed" icon={CircleAlert} tone="tone-red" />
        <MetricCard label="Payment success rate" value={successValue} footnote={successFootnote} icon={Activity} tone="tone-violet" />
      </section>

      <div className="admin-overview-grid">
        <section className="admin-panel admin-recent-panel">
          <PanelHeading title="Recent orders" detail="Latest activity from the order collection" action={<span className="admin-count-chip">{overview.recentOrders.length} shown</span>} />
          {overview.recentOrders.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table admin-recent-table">
                <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th><th>Refunds</th></tr></thead>
                <tbody>
                  {overview.recentOrders.map((order) => (
                    <tr key={order.id}>
                      <td><button className="admin-table-link" onClick={() => onOpenOrder(order.id)}>{order.reference}</button></td>
                      <td><strong>{order.customer.name}</strong><small>{order.customer.email}</small></td>
                      <td>{formatDate(order.createdAt)}</td>
                      <td className="admin-table-amount">{formatCurrency(order.total, order.currency)}</td>
                      <td><StatusBadge status={order.status} /></td>
                      <td>
                        <StatusBadge status={order.refundStatus} />
                        {order.refundedAmount > 0 && <small>{formatCurrency(order.refundedAmount, order.currency)} refunded</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyPanel title="No orders yet" copy="Orders will appear here when they are created." />}
        </section>

        <section className="admin-panel admin-integrity-panel">
          <PanelHeading title="Order integrity" detail="Evidence review · no order data is changed" action={<span className="admin-evidence-chip"><ShieldCheck size={13} /> Read only</span>} />
          <PendingOrderEvidence investigation={investigation} onOpenOrder={onOpenOrder} />
        </section>
      </div>
    </>
  );
}

function PendingOrderEvidence({
  investigation,
  onOpenOrder,
}: {
  investigation: PendingOrderInvestigation | null;
  onOpenOrder: (id: string) => void;
}) {
  if (!investigation) {
    return <div className="admin-evidence-loading"><LoaderCircle className="admin-spin" size={17} /> Loading order evidence…</div>;
  }
  if (!investigation.found) {
    return <div className="admin-empty-inline"><AlertTriangle size={18} /><span>Order {investigation.reference} was not found in the paybridge database.</span></div>;
  }

  const { order, payments, recentCheckoutEvents } = investigation;
  return (
    <div className="admin-evidence-content">
      <div className="admin-investigation-order">
        <div>
          <span className="admin-evidence-label">TARGET ORDER</span>
          <strong>{order.reference}</strong>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="admin-evidence-facts">
        <div><span>Created</span><strong>{formatDate(order.createdAt)}</strong></div>
        <div><span>Last updated</span><strong>{formatDate(order.updatedAt)}</strong></div>
        <div><span>Checkout session ID</span><strong>{order.hasCheckoutSessionId ? "Present" : "Not stored"}</strong></div>
        <div><span>Associated payment records</span><strong>{payments.length}</strong></div>
      </div>
      <div className="admin-evidence-items">
        {order.items.map((item, index) => (
          <div key={`${item.name}-${index}`}>
            <span>{item.name} × {item.quantity}</span>
            <strong>{formatCurrency(item.unitPrice, order.currency)} each</strong>
          </div>
        ))}
        <div className="admin-evidence-total"><span>Order total</span><strong>{formatCurrency(order.total, order.currency)}</strong></div>
      </div>
      <div className="admin-diagnosis">
        <div className="admin-diagnosis-icon"><AlertTriangle size={16} /></div>
        <div>
          <strong>Likely explanation</strong>
          <p>
            No Checkout Session ID or payment record is associated with this order, so the payment flow was
            likely never completed or its session was not linked to this order. The order remains pending;
            its status has not been changed.
          </p>
        </div>
      </div>
      <div className="admin-event-correlation">
        <div className="admin-event-correlation-heading">
          <span>Recent Checkout events</span><b>{recentCheckoutEvents.length}</b>
        </div>
        {recentCheckoutEvents.length ? (
          <>
            <p>
              These are recent stored Checkout events, not confirmed matches for this order. The webhook
              archive does not retain an order reference or session ID for correlation.
            </p>
            <ul>
              {recentCheckoutEvents.slice(0, 3).map((event) => (
                <li key={event.eventId}><span>{event.type}</span><time>{formatDate(event.createdAt)}</time></li>
              ))}
            </ul>
          </>
        ) : <p>No Checkout session events are currently recorded in the webhook event collection.</p>}
      </div>
      <button className="admin-text-button" onClick={() => onOpenOrder(order.id)}>Inspect full order <ChevronRight size={14} /></button>
    </div>
  );
}

function PanelHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-panel-heading">
      <div><h2>{title}</h2><p>{detail}</p></div>
      {action}
    </div>
  );
}

function OrdersView({
  orders,
  total,
  loading,
  searchDraft,
  onSearchDraft,
  onSearch,
  statusFilter,
  onStatusFilter,
  sort,
  onSort,
  onOpenOrder,
}: {
  orders: AdminOrderSummary[];
  total: number;
  loading: boolean;
  searchDraft: string;
  onSearchDraft: (value: string) => void;
  onSearch: () => void;
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  sort: string;
  onSort: (value: string) => void;
  onOpenOrder: (id: string) => void;
}) {
  return (
    <section className="admin-panel admin-data-panel">
      <div className="admin-list-toolbar">
        <form
          className="admin-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <Search size={16} />
          <input
            value={searchDraft}
            onChange={(event) => onSearchDraft(event.target.value)}
            placeholder="Search reference, customer or email"
            aria-label="Search orders"
          />
          <button type="submit">Search</button>
        </form>
        <div className="admin-list-filters">
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="payment_failed">Payment failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            <span>Date</span>
            <select value={sort} onChange={(event) => onSort(event.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
      </div>
      <div className="admin-list-summary">{loading ? "Updating orders…" : `${orders.length} of ${total} orders`}{total > 100 && " · showing first 100"}</div>
      {loading && !orders.length ? <LoadingPanel /> : orders.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Order reference</th><th>Customer</th><th>Order date</th><th>Total</th><th>Order status</th><th>Payment</th><th>Refund</th><th /></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><button className="admin-table-link" onClick={() => onOpenOrder(order.id)}>{order.reference}</button></td>
                  <td><strong>{order.customer.name}</strong><small>{order.customer.email}</small></td>
                  <td>{formatDate(order.createdAt)}</td>
                  <td className="admin-table-amount">{formatCurrency(order.total, order.currency)}</td>
                  <td><StatusBadge status={order.status} /></td>
                  <td><StatusBadge status={order.paymentStatus} /></td>
                  <td>
                    <StatusBadge status={order.refundStatus} />
                    {order.refundedAmount > 0 && <small>{formatCurrency(order.refundedAmount, order.currency)}</small>}
                  </td>
                  <td><button className="admin-row-action" aria-label={`View ${order.reference}`} onClick={() => onOpenOrder(order.id)}><ChevronRight size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyPanel title="No matching orders" copy="Try a different search or status filter." />}
    </section>
  );
}

function PaymentsView({ payments, loading }: { payments: AdminPayment[]; loading: boolean }) {
  if (loading && !payments.length) return <LoadingPanel />;
  return (
    <section className="admin-panel admin-data-panel">
      <PanelHeading title="Stripe payment records" detail={`${payments.length} records · latest 100 · no Stripe secret data is returned`} action={<span className="admin-evidence-chip"><CreditCard size={13} /> Stripe</span>} />
      {payments.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Payment</th><th>Order</th><th>Checkout Session ID</th><th>Amount</th><th>Status</th><th>Refund</th><th>Provider</th><th>Created</th></tr></thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td><span className="admin-record-id">{payment.id.slice(-8)}</span></td>
                  <td><strong>{payment.orderReference}</strong></td>
                  <td><code className="admin-session-id">{payment.stripeCheckoutSessionId}</code></td>
                  <td className="admin-table-amount">{formatCurrency(payment.amount, payment.currency)}</td>
                  <td><StatusBadge status={payment.status} /></td>
                  <td>
                    <StatusBadge status={payment.refundStatus} />
                    {payment.refundedAmount > 0 && <small>{formatCurrency(payment.refundedAmount, payment.currency)}</small>}
                  </td>
                  <td><span className="admin-provider"><i /> {payment.provider}</span></td>
                  <td>{formatDate(payment.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyPanel title="No payment records" copy="Stripe Checkout records appear here when sessions are created." />}
    </section>
  );
}

function WebhooksView({
  events,
  loading,
  onOpenEvent,
}: {
  events: AdminWebhookEvent[];
  loading: boolean;
  onOpenEvent: (id: string) => void;
}) {
  if (loading && !events.length) return <LoadingPanel />;
  return (
    <section className="admin-panel admin-data-panel">
      <PanelHeading title="Stripe webhook history" detail={`${events.length} stored event receipts · latest 100`} action={<span className="admin-evidence-chip"><Radio size={13} /> Verified endpoint</span>} />
      <div className="admin-webhook-notice"><ShieldCheck size={16} /> Event details show metadata only. Webhook payloads are not stored or exposed.</div>
      {events.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Stripe event ID</th><th>Event type</th><th>Processing status</th><th>Received</th><th>Processed</th><th /></tr></thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.eventId}>
                  <td><code className="admin-event-id">{event.eventId}</code></td>
                  <td><strong>{event.type}</strong></td>
                  <td><StatusBadge status={event.status} /></td>
                  <td>{formatDate(event.createdAt)}</td>
                  <td>{event.processedAt ? formatDate(event.processedAt) : "—"}</td>
                  <td><button className="admin-row-action" aria-label={`Inspect ${event.eventId}`} onClick={() => onOpenEvent(event.eventId)}><ChevronRight size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyPanel title="No webhook events recorded" copy="Verified Stripe webhook events will be listed here." />}
    </section>
  );
}

function AnalyticsView({
  analytics,
  loading,
  from,
  to,
  currency,
  orderStatus,
  refundStatus,
  onFromChange,
  onToChange,
  onCurrencyChange,
  onOrderStatusChange,
  onRefundStatusChange,
}: {
  analytics: AdminAnalytics | null;
  loading: boolean;
  from: string;
  to: string;
  currency: string;
  orderStatus: string;
  refundStatus: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onOrderStatusChange: (value: string) => void;
  onRefundStatusChange: (value: string) => void;
}) {
  if (!analytics && loading) return <LoadingPanel />;
  if (!analytics) {
    return <EmptyPanel title="Analytics unavailable" copy="Adjust the filters or refresh to load analytics." />;
  }

  const { metrics, charts, currencies } = analytics;
  return (
    <div className="admin-analytics">
      <section className="admin-panel admin-analytics-filters">
        <div className="admin-filter-heading"><CalendarDays size={16} /><div><strong>Analytics filters</strong><span>Dates are interpreted as UTC calendar days.</span></div></div>
        <div className="admin-analytics-filter-controls">
          <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => onFromChange(event.target.value)} /></label>
          <label>To<input type="date" value={to} min={from || undefined} onChange={(event) => onToChange(event.target.value)} /></label>
          <label>Currency<select value={currency} onChange={(event) => onCurrencyChange(event.target.value)}><option value="">All currencies</option>{currencies.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Order status<select value={orderStatus} onChange={(event) => onOrderStatusChange(event.target.value)}><option value="">All order statuses</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="payment_failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
          <label>Refund status<select value={refundStatus} onChange={(event) => onRefundStatusChange(event.target.value)}><option value="">All refund statuses</option><option value="succeeded">Succeeded</option><option value="pending">Pending</option><option value="failed">Failed</option></select></label>
        </div>
        <p className="admin-analytics-filter-note">Refund status narrows the refund trend; refund totals and rates continue to count succeeded outcomes only.</p>
      </section>

      {loading && <div className="admin-analytics-updating"><LoaderCircle className="admin-spin" size={14} /> Updating analytics…</div>}
      <div className="admin-analytics-metrics">
        <MetricCard label="Total orders" value={metrics.totalOrders} footnote="Orders matching filters" icon={ShoppingBag} tone="tone-green" />
        <MetricCard label="Paid orders" value={metrics.paidOrders} footnote="Distinct paid orders" icon={CreditCard} tone="tone-blue" />
        <MetricCard label="Pending orders" value={metrics.pendingOrders} footnote="Awaiting payment" icon={Clock3} tone="tone-amber" />
        <MetricCard label="Failed orders" value={metrics.failedOrders} footnote="Marked payment failed" icon={CircleAlert} tone="tone-red" />
        <MetricCard label="Gross revenue" value={<CurrencyMetrics values={metrics.grossRevenue} />} footnote="Paid orders only" icon={BadgeDollarSign} tone="tone-blue" />
        <MetricCard label="Refunded" value={<CurrencyMetrics values={metrics.totalRefunded} />} footnote="Succeeded refunds only" icon={Undo2} tone="tone-red" />
        <MetricCard label="Net revenue" value={<CurrencyMetrics values={metrics.netRevenue} />} footnote="Gross less succeeded refunds" icon={TrendingUp} tone="tone-green" />
        <MetricCard label="Average order value" value={<CurrencyMetrics values={metrics.averageOrderValue} />} footnote="Gross per paid order" icon={CircleDollarSign} tone="tone-violet" />
        <MetricCard
          label="Refund rate"
          value={metrics.refundRate ? `${metrics.refundRate.percentage.toFixed(1)}%` : "—"}
          footnote={metrics.refundRate ? `${metrics.refundRate.refundedOrders} refunded / ${metrics.refundRate.paidOrders} paid orders` : "No paid orders in this selection"}
          icon={Undo2}
          tone="tone-amber"
        />
        <MetricCard
          label="Payment success rate"
          value={metrics.paymentSuccessRate ? `${metrics.paymentSuccessRate.percentage.toFixed(1)}%` : "—"}
          footnote={metrics.paymentSuccessRate ? `${metrics.paymentSuccessRate.paidOrders} paid / ${metrics.paymentSuccessRate.terminalOrders} distinct terminal orders` : "No paid or failed orders"}
          icon={Activity}
          tone="tone-violet"
        />
      </div>

      <div className="admin-analytics-note">
        <ShieldCheck size={15} />
        <span>
          Revenue excludes unpaid orders. Refund totals include succeeded refunds only; pending and failed
          refund records are visible in the refund trend. Money is grouped by currency, and payment success
          is counted by distinct order rather than payment attempt or webhook event.
        </span>
      </div>

      <div className="admin-chart-grid">
        <RevenueTrendChart data={charts.revenueOverTime} />
        <OrdersTrendChart data={charts.ordersOverTime} />
        <StatusDistributionChart data={charts.ordersByStatus} />
        <ProductRevenueChart data={charts.revenueByProduct} />
        <RefundTrendChart data={charts.refundsOverTime} />
      </div>
    </div>
  );
}

function CurrencyMetrics({
  values,
}: {
  values: Array<{ currency: string; amount: number }>;
}) {
  if (!values.length) return <span className="admin-metric-empty">—</span>;
  return (
    <span className="admin-currency-metrics">
      {values.map(({ currency, amount }) => (
        <span key={currency}>{formatCurrency(amount, currency)} <small>{currency}</small></span>
      ))}
    </span>
  );
}

function RevenueTrendChart({
  data,
}: {
  data: AdminAnalytics["charts"]["revenueOverTime"];
}) {
  const byCurrency = new Map<string, Map<string, number>>();
  for (const point of data) {
    const dates = byCurrency.get(point.currency) ?? new Map<string, number>();
    dates.set(point.date, point.amount);
    byCurrency.set(point.currency, dates);
  }
  return (
    <ChartPanel title="Revenue over time" subtitle="Gross paid-order revenue, separated by currency" icon={<TrendingUp size={15} />}>
      {byCurrency.size ? (
        <div className="admin-chart-currency-groups">
          {[...byCurrency].map(([currency, dates]) => {
            const entries = [...dates].sort(([left], [right]) => left.localeCompare(right));
            const max = Math.max(...entries.map(([, amount]) => amount), 0);
            return (
              <div className="admin-chart-currency-group" key={currency}>
                <div className="admin-chart-series-label">{currency}<span>{formatCurrency(max, currency)} peak</span></div>
                <div className="admin-bars" role="img" aria-label={`${currency} gross revenue by day`}>
                  {entries.map(([date, amount]) => (
                    <div className="admin-bar-column" key={date} title={`${date}: ${formatCurrency(amount, currency)}`}>
                      <div className="admin-bar-track"><span className="admin-bar admin-bar-revenue" style={{ height: `${max ? Math.max(3, (amount / max) * 100) : 0}%` }} /></div>
                      <time>{shortDate(date)}</time>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : <ChartEmpty copy="No paid-order revenue in this date range." />}
    </ChartPanel>
  );
}

function OrdersTrendChart({
  data,
}: {
  data: AdminAnalytics["charts"]["ordersOverTime"];
}) {
  const byDate = new Map<string, Map<string, number>>();
  for (const point of data) {
    const statuses = byDate.get(point.date) ?? new Map<string, number>();
    statuses.set(point.status, point.count);
    byDate.set(point.date, statuses);
  }
  const entries = [...byDate].sort(([left], [right]) => left.localeCompare(right));
  const max = Math.max(...entries.map(([, statuses]) => [...statuses.values()].reduce((sum, count) => sum + count, 0)), 0);
  return (
    <ChartPanel title="Orders over time" subtitle="Daily order counts by current order status" icon={<BarChart3 size={15} />}>
      {entries.length ? (
        <>
          <div className="admin-chart-legend">
            {(["paid", "pending", "payment_failed", "cancelled"] as const).map((status) => (
              <span key={status}><i className={`legend-${status.replaceAll("_", "-")}`} />{displayStatus(status)}</span>
            ))}
          </div>
          <div className="admin-bars" role="img" aria-label="Orders per day grouped by order status">
            {entries.map(([date, statuses]) => {
              const total = [...statuses.values()].reduce((sum, count) => sum + count, 0);
              return (
                <div className="admin-bar-column" key={date} title={`${date}: ${total} orders`}>
                  <div className="admin-bar-track admin-bar-stack">
                    {(["paid", "pending", "payment_failed", "cancelled"] as const).map((status) => {
                      const count = statuses.get(status) ?? 0;
                      return count > 0 ? <span key={status} className={`admin-bar-segment segment-${status.replaceAll("_", "-")}`} style={{ height: `${max ? (count / max) * 100 : 0}%` }} /> : null;
                    })}
                  </div>
                  <time>{shortDate(date)}</time>
                </div>
              );
            })}
          </div>
        </>
      ) : <ChartEmpty copy="No orders match the selected date and status filters." />}
    </ChartPanel>
  );
}

function StatusDistributionChart({
  data,
}: {
  data: AdminAnalytics["charts"]["ordersByStatus"];
}) {
  const max = Math.max(...data.map((item) => item.count), 0);
  return (
    <ChartPanel title="Orders by status" subtitle="Distinct orders in the selected range" icon={<Activity size={15} />}>
      {data.length ? (
        <div className="admin-status-distribution">
          {data.map(({ status, count }) => (
            <div className="admin-status-row" key={status}>
              <div><StatusBadge status={status} /><strong>{count}</strong></div>
              <span className="admin-status-track"><i className={`distribution-${status.replaceAll("_", "-")}`} style={{ width: `${max ? (count / max) * 100 : 0}%` }} /></span>
            </div>
          ))}
        </div>
      ) : <ChartEmpty copy="No orders match the selected filters." />}
    </ChartPanel>
  );
}

function ProductRevenueChart({
  data,
}: {
  data: AdminAnalytics["charts"]["revenueByProduct"];
}) {
  const byCurrency = new Map<string, typeof data>();
  for (const item of data) {
    byCurrency.set(item.currency, [...(byCurrency.get(item.currency) ?? []), item]);
  }
  return (
    <ChartPanel title="Revenue by product" subtitle="Gross revenue from paid order snapshots" icon={<BadgeDollarSign size={15} />}>
      {byCurrency.size ? (
        <div className="admin-product-revenue-groups">
          {[...byCurrency].map(([currency, products]) => {
            const max = Math.max(...products.map((item) => item.amount), 0);
            return (
              <div key={currency}>
                <div className="admin-chart-series-label">{currency}<span>{products.length} products shown</span></div>
                {products.map((product) => (
                  <div className="admin-product-revenue" key={`${product.productId}-${currency}`}>
                    <div><strong>{product.name}</strong><span>{product.quantity} units · {formatCurrency(product.amount, currency)}</span></div>
                    <span className="admin-status-track"><i style={{ width: `${max ? (product.amount / max) * 100 : 0}%` }} /></span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : <ChartEmpty copy="No paid product revenue in the selected range." />}
    </ChartPanel>
  );
}

function RefundTrendChart({
  data,
}: {
  data: AdminAnalytics["charts"]["refundsOverTime"];
}) {
  const byCurrency = new Map<string, Map<string, Map<string, number>>>();
  for (const point of data) {
    const dates = byCurrency.get(point.currency) ?? new Map<string, Map<string, number>>();
    const statuses = dates.get(point.date) ?? new Map<string, number>();
    statuses.set(point.status, point.amount);
    dates.set(point.date, statuses);
    byCurrency.set(point.currency, dates);
  }
  return (
    <ChartPanel title="Refunds over time" subtitle="Refund amounts by Stripe refund state and currency" icon={<Undo2 size={15} />}>
      {byCurrency.size ? (
        <>
          <div className="admin-chart-legend">
            {(["succeeded", "pending", "failed"] as const).map((status) => (
              <span key={status}><i className={`legend-refund-${status}`} />{displayStatus(status)}</span>
            ))}
          </div>
          <div className="admin-chart-currency-groups">
            {[...byCurrency].map(([currency, dates]) => {
              const entries = [...dates].sort(([left], [right]) => left.localeCompare(right));
              const max = Math.max(...entries.map(([, statuses]) => [...statuses.values()].reduce((sum, amount) => sum + amount, 0)), 0);
              return (
                <div className="admin-chart-currency-group" key={currency}>
                  <div className="admin-chart-series-label">{currency}</div>
                  <div className="admin-bars" role="img" aria-label={`${currency} refunds by day and status`}>
                    {entries.map(([date, statuses]) => {
                      const total = [...statuses.values()].reduce((sum, amount) => sum + amount, 0);
                      return (
                        <div className="admin-bar-column" key={date} title={`${date}: ${formatCurrency(total, currency)}`}>
                          <div className="admin-bar-track admin-bar-stack">
                            {(["succeeded", "pending", "failed"] as const).map((status) => {
                              const amount = statuses.get(status) ?? 0;
                              return amount > 0 ? <span key={status} className={`admin-bar-segment refund-segment-${status}`} style={{ height: `${max ? (amount / max) * 100 : 0}%` }} /> : null;
                            })}
                          </div>
                          <time>{shortDate(date)}</time>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : <ChartEmpty copy="No refund records match the selected filters." />}
    </ChartPanel>
  );
}

function ChartPanel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-panel admin-chart-panel">
      <PanelHeading title={title} detail={subtitle} action={<span className="admin-chart-icon">{icon}</span>} />
      <div className="admin-chart-content">{children}</div>
    </section>
  );
}

function ChartEmpty({ copy }: { copy: string }) {
  return <div className="admin-chart-empty">{copy}</div>;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function OrderDialog({
  order,
  loading,
  error,
  onRefund,
  onClose,
}: {
  order: AdminOrderDetail | null;
  loading: boolean;
  error: string;
  onRefund: (input: {
    paymentId: string;
    amount: number;
    reason?: AdminRefundReason;
    idempotencyKey: string;
  }) => Promise<{ refund: AdminRefund; refreshWarning?: string }>;
  onClose: () => void;
}) {
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [refundAmountInput, setRefundAmountInput] = useState("");
  const [refundReason, setRefundReason] = useState<AdminRefundReason | "">("");
  const [refundRequestKey, setRefundRequestKey] = useState(() => window.crypto.randomUUID());
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [refundRefreshWarning, setRefundRefreshWarning] = useState("");
  const [refundSuccess, setRefundSuccess] = useState<AdminRefund | null>(null);
  const firstEligiblePayment = order?.payments.find(
    (payment) => payment.status === "paid" && payment.remainingRefundableAmount > 0,
  );
  const selectedPayment =
    order?.payments.find((payment) => payment.id === selectedPaymentId) ?? firstEligiblePayment;
  const eligiblePayments =
    order?.payments.filter(
      (payment) => payment.status === "paid" && payment.remainingRefundableAmount > 0,
    ) ?? [];
  const requestedAmount =
    selectedPayment && refundAmountInput
      ? inputToMinorUnits(refundAmountInput, selectedPayment.currency)
      : null;
  const remainingAfterRefund =
    selectedPayment && requestedAmount !== null
      ? selectedPayment.remainingRefundableAmount - requestedAmount
      : null;
  const refundEligible =
    order?.order.status === "paid" &&
    selectedPayment?.status === "paid" &&
    selectedPayment.remainingRefundableAmount > 0 &&
    selectedPayment.refundStatus !== "fully_refunded";

  useEffect(() => {
    if (!order) return;
    const first = order.payments.find(
      (payment) => payment.status === "paid" && payment.remainingRefundableAmount > 0,
    );
    setSelectedPaymentId(first?.id ?? "");
    setRefundAmountInput(
      first ? amountToInput(first.remainingRefundableAmount, first.currency) : "",
    );
    setRefundReason("");
    setRefundRequestKey(window.crypto.randomUUID());
    setConfirmRefund(false);
    setRefundError("");
    setRefundSuccess(null);
    setRefundRefreshWarning("");
  }, [order?.order.id]);

  function choosePayment(paymentId: string) {
    const payment = order?.payments.find((item) => item.id === paymentId);
    setSelectedPaymentId(paymentId);
    setRefundAmountInput(
      payment ? amountToInput(payment.remainingRefundableAmount, payment.currency) : "",
    );
    setRefundRequestKey(window.crypto.randomUUID());
    setConfirmRefund(false);
    setRefundError("");
    setRefundSuccess(null);
    setRefundRefreshWarning("");
  }

  async function submitConfirmedRefund() {
    if (!order || !selectedPayment || requestedAmount === null || !refundEligible) return;
    setRefundSubmitting(true);
    setRefundError("");
    setRefundRefreshWarning("");
    try {
      const submission = await onRefund({
        paymentId: selectedPayment.id,
        amount: requestedAmount,
        ...(refundReason ? { reason: refundReason } : {}),
        idempotencyKey: refundRequestKey,
      });
      setRefundSuccess(submission.refund);
      setRefundRefreshWarning(submission.refreshWarning ?? "");
      setConfirmRefund(false);
      setRefundRequestKey(window.crypto.randomUUID());
      setRefundAmountInput("");
    } catch (submitError) {
      setRefundError(
        submitError instanceof Error ? submitError.message : "The refund request could not be completed.",
      );
    } finally {
      setRefundSubmitting(false);
    }
  }

  return (
    <DialogFrame title="Order details" subtitle={order?.order.reference ?? "Loading order"} onClose={onClose}>
      {loading ? <LoadingPanel /> : error ? <div className="admin-modal-error">{error}</div> : order ? (
        <div className="admin-order-detail">
          <div className="admin-order-detail-top">
            <div><span>Order status</span><StatusBadge status={order.order.status} /></div>
            <div><span>Payment status</span><StatusBadge status={order.order.paymentStatus} /></div>
            <div><span>Refund status</span><StatusBadge status={order.order.refundStatus} /></div>
          </div>
          <div className="admin-order-customer">
            <h3>Customer</h3>
            <strong>{order.customer.name}</strong>
            <a href={`mailto:${order.customer.email}`}>{order.customer.email}</a>
          </div>
          <div className="admin-order-products">
            <h3>Purchased products</h3>
            {order.items.map((item, index) => (
              <div className="admin-product-line" key={`${item.productId}-${index}`}>
                <img src={item.imageUrl} alt="" />
                <div><strong>{item.name}</strong><span>Qty {item.quantity} · {formatCurrency(item.unitPrice, item.currency)} each</span></div>
                <b>{formatCurrency(item.lineTotal, item.currency)}</b>
              </div>
            ))}
            <div className="admin-order-total"><span>Subtotal</span><strong>{formatCurrency(order.subtotal, order.currency)}</strong></div>
            <div className="admin-order-total"><span>Total</span><strong>{formatCurrency(order.total, order.currency)}</strong></div>
          </div>
          <div className="admin-order-dates"><span>Created {formatDate(order.createdAt)}</span><span>Updated {formatDate(order.updatedAt)}</span></div>
          <div className="admin-order-refund-summary">
            <span>Refunded to date</span>
            <strong>{formatCurrency(order.order.refundedAmount, order.currency)}</strong>
          </div>
          <div className="admin-order-payments">
            <h3>Payment attempts</h3>
            {order.payments.length ? order.payments.map((payment) => (
              <div className="admin-payment-attempt" key={payment.id}>
                <div>
                  <span>{payment.stripeCheckoutSessionId}</span>
                  <small>{payment.refundStatus.replaceAll("_", " ")} · {formatCurrency(payment.refundedAmount, payment.currency)} refunded</small>
                </div>
                <StatusBadge status={payment.status} />
              </div>
            )) : <p>No payment records are associated with this order.</p>}
          </div>
          <div className="admin-order-refunds">
            <h3>Refund history</h3>
            {order.refunds.length ? order.refunds.map((refund) => (
              <div className="admin-refund-history-row" key={refund.id}>
                <div>
                  <strong>{formatCurrency(refund.amount, refund.currency)}</strong>
                  <span>{refund.stripeRefundId ?? "Awaiting Stripe refund ID"} · {formatDate(refund.createdAt)}</span>
                  {refund.reason && <small>Reason: {refund.reason.replaceAll("_", " ")}</small>}
                  {refund.failureReason && <small className="admin-refund-failure">{refund.failureReason}</small>}
                </div>
                <StatusBadge status={refund.status} />
              </div>
            )) : <p>No refunds recorded.</p>}
          </div>
          <section className="admin-refund-box">
            <div className="admin-refund-box-heading">
              <span className="admin-refund-box-icon"><Undo2 size={16} /></span>
              <div><h3>Issue a Stripe refund</h3><p>Stripe is the source of truth for refund outcomes.</p></div>
            </div>
            {refundSuccess && (
              <div className="admin-refund-success" role="status">
                <span>Refund submitted: {formatCurrency(refundSuccess.amount, refundSuccess.currency)} · <StatusBadge status={refundSuccess.status} /></span>
              </div>
            )}
            {refundRefreshWarning && <div className="admin-inline-error" role="status">{refundRefreshWarning}</div>}
            {refundEligible && selectedPayment ? (
              <>
                {eligiblePayments.length > 1 && (
                  <label className="admin-refund-field">
                    Paid payment
                    <select value={selectedPayment.id} onChange={(event) => choosePayment(event.target.value)}>
                      {eligiblePayments.map((payment) => (
                        <option key={payment.id} value={payment.id}>
                          {payment.stripeCheckoutSessionId} · {formatCurrency(payment.remainingRefundableAmount, payment.currency)} remaining
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="admin-refund-balance">
                  <span>Remaining refundable balance</span>
                  <strong>{formatCurrency(selectedPayment.remainingRefundableAmount, selectedPayment.currency)}</strong>
                </div>
                <label className="admin-refund-field">
                  Refund amount ({selectedPayment.currency})
                  <input
                    inputMode="decimal"
                    value={refundAmountInput}
                    onChange={(event) => {
                      setRefundAmountInput(event.target.value);
                      setRefundRequestKey(window.crypto.randomUUID());
                      setConfirmRefund(false);
                      setRefundError("");
                      setRefundSuccess(null);
                      setRefundRefreshWarning("");
                    }}
                    aria-label={`Refund amount in ${selectedPayment.currency}`}
                  />
                </label>
                <button
                  type="button"
                  className="admin-refund-fill-button"
                  onClick={() => {
                    setRefundAmountInput(
                      amountToInput(selectedPayment.remainingRefundableAmount, selectedPayment.currency),
                    );
                    setRefundRequestKey(window.crypto.randomUUID());
                    setConfirmRefund(false);
                    setRefundError("");
                    setRefundSuccess(null);
                    setRefundRefreshWarning("");
                  }}
                >
                  Refund the remaining balance
                </button>
                <label className="admin-refund-field">
                  Stripe reason (optional)
                  <select
                    value={refundReason}
                    onChange={(event) => {
                      const reason = event.target.value;
                      setRefundReason(
                        reason === "duplicate" ||
                          reason === "fraudulent" ||
                          reason === "requested_by_customer"
                          ? reason
                          : "",
                      );
                      setRefundRequestKey(window.crypto.randomUUID());
                      setConfirmRefund(false);
                      setRefundError("");
                      setRefundSuccess(null);
                      setRefundRefreshWarning("");
                    }}
                  >
                    <option value="">No reason supplied</option>
                    <option value="requested_by_customer">Requested by customer</option>
                    <option value="duplicate">Duplicate</option>
                    <option value="fraudulent">Fraudulent</option>
                  </select>
                </label>
                {requestedAmount === null || requestedAmount <= 0 ? (
                  <p className="admin-refund-hint">Enter a positive amount using this currency’s decimal format.</p>
                ) : requestedAmount > selectedPayment.remainingRefundableAmount ? (
                  <p className="admin-refund-failure">Amount exceeds the remaining refundable balance.</p>
                ) : null}
                {!confirmRefund ? (
                  <button
                    className="admin-refund-review"
                    disabled={
                      requestedAmount === null ||
                      requestedAmount <= 0 ||
                      requestedAmount > selectedPayment.remainingRefundableAmount
                    }
                    onClick={() => setConfirmRefund(true)}
                  >
                    Review refund
                  </button>
                ) : (
                  <div className="admin-refund-confirm">
                    <strong>Confirm refund of {formatCurrency(requestedAmount ?? 0, selectedPayment.currency)}?</strong>
                    <span>
                      Remaining refundable balance after this request:{" "}
                      {formatCurrency(Math.max(0, remainingAfterRefund ?? 0), selectedPayment.currency)}.
                      Stripe may report the refund as pending while it is processed.
                    </span>
                    <div>
                      <button onClick={() => setConfirmRefund(false)} disabled={refundSubmitting}>Go back</button>
                      <button onClick={() => void submitConfirmedRefund()} disabled={refundSubmitting}>
                        {refundSubmitting ? "Submitting…" : "Confirm and refund"}
                      </button>
                    </div>
                  </div>
                )}
                {refundError && (
                  <div className="admin-inline-error" role="alert">
                    {refundError} If the request is still pending, retry without changing the amount or reason.
                  </div>
                )}
              </>
            ) : (
              <p className="admin-refund-ineligible">
                {order.order.status !== "paid"
                  ? "Refunds are available only for paid orders."
                  : order.order.refundStatus === "fully_refunded" || order.payments.some((payment) => payment.refundStatus === "fully_refunded")
                    ? "This payment has already been fully refunded."
                    : "No refundable paid payment balance is available."}
              </p>
            )}
          </section>
        </div>
      ) : null}
    </DialogFrame>
  );
}

function EventDialog({
  event,
  loading,
  error,
  onClose,
}: {
  event: AdminWebhookEvent | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <DialogFrame title="Webhook event" subtitle={event?.type ?? "Loading event metadata"} onClose={onClose}>
      {loading ? <LoadingPanel /> : error ? <div className="admin-modal-error">{error}</div> : event ? (
        <div className="admin-event-detail">
          <div className="admin-event-detail-note"><ShieldCheck size={17} /> Sensitive webhook payload data is not stored or shown.</div>
          <DetailFact label="Stripe event ID" value={event.eventId} code />
          <DetailFact label="Event type" value={event.type} />
          <DetailFact label="Processing status" value={<StatusBadge status={event.status} />} />
          <DetailFact label="Received" value={formatDate(event.createdAt)} />
          <DetailFact label="Processed" value={event.processedAt ? formatDate(event.processedAt) : "Not recorded"} />
          <div className="admin-event-detail-foot">This record contains receipt metadata only; it does not include the Stripe event payload.</div>
        </div>
      ) : null}
    </DialogFrame>
  );
}

function DetailFact({ label, value, code = false }: { label: string; value: ReactNode; code?: boolean }) {
  return <div className="admin-detail-fact"><span>{label}</span><strong className={code ? "admin-detail-code" : ""}>{value}</strong></div>;
}

function DialogFrame({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="admin-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="admin-dialog-header">
          <div><span>{title}</span><strong>{subtitle}</strong></div>
          <button className="admin-dialog-close" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </header>
        <div className="admin-dialog-body">{children}</div>
      </section>
    </div>
  );
}

function EmptyPanel({ title, copy }: { title: string; copy: string }) {
  return <div className="admin-empty-panel"><span><Users size={20} /></span><strong>{title}</strong><p>{copy}</p></div>;
}

export default AdminDashboard;
