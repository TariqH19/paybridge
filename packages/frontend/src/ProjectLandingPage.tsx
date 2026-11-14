import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CreditCard,
  Database,
  ShieldCheck,
  ShoppingBag,
  Webhook,
} from "lucide-react";

const capabilities = [
  {
    icon: ShoppingBag,
    title: "Commerce lifecycle",
    description: "Live catalogue data, browser cart, validated orders, and immutable purchase snapshots.",
  },
  {
    icon: CreditCard,
    title: "Stripe sandbox",
    description: "Hosted Stripe Checkout in test mode. The server owns pricing and payment references.",
  },
  {
    icon: Webhook,
    title: "Webhook reconciliation",
    description: "Signed raw-body events update payment and order state with duplicate-event protection.",
  },
  {
    icon: Activity,
    title: "Idempotent operations",
    description: "Checkout attempts, refunds, and webhook processing account for retries and asynchronous outcomes.",
  },
  {
    icon: ShieldCheck,
    title: "Refund management",
    description: "Protected admin actions support full and partial refunds with a persisted audit trail.",
  },
  {
    icon: Activity,
    title: "Protected admin workspace",
    description: "Review orders, payments, webhook events, and refund outcomes from one operations dashboard.",
  },
  {
    icon: BarChart3,
    title: "Operational analytics",
    description: "MongoDB aggregations report revenue, order health, products, and refunds by currency.",
  },
];

