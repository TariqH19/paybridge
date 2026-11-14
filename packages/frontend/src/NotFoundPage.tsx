import { ArrowLeft, ArrowRight, CircleHelp } from "lucide-react";

export default function NotFoundPage() {
  return (
    <main className="not-found-page">
      <a className="project-brand not-found-brand" href="/">
        <span className="project-brand-mark">p.</span>
        <span>PayBridge<span className="project-brand-period">.</span></span>
      </a>
      <section className="not-found-card">
        <span className="not-found-icon"><CircleHelp size={24} /></span>
        <div className="project-kicker"><span /> PAGE NOT FOUND</div>
        <h1>This route doesn’t exist.</h1>
        <p>That address isn’t part of the PayBridge application. Choose a destination to continue.</p>
        <div className="not-found-actions">
          <a className="project-primary-button" href="/">
            Project overview <ArrowLeft size={15} />
          </a>
          <a className="project-secondary-button" href="/shop">
            Visit storefront <ArrowRight size={15} />
          </a>
        </div>
      </section>
    </main>
  );
}
