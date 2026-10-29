import type { ReactNode } from "react";

export function Panel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-panel">
      <div className="ui-panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="ui-panel-body">{children}</div>
    </section>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ui-badge">{children}</span>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
        {action && <div className="ui-empty-action">{action}</div>}
      </div>
    </div>
  );
}

export function WorkspaceLoading() {
  return (
    <main className="crm-loading-shell" aria-label="Загружаем рабочее пространство">
      <aside aria-hidden>
        <span className="crm-skeleton crm-skeleton-logo" />
        {Array.from({ length: 6 }, (_, index) => <span className="crm-skeleton crm-skeleton-nav" key={index} />)}
      </aside>
      <section aria-hidden>
        <span className="crm-skeleton crm-skeleton-title" />
        <div className="crm-skeleton-metrics">
          {Array.from({ length: 3 }, (_, index) => <span className="crm-skeleton" key={index} />)}
        </div>
        <span className="crm-skeleton crm-skeleton-panel" />
      </section>
      <span className="sr-only">Загружаем OptiAI CRM...</span>
    </main>
  );
}