export default function ProjectLandingPage() {
  return (
    <div className="project-site">
      <header className="project-header">
        <a className="project-brand" href="/" aria-label="PayBridge project overview">
          <span className="project-brand-mark">p.</span>
          <span>PayBridge<span className="project-brand-period">.</span></span>
        </a>
        <nav className="project-nav" aria-label="Project navigation">
          <a href="#capabilities">Capabilities</a>
          <a href="#architecture">Architecture</a>
          <a href="#technology">Technology</a>
        </nav>
        <div className="project-header-actions">
          <a className="project-admin-link" href="/admin">Admin</a>
          <a className="project-shop-link" href="/shop">
            Explore storefront <ArrowUpRight size={15} />
          </a>
        </div>
      </header>

      <main>
        <section className="project-hero">
          <div className="project-hero-copy">
            <div className="project-kicker"><span /> COMMERCE SYSTEMS · PORTFOLIO PROJECT</div>
            <h1>Payments are a workflow,<br /><span>not a button.</span></h1>
            <p className="project-hero-description">
              PayBridge is a simulated commerce and payment integration platform built to show
              how orders, external payment events, and operational data stay in sync.
            </p>
            <div className="project-hero-actions">
              <a className="project-primary-button" href="/shop">
                Explore the storefront <ArrowRight size={16} />
              </a>
              <a className="project-secondary-button" href="/admin">
                Open admin dashboard <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="project-sandbox-note">
              <ShieldCheck size={16} />
              <span><strong>Sandbox only.</strong> Stripe test mode; no live payments are accepted.</span>
            </div>
          </div>
          <div className="project-hero-visual" aria-label="PayBridge system overview">
            <div className="project-visual-topline">
              <span>PAYBRIDGE / SYSTEM MAP</span>
              <span className="project-live-chip"><i /> EVENT-DRIVEN</span>
            </div>
            <div className="project-flow">
              <div className="project-flow-node project-flow-browser">
                <span className="project-node-icon"><ShoppingBag size={18} /></span>
                <span><strong>Commerce UI</strong><small>React · Vite</small></span>
              </div>
              <div className="project-flow-line"><span>REST · /api</span><i /></div>
              <div className="project-flow-node project-flow-api">
                <span className="project-node-icon"><Activity size={18} /></span>
                <span><strong>PayBridge API</strong><small>Express · Node.js</small></span>
              </div>
              <div className="project-flow-branches">
                <div className="project-flow-branch">
                  <i />
                  <div className="project-flow-node project-flow-db">
                    <span className="project-node-icon"><Database size={18} /></span>
                    <span><strong>MongoDB Atlas</strong><small>Orders · payments · events</small></span>
                  </div>
                </div>
                <div className="project-flow-branch">
                  <i />
                  <div className="project-flow-node project-flow-stripe">
                    <span className="project-node-icon"><CreditCard size={18} /></span>
                    <span><strong>Stripe Checkout</strong><small>Test mode · signed webhooks</small></span>
                  </div>
                </div>
              </div>
              <div className="project-flow-return">
                <Webhook size={14} />
                <span>Verified events reconcile payment state</span>
                <ArrowRight size={14} />
              </div>
            </div>
            <div className="project-visual-footer">
              <span>ONE MERCHANT · CURRENCY-AWARE · AUDITABLE</span>
              <span>01 — 04</span>
            </div>
          </div>
          <a className="project-scroll-cue" href="#capabilities">SCROLL TO EXPLORE <span>↓</span></a>
        </section>

        <section className="project-context-strip" aria-label="Project focus">
          <div><span>01</span><strong>Commerce state</strong><small>Orders and snapshots</small></div>
          <div><span>02</span><strong>External outcomes</strong><small>Stripe and webhooks</small></div>
          <div><span>03</span><strong>Operational visibility</strong><small>Refunds and analytics</small></div>
        </section>

        <section className="project-section project-capabilities" id="capabilities">
          <div className="project-section-heading">
            <div>
              <div className="project-kicker"><span /> WHAT THE SYSTEM DEMONSTRATES</div>
              <h2>Built around the<br />whole payment lifecycle.</h2>
            </div>
            <p>
              A compact, single-merchant application focused on the parts that need careful
              coordination—not just collecting card details.
            </p>
          </div>
          <div className="project-capability-grid">
            {capabilities.map(({ icon: Icon, title, description }, index) => (
              <article className="project-capability-card" key={title}>
                <div className="project-capability-top">
                  <span className="project-capability-icon"><Icon size={18} /></span>
                  <span>0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="project-architecture" id="architecture">
          <div className="project-architecture-copy">
            <div className="project-kicker"><span /> ARCHITECTURE AT A GLANCE</div>
            <h2>Keep each system<br />responsible for its truth.</h2>
            <p>
              The API calculates and persists order state. Stripe hosts checkout and reports
              outcomes asynchronously. MongoDB Atlas stores the application records and supports
              operational views through indexed queries and aggregations.
            </p>
            <a className="project-text-link" href="/shop">
              Walk through the customer flow <ArrowRight size={15} />
            </a>
          </div>
          <div className="project-architecture-list">
            <div><span className="project-architecture-number">01</span><span><strong>React + Vite</strong><small>Storefront, cart, payment returns, protected admin UI</small></span></div>
            <div><span className="project-architecture-number">02</span><span><strong>Express API</strong><small>Orders, Stripe operations, webhook verification, admin APIs</small></span></div>
            <div><span className="project-architecture-number">03</span><span><strong>MongoDB Atlas</strong><small>paybridge database, document model, indexes, analytics pipelines</small></span></div>
            <div><span className="project-architecture-number">04</span><span><strong>Stripe test mode</strong><small>Hosted Checkout and signed payment/refund event delivery</small></span></div>
          </div>
        </section>

        <section className="project-technology" id="technology">
          <div>
            <div className="project-kicker"><span /> TECHNOLOGY</div>
            <h2>Purposeful building blocks.</h2>
          </div>
          <div className="project-tech-list">
            <span>React</span><span>TypeScript</span><span>Vite</span><span>Tailwind CSS</span>
            <span>Node.js</span><span>Express 5</span><span>MongoDB Atlas</span><span>Stripe SDK</span>
          </div>
        </section>
      </main>

      <footer className="project-footer">
        <a className="project-brand" href="/">
          <span className="project-brand-mark">p.</span><span>PayBridge<span className="project-brand-period">.</span></span>
        </a>
        <span>Commerce integration, modeled end to end.</span>
        <div><a href="/shop">Storefront</a><a href="/admin">Admin dashboard</a></div>
      </footer>
    </div>
  );
}
