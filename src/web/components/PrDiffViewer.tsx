import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import { FileDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons.js";

const DIFF_POOL_OPTIONS = {
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
      type: "module",
    }),
  poolSize: 2,
};

const DIFF_HIGHLIGHTER_OPTIONS = {
  theme: {
    light: "pierre-light",
    dark: "pierre-dark",
  },
};

function fileStats(file: FileDiffMetadata): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const block of hunk.hunkContent) {
      if (block.type === "change") {
        added += block.additions;
        removed += block.deletions;
      }
    }
  }
  return { added, removed };
}

function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setTheme(el.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return theme;
}

interface PrDiffViewerProps {
  patch: string;
  source?: "pr" | "git" | null;
  prNumber?: number;
}

export function PrDiffViewer({ patch, source, prNumber }: PrDiffViewerProps) {
  const themeType = useDocumentTheme();
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">(() =>
    typeof window !== "undefined" && window.innerWidth >= 1100 ? "split" : "unified",
  );

  const files = useMemo(() => {
    if (!patch.trim()) return [];
    try {
      return parsePatchFiles(patch).flatMap((p) => p.files);
    } catch {
      return [];
    }
  }, [patch]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Reset collapse state when a new patch arrives: expand all if <= 5 files, else expand first 2
  useEffect(() => {
    const next: Record<string, boolean> = {};
    files.forEach((f, idx) => {
      const key = `${f.name}:${idx}`;
      next[key] = files.length > 5 && idx >= 2;
    });
    setCollapsed(next);
  }, [files]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const f of files) {
      const s = fileStats(f);
      added += s.added;
      removed += s.removed;
    }
    return { added, removed };
  }, [files]);

  if (!files.length) {
    return (
      <div className="py-3 text-[12px]" style={{ color: "var(--ink-3)" }}>
        No file changes in diff.
      </div>
    );
  }

  const allCollapsed = files.every((f, idx) => collapsed[`${f.name}:${idx}`]);

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    files.forEach((f, idx) => {
      next[`${f.name}:${idx}`] = !allCollapsed;
    });
    setCollapsed(next);
  };

  return (
    <WorkerPoolContextProvider poolOptions={DIFF_POOL_OPTIONS} highlighterOptions={DIFF_HIGHLIGHTER_OPTIONS}>
      <div className="flex flex-col gap-3">
        {/* Editorial toolbar */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5 text-[12px]"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2.5 tabular-nums" style={{ color: "var(--ink-2)" }}>
            <span>
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
            <span style={{ color: "var(--done)" }}>+{totals.added}</span>
            <span style={{ color: "var(--accent)" }}>−{totals.removed}</span>
            {source && (
              <span style={{ color: "var(--ink-3)" }}>
                · {source === "pr" && prNumber ? `PR #${prNumber}` : "local branch diff"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1 md:flex">
              <button
                type="button"
                onClick={() => setDiffStyle("unified")}
                className="px-1.5 py-0.5 text-[12px]"
                style={{
                  color: diffStyle === "unified" ? "var(--ink)" : "var(--ink-3)",
                  fontWeight: diffStyle === "unified" ? 600 : 400,
                }}
              >
                Unified
              </button>
              <span style={{ color: "var(--border-input)" }}>/</span>
              <button
                type="button"
                onClick={() => setDiffStyle("split")}
                className="px-1.5 py-0.5 text-[12px]"
                style={{
                  color: diffStyle === "split" ? "var(--ink)" : "var(--ink-3)",
                  fontWeight: diffStyle === "split" ? 600 : 400,
                }}
              >
                Split
              </button>
            </div>
            <button
              type="button"
              onClick={toggleAll}
              className="text-[12px] hover:underline"
              style={{ color: "var(--ink-3)" }}
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          </div>
        </div>

        {/* File diff cards */}
        <div className="flex flex-col gap-3">
          {files.map((file, idx) => {
            const key = `${file.name}:${idx}`;
            const isCollapsed = Boolean(collapsed[key]);
            const stats = fileStats(file);
            return (
              <div
                key={key}
                className="overflow-hidden rounded-lg border"
                style={{ borderColor: "var(--border)", background: "var(--bg-paper)" }}
              >
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
                  className="flex min-h-[40px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px]"
                  style={{
                    borderBottom: isCollapsed ? "none" : "1px solid var(--border)",
                    color: "var(--ink)",
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span style={{ color: "var(--ink-3)" }}>
                      {isCollapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
                    </span>
                    <span className="truncate font-mono font-medium">
                      {file.prevName && file.prevName !== file.name ? `${file.prevName} → ${file.name}` : file.name}
                    </span>
                    {file.type === "new" && (
                      <span className="shrink-0 text-[11px]" style={{ color: "var(--done)" }}>
                        new
                      </span>
                    )}
                    {file.type === "deleted" && (
                      <span className="shrink-0 text-[11px]" style={{ color: "var(--accent)" }}>
                        deleted
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums text-[11px]">
                    {stats.added > 0 && <span style={{ color: "var(--done)" }}>+{stats.added}</span>}
                    {stats.removed > 0 && <span style={{ color: "var(--accent)" }}>−{stats.removed}</span>}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="w-full overflow-x-auto text-[12px]">
                    <FileDiff
                      fileDiff={file}
                      options={{
                        diffStyle,
                        themeType,
                        disableFileHeader: true,
                        overflow: "scroll",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </WorkerPoolContextProvider>
  );
}
