import {
  IconArrowRight,
  IconChartLine,
  IconFlag,
  IconLayoutKanban,
  IconPencil,
  IconShieldCheck,
  IconTerminal,
  IconTerminal2
} from "@tabler/icons-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Triathlon",
  description:
    "Run your sprint board without Jira overhead. Realtime kanban, sprint planning, agile metrics, review gates, whiteboard, and an agent CLI."
};

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/home" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight text-[var(--foreground)]">Triathlon</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-[var(--muted-foreground)] md:flex">
          <a href="#board" className="transition-colors hover:text-[var(--foreground)]">Board</a>
          <a href="#sprints" className="transition-colors hover:text-[var(--foreground)]">Sprints</a>
          <a href="#metrics" className="transition-colors hover:text-[var(--foreground)]">Metrics</a>
          <a href="#automation" className="transition-colors hover:text-[var(--foreground)]">Automation</a>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/auth" className="btn btn-ghost btn-sm">
            Sign in
          </Link>
          <Link href="/auth?next=/dashboard" className="btn btn-primary btn-sm">
            Get started free
          </Link>
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] font-display text-sm font-bold text-[var(--accent-text)]">
      T
    </span>
  );
}

type MockTicketData = { title: string; points: number; active?: boolean };

function MockTicket({ title, points, active }: MockTicketData) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        active ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <p className="truncate text-[10px] font-medium leading-snug text-[var(--foreground)]">{title}</p>
      <p className={`tnum mt-0.5 text-[9px] ${active ? "text-[var(--accent-text)]" : "text-[var(--muted-foreground)]"}`}>
        {points} pts
      </p>
    </div>
  );
}

