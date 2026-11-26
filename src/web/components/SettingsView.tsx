import { useState } from "react";
import type { ColumnConfig, ProjectSnapshot } from "../../core/types.js";
import { api, copyText } from "../lib/api.js";

interface SettingsViewProps {
  snapshot: ProjectSnapshot;
  onRefresh: () => Promise<void>;
  onUnregister: () => Promise<void>;
}

export function SettingsView({ snapshot, onRefresh, onUnregister }: SettingsViewProps) {
  const [name, setName] = useState(snapshot.config.name);
  const [owner, setOwner] = useState(snapshot.config.owner);
  const [reviewGate, setReviewGate] = useState(snapshot.config.reviewGate);
  const [columns, setColumns] = useState<ColumnConfig[]>(snapshot.config.columns);
  const [saved, setSaved] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        triathlon: {
          command: "tri",
          args: ["mcp", "--project", snapshot.path],
        },
      },
    },
    null,
    2,
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.updateConfig(snapshot.projectId, { name, owner, reviewGate, columns });
    await onRefresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b px-4 pt-3.5 pb-3 md:px-8 md:pt-5 md:pb-4" style={{ borderColor: "var(--border)" }}>
        <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
          {snapshot.config.name}
        </div>
        <h1 className="m-0 text-[22px] font-bold tracking-tight md:text-[24px]">Settings</h1>
      </header>

      <div className="max-w-[700px] px-4 py-5 md:px-8 md:py-6">
        <form onSubmit={handleSave} className="divide-y" style={{ borderColor: "var(--border)" }}>
          <section className="pb-6">
            <div className="eyebrow mb-4">Project</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[13px]"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>
                  Owner display name
                </label>
                <input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[13px]"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-3 text-[13px]">
              <input
                type="checkbox"
                checked={reviewGate}
                onChange={(e) => setReviewGate(e.target.checked)}
              />
              <span>
                <strong>Review gate:</strong> require human approval before agents can move tickets to Done
              </span>
            </label>
          </section>

          <section className="py-6" style={{ borderColor: "var(--border)" }}>
            <div className="eyebrow mb-4">Columns &amp; WIP limits</div>
            <div className="flex flex-col gap-2.5">
              {columns.map((col, idx) => (
                <div key={col.id} className="grid grid-cols-[1fr_110px_100px] items-center gap-3 text-[13px]">
                  <input
                    value={col.name}
                    onChange={(e) => {
                      const next = [...columns];
                      next[idx] = { ...col, name: e.target.value };
                      setColumns(next);
                    }}
                    className="rounded-md border px-3 py-1.5"
                    style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                  />
                  <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                    {col.category}
                  </span>
                  <input
                    type="number"
                    min={1}
                    placeholder="No limit"
                    value={col.wipLimit ?? ""}
                    onChange={(e) => {
                      const next = [...columns];
                      const val = e.target.value.trim();
                      next[idx] = { ...col, wipLimit: val === "" ? null : Math.max(1, Number(val)) };
                      setColumns(next);
                    }}
                    className="rounded-md border px-2.5 py-1.5 tabular-nums"
                    style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                  />
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="submit"
                className="rounded-md px-4 py-2 text-[13px] font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Save settings
              </button>
              {saved && (
                <span className="text-[12px]" style={{ color: "var(--done)" }}>
                  Saved to .triathlon/config.yaml
                </span>
              )}
            </div>
          </section>

          <section className="py-6" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 flex items-center justify-between">
              <div className="eyebrow">MCP server configuration</div>
              <button
                type="button"
                onClick={async () => {
                  await copyText(mcpSnippet);
                  setCopiedMcp(true);
                  setTimeout(() => setCopiedMcp(false), 1800);
                }}
                className="text-[12px] font-medium hover:underline"
                style={{ color: "var(--ink-2)" }}
              >
                {copiedMcp ? "Copied" : "Copy JSON"}
              </button>
            </div>
            <pre
              className="overflow-x-auto rounded-md border p-3.5 font-mono text-[12px]"
              style={{ background: "var(--bg-card)", borderColor: "var(--border)", color: "var(--ink)" }}
            >
              {mcpSnippet}
            </pre>
          </section>

          <section className="py-6" style={{ borderColor: "var(--border)" }}>
            <div className="eyebrow mb-2">Workspace</div>
            <p className="mt-0 mb-3 text-[12px]" style={{ color: "var(--ink-3)" }}>
              Removing this project from the hub keeps all files inside <code>{snapshot.path}/.triathlon</code> intact.
            </p>
            <button
              type="button"
              onClick={onUnregister}
              className="rounded-md border px-3 py-1.5 text-[12px] font-medium"
              style={{ borderColor: "var(--border-strong)", color: "var(--accent)" }}
            >
              Remove from hub
            </button>
          </section>
        </form>
      </div>
    </div>
  );
}
