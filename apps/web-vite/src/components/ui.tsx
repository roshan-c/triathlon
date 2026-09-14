import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Ticket } from "../types";
import { initials } from "../lib/format";

export function ActionButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`action-button ${className}`} {...props} />;
}

export function StatusChip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "active" | "blocked" | "done" }) {
  return <span className={`status-chip status-${tone}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function LoadingBlock({ label = "Loading workspace…" }: { label?: string }) {
  return <div className="state-block loading-state"><span className="pulse-dot" />{label}</div>;
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block error-state" role="alert">
      <span>{message}</span>
      {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function EmptyBlock({ children }: { children: ReactNode }) {
  return <div className="state-block empty-state">{children}</div>;
}

export function TicketRow({ ticket, status, tone = "neutral", selectable = false, selected = false, onSelect }: {
  ticket: Ticket;
  status: string;
  tone?: "neutral" | "active" | "blocked" | "done";
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <span className="ticket-number">#{ticket.number}</span>
      <span className="ticket-copy"><strong>{ticket.title}</strong><small>{ticket.assigneeId || "Unassigned"} · {ticket.priority || "medium"} priority</small></span>
      <span className="ticket-status"><StatusChip tone={tone}>{status}</StatusChip></span>
      <span className="ticket-points">{ticket.points ?? 0} PTS</span>
      <span className="ticket-assignee">{initials(ticket.assigneeId)}</span>
    </>
  );
  return selectable ? (
    <button type="button" className={`ticket-row selectable ${selected ? "ticket-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>{content}</button>
  ) : <article className="ticket-row">{content}</article>;
}