function MockBoard() {
  const columns: { name: string; tickets: MockTicketData[] }[] = [
    {
      name: "Backlog",
      tickets: [
        { title: "Export sprint report", points: 3 },
        { title: "Keyboard shortcuts", points: 5 },
        { title: "Migrate legacy tasks", points: 3 }
      ]
    },
    {
      name: "Todo",
      tickets: [
        { title: "Smoke test checklist", points: 2 },
        { title: "Agent audit trail", points: 5 },
        { title: "Dark mode polish", points: 3 }
      ]
    },
    {
      name: "In Progress",
      tickets: [
        { title: "Improve ticket editing", points: 3, active: true },
        { title: "Wire review gate", points: 3 }
      ]
    },
    {
      name: "Review",
      tickets: [{ title: "Whiteboard save flow", points: 8 }]
    },
    {
      name: "Done",
      tickets: [
        { title: "Sprint lifecycle", points: 5 },
        { title: "Burndown chart", points: 5 }
      ]
    }
  ];

  return (
    <div className="grid grid-cols-5 gap-2">
      {columns.map((column) => (
        <div
          key={column.name}
          className="flex min-h-[20rem] flex-col rounded-lg border border-[var(--border)] bg-[var(--background-alt)]/70 p-2"
        >
          <div className="flex items-center justify-between px-0.5 pb-2">
            <p className="text-[10px] font-semibold text-[var(--muted-foreground)]">{column.name}</p>
            <span className="tnum text-[10px] text-[var(--muted-foreground)]">{column.tickets.length}</span>
          </div>
          <div className="flex-1 space-y-1.5">
            {column.tickets.map((ticket) => (
              <MockTicket key={ticket.title} {...ticket} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
  points,
  variant
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  points: string[];
  variant?: "tint" | "paper";
}) {
  return (
    <article
      className={`flex flex-col rounded-2xl border p-6 ${
        variant === "tint"
          ? "border-[var(--accent)]/25 bg-[var(--accent-soft)]"
          : variant === "paper"
            ? "border-[var(--border)] bg-[var(--background-alt)]/60"
            : "border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]"
      }`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--accent-text)] shadow-[var(--shadow-sm)]">
        {icon}
      </span>
      <h3 className="mt-4 text-base font-semibold tracking-tight text-[var(--foreground)]">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">{description}</p>
      <ul className="mt-4 space-y-1.5">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-[13px] text-[var(--foreground)]">
            <span className="mt-[3px] text-[var(--accent)]">
              <IconArrowRight size={13} />
            </span>
            {point}
          </li>
        ))}
      </ul>
    </article>
  );
}

function WorkflowStrip() {
  const steps = ["Backlog", "Todo", "In Progress", "Review", "Done"];
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background-alt)]/60 p-5">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => (
          <div key={step} className="flex items-center gap-2">
            <span
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                step === "Review"
                  ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-text)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
              }`}
            >
              {step}
            </span>
            {index < steps.length - 1 ? (
              <IconArrowRight size={14} className="text-[var(--muted-foreground)]" />
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-[var(--muted-foreground)]">
        The <span className="font-semibold text-[var(--foreground)]">Review</span> step is a hard gate: tickets must be
        requested, reviewed, and approved before they can move to Done. Enforced server-side, not just in the UI.
      </p>
    </div>
  );
}

function MetricStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      <p className="text-xs font-medium text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1.5 text-lg font-semibold tracking-tight text-[var(--foreground)]">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{note}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <Header />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="inline-flex items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent-text)]">
                Lightweight Trello + Jira alternative
              </p>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-[var(--foreground)] sm:text-5xl">
                Run your sprint board without the overhead.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--muted-foreground)]">
                Plan tasks, drag tickets across a realtime kanban board, and get velocity, burndown, and cycle time
                automatically.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/auth?next=/dashboard" className="btn btn-primary btn-lg">
                  Get started free
                  <IconArrowRight size={16} />
                </Link>
                <Link href="/auth" className="btn btn-secondary btn-lg">
                  Sign in
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-md)]">
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="text-xs font-semibold text-[var(--foreground)]">Sprint 2 · live board</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ok-text)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                  realtime
                </span>
              </div>
              <MockBoard />
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="board" className="border-t border-[var(--border)] bg-[var(--background-alt)]/40 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-[var(--foreground)]">
              Everything a small team needs. Nothing it doesn't.
            </h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted-foreground)]">
              Six focused tools that work together, with the review gate enforced on the server for every path into
              Done.
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-12">
              <div className="md:col-span-7">
                <Feature
                  variant="tint"
                  icon={<IconLayoutKanban size={19} />}
                  title="Realtime kanban"
                  description="Drag tickets across Backlog, Todo, In Progress, Review, and Done. Every move syncs instantly to the whole team."
                  points={["Drag-and-drop with keyboard support", "Priority and story points per ticket", "Full movement audit trail"]}
                />
              </div>
              <div className="md:col-span-5">
                <Feature
                  icon={<IconFlag size={19} />}
                  title="Sprint planning"
                  description="Create, activate, and complete sprints. Keep one sprint active at a time."
                  points={["Date-bounded sprint lifecycle", "Backlog to sprint attachment", "Active / planned / archived states"]}
                />
              </div>
              <div className="md:col-span-5">
                <Feature
                  variant="paper"
                  icon={<IconShieldCheck size={19} />}
                  title="Review gates"
                  description="Done is protected. Tickets must be requested, reviewed, and approved before they can be completed."
                  points={["Request / approve / reject workflow", "Enforced on the server, not just UI"]}
                />
              </div>
              <div className="md:col-span-7">
                <Feature
                  icon={<IconChartLine size={19} />}
                  title="Agile metrics"
                  description="Burndown, velocity, throughput, and cycle time are computed from real ticket movement, not manual timesheets."
                  points={["Velocity history across sprints", "Per-sprint burndown chart", "Cycle time from In Progress to Done"]}
                />
              </div>
              <div className="md:col-span-4">
                <Feature
                  icon={<IconPencil size={19} />}
                  title="Project whiteboard"
                  description="An Excalidraw whiteboard per project, autosaved locally with a shared board library."
                  points={["Shared board library", "Dark and light canvas themes"]}
                />
              </div>
              <div className="md:col-span-8">
                <Feature
                  icon={<IconTerminal size={19} />}
                  title="Agent gateway and CLI"
                  description="Automate the board from scripts or AI agents with a scoped HTTP API plus the tri CLI for humans and machines."
                  points={["Server-to-server API with scoped keys", "tri CLI: tickets, sprints, metrics", "Full audit log of agent requests"]}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
                Five columns for one honest pipeline.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
                New work lands in Backlog. It moves through the line, hits Review for a human check, and only then
                lands in Done.
              </p>
            </div>
            <WorkflowStrip />
          </div>
        </section>

        {/* Metrics band */}
        <section id="metrics" className="border-t border-[var(--border)] bg-[var(--background-alt)]/40 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
              Metrics your team can actually trust.
            </h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">Computed from real ticket movement, not guesses.</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricStat label="Velocity" value="Points per sprint" note="Forecast from completed story points." />
              <MetricStat label="Burndown" value="Day by day" note="Remaining points tracked against sprint scope." />
              <MetricStat label="Cycle time" value="In Progress to Done" note="How long work actually takes to ship." />
              <MetricStat label="Lead time" value="Created to Done" note="Full time in the system, including review." />
            </div>
          </div>
        </section>

        {/* Automation */}
        <section id="automation" className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
                Drive the board from a terminal or an agent.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
                The tri CLI wraps the same agent gateway the backend exposes. Create tickets, move work, run reviews,
                and pull metrics: from a script, a cron job, or an AI agent.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[var(--foreground)]">
                <li className="flex items-center gap-2.5">
                  <IconTerminal2 size={16} className="text-[var(--accent-text)]" />
                  Project-scoped API keys
                </li>
                <li className="flex items-center gap-2.5">
                  <IconTerminal2 size={16} className="text-[var(--accent-text)]" />
                  Full audit trail of every agent request
                </li>
                <li className="flex items-center gap-2.5">
                  <IconTerminal2 size={16} className="text-[var(--accent-text)]" />
                  The same review gates apply to API calls
                </li>
              </ul>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-md)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
                <p className="font-mono text-xs text-[var(--muted-foreground)]">tri CLI</p>
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--warn)]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--ok)]" />
                </div>
              </div>
              <pre className="thin-scroll overflow-x-auto p-5 font-mono text-xs leading-relaxed text-[var(--foreground)]">
{`$ tri tickets create \\
    --title "Investigate dashboard flow" \\
    --column-name Backlog --points 2 --priority high

$ tri sprints activate --id sprint_1

$ tri tickets move --id ticket_42 --to-column-name "In Progress"

$ tri metrics velocity

$ tri board snapshot --json`}
              </pre>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-[var(--border)] px-6 py-20">
          <div className="panel mx-auto max-w-4xl p-8 text-center sm:p-12">
            <p className="mx-auto inline-flex items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent-text)]">
              Student teams · small teams · anyone tired of Jira
            </p>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-[var(--foreground)] sm:text-4xl">
              Start your next sprint, and run a Triathlon.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)]">
              Sign in, create a project, and the board, columns, and metrics are ready to go.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/auth?next=/dashboard" className="btn btn-primary btn-lg">
                Get started free
                <IconArrowRight size={16} />
              </Link>
              <Link href="/auth" className="btn btn-secondary btn-lg">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)] bg-[var(--background-alt)]/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-sm font-semibold tracking-tight text-[var(--foreground)]">Triathlon</span>
          </div>
          <nav className="flex items-center gap-6 text-sm font-medium text-[var(--muted-foreground)]">
            <a href="#board" className="transition-colors hover:text-[var(--foreground)]">Board</a>
            <a href="#metrics" className="transition-colors hover:text-[var(--foreground)]">Metrics</a>
            <a href="#automation" className="transition-colors hover:text-[var(--foreground)]">Automation</a>
            <Link href="/auth" className="transition-colors hover:text-[var(--foreground)]">Sign in</Link>
          </nav>
          <p className="text-xs text-[var(--muted-foreground)]">MIT licensed · built with Vinext, Convex & Better Auth</p>
        </div>
      </footer>
    </>
  );
}