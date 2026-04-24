"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { useAppContext } from "@/components/app-context";
import { useTheme } from "@/components/theme-provider";
import { cvx } from "@/lib/convex";

type SaveState = "loading" | "idle" | "saving" | "saved" | "error";
type LibrarySaveState = "idle" | "saving" | "saved" | "error";

type ExcalidrawInitialDataState = {
  elements?: readonly unknown[];
  appState?: Record<string, unknown> | null;
  files?: Record<string, unknown>;
};

type SceneSnapshot = Pick<ExcalidrawInitialDataState, "elements" | "appState" | "files">;

type LibraryItem = {
  itemId: string;
  title: string;
  snapshotUrl: string | null;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  creatorName: string;
};

function isExcalidrawSnapshot(value: unknown): value is ExcalidrawInitialDataState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { elements?: unknown };
  return Array.isArray(candidate.elements);
}

function serializeSnapshot(snapshot: SceneSnapshot): string {
  return JSON.stringify(snapshot);
}

function normalizeSnapshot(value: unknown): SceneSnapshot | null {
  if (!isExcalidrawSnapshot(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const files = candidate.files;

  return {
    elements: candidate.elements as readonly unknown[],
    appState: null,
    files: files && typeof files === "object" ? (files as Record<string, unknown>) : undefined
  };
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}

export default function WhiteboardPage() {
  const { externalId, project } = useAppContext();
  const { theme } = useTheme();

  const getUploadUrl = useMutation(cvx.whiteboards.getUploadUrl);
  const saveToLibrary = useMutation(cvx.whiteboards.saveToLibrary);

  const libraryItems = useQuery(cvx.whiteboards.listLibrary, {
    projectId: project.projectId,
    externalId
  }) as LibraryItem[] | undefined;

  const [ExcalidrawComponent, setExcalidrawComponent] = useState<any>(null);
  const [canvasLoadError, setCanvasLoadError] = useState("");
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const [compatNotice, setCompatNotice] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [librarySaveState, setLibrarySaveState] = useState<LibrarySaveState>("idle");
  const [libraryTitle, setLibraryTitle] = useState("");
  const [libraryMessage, setLibraryMessage] = useState("");
  const [activeLibraryItemId, setActiveLibraryItemId] = useState("");

  const serializedSnapshotRef = useRef<string | null>(null);
  const persistedSnapshotRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const suspendAutosaveRef = useRef(false);

  const localStorageKey = useMemo(
    () => `tri-whiteboard:${project.projectId}:${externalId}`,
    [externalId, project.projectId]
  );

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const persistSnapshot = useCallback(
    (serialized: string | null) => {
      if (serialized !== null && serialized === persistedSnapshotRef.current) {
        setSaveState("saved");
        return true;
      }

      try {
        if (serialized === null) {
          window.localStorage.removeItem(localStorageKey);
        } else {
          window.localStorage.setItem(localStorageKey, serialized);
        }

        persistedSnapshotRef.current = serialized;
        setSaveState("saved");
        return true;
      } catch {
        setSaveState("error");
        return false;
      }
    },
    [localStorageKey]
  );

  const flushPendingSave = useCallback(() => {
    clearSaveTimer();

    if (serializedSnapshotRef.current === null) {
      return;
    }

    if (serializedSnapshotRef.current !== persistedSnapshotRef.current) {
      setSaveState("saving");
    }

    persistSnapshot(serializedSnapshotRef.current);
  }, [clearSaveTimer, persistSnapshot]);

  const loadSnapshotAsLocalCopy = useCallback(
    async (serialized: string) => {
      const parsed = JSON.parse(serialized);
      const normalized = normalizeSnapshot(parsed);
      if (!normalized) {
        throw new Error("Snapshot is not a valid Excalidraw scene.");
      }

      const normalizedSerialized = serializeSnapshot(normalized);
      serializedSnapshotRef.current = normalizedSerialized;
      if (!persistSnapshot(normalizedSerialized)) {
        throw new Error("Could not persist imported whiteboard locally.");
      }

      setInitialData(normalized);
      setCanvasKey((value) => value + 1);
      setCompatNotice("");
    },
    [persistSnapshot]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const module = await import("@excalidraw/excalidraw");
        if (!cancelled) {
          if (!module.Excalidraw) {
            throw new Error("Excalidraw export missing");
          }
          setExcalidrawComponent(() => module.Excalidraw);
        }
      } catch {
        if (!cancelled) {
          setCanvasLoadError("Could not load Excalidraw editor.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    clearSaveTimer();
    setCanvasReady(false);
    setCompatNotice("");
    suspendAutosaveRef.current = true;

    try {
      const raw = window.localStorage.getItem(localStorageKey);

      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = normalizeSnapshot(parsed);
        if (normalized) {
          const normalizedSerialized = serializeSnapshot(normalized);
          setInitialData(normalized);
          serializedSnapshotRef.current = normalizedSerialized;
          persistedSnapshotRef.current = normalizedSerialized;
          if (normalizedSerialized !== raw) {
            window.localStorage.setItem(localStorageKey, normalizedSerialized);
          }
        } else {
          window.localStorage.removeItem(localStorageKey);
          serializedSnapshotRef.current = null;
          persistedSnapshotRef.current = null;
          setInitialData(null);
          setCompatNotice("Previous whiteboard data format was cleared after switching from tldraw to Excalidraw.");
        }
      } else {
        serializedSnapshotRef.current = null;
        persistedSnapshotRef.current = null;
        setInitialData(null);
      }

      setSaveState("saved");
    } catch {
      window.localStorage.removeItem(localStorageKey);
      serializedSnapshotRef.current = null;
      persistedSnapshotRef.current = null;
      setInitialData(null);
      setSaveState("error");
    } finally {
      setCanvasKey((value) => value + 1);
      setCanvasReady(true);
    }
  }, [clearSaveTimer, localStorageKey]);

  useEffect(() => {
    if (!canvasReady) {
      return;
    }

    const unlockAutosave = window.setTimeout(() => {
      suspendAutosaveRef.current = false;
    }, 0);

    return () => {
      window.clearTimeout(unlockAutosave);
    };
  }, [canvasKey, canvasReady]);

  useEffect(() => {
    const handlePageHide = () => {
      flushPendingSave();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingSave();
    };
  }, [flushPendingSave]);

  const handleChange = useCallback(
    (elements: readonly any[], _appState: any, files: Record<string, unknown>) => {
      if (!canvasReady || suspendAutosaveRef.current) {
        return;
      }

      let serialized = "";
      try {
        serialized = serializeSnapshot({ elements, appState: null, files });
      } catch {
        setSaveState("error");
        return;
      }

      serializedSnapshotRef.current = serialized;

      clearSaveTimer();

      if (serialized === persistedSnapshotRef.current) {
        setSaveState("saved");
        return;
      }

      setSaveState("idle");

      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        setSaveState("saving");
        persistSnapshot(serialized);
      }, 1400);
    },
    [canvasReady, clearSaveTimer, persistSnapshot]
  );

  const saveLabel = useMemo(() => {
    if (saveState === "loading") return "Loading";
    if (saveState === "saving") return "Saving local copy";
    if (saveState === "saved") return "Saved locally";
    if (saveState === "error") return "Local save failed";
    return "Unsaved changes";
  }, [saveState]);

  const clearLocalBoard = () => {
    const confirmed = window.confirm("Clear your local whiteboard copy?");
    if (!confirmed) {
      return;
    }

    try {
      suspendAutosaveRef.current = true;
      clearSaveTimer();

      excalidrawApi?.resetScene();
      serializedSnapshotRef.current = null;
      const cleared = persistSnapshot(null);
      setInitialData(null);
      setCanvasKey((value) => value + 1);
      if (!cleared) {
        return;
      }
    } catch {
      setSaveState("error");
    }
  };

  const saveCurrentToLibrary = async () => {
    if (!excalidrawApi) {
      return;
    }

    const trimmedTitle = libraryTitle.trim();
    if (!trimmedTitle) {
      setLibrarySaveState("error");
      setLibraryMessage("Give this whiteboard a title before saving it to the library.");
      return;
    }

    try {
      flushPendingSave();
      setLibrarySaveState("saving");
      setLibraryMessage("");

      const serialized =
        serializedSnapshotRef.current ??
        serializeSnapshot({
          elements: excalidrawApi.getSceneElementsIncludingDeleted(),
          appState: null,
          files: excalidrawApi.getFiles()
        });

      serializedSnapshotRef.current = serialized;

      const uploadUrl = await getUploadUrl({
        projectId: project.projectId,
        externalId
      });

      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: new Blob([serialized], { type: "application/json" })
      });

      if (!uploadResult.ok) {
        throw new Error("Upload failed");
      }

      const payload = (await uploadResult.json()) as { storageId: string };

      await saveToLibrary({
        projectId: project.projectId,
        externalId,
        title: trimmedTitle,
        storageId: payload.storageId as any
      });

      setLibrarySaveState("saved");
      setLibraryMessage(`Saved "${trimmedTitle}" to the project library.`);
      setLibraryTitle("");
    } catch {
      setLibrarySaveState("error");
      setLibraryMessage("Could not save this whiteboard to the project library.");
    }
  };

  const importLibraryItemAsCopy = async (item: LibraryItem) => {
    if (!item.snapshotUrl) {
      setLibraryMessage("This library board is unavailable right now.");
      setLibrarySaveState("error");
      return;
    }

    const confirmed = window.confirm(`Replace your current local whiteboard with a copy of \"${item.title}\"?`);
    if (!confirmed) {
      return;
    }

    try {
      suspendAutosaveRef.current = true;
      clearSaveTimer();
      setActiveLibraryItemId(item.itemId);
      setSaveState("saving");

      const response = await fetch(item.snapshotUrl);
      if (!response.ok) {
        throw new Error("Could not load library whiteboard.");
      }

      const serialized = await response.text();
      await loadSnapshotAsLocalCopy(serialized);
      setLibraryTitle(item.title);
      setLibrarySaveState("saved");
      setLibraryMessage(`Loaded \"${item.title}\" as your own local copy.`);
    } catch {
      setSaveState("error");
      setLibrarySaveState("error");
      setLibraryMessage("Could not open that library whiteboard.");
    } finally {
      setActiveLibraryItemId("");
    }
  };

  return (
    <div className="space-y-3">
      <section className="panel flex flex-wrap items-center justify-between gap-3 p-3">
        <div>
          <h1 className="font-display text-lg font-bold uppercase">Whiteboard</h1>
          <p className="muted text-xs">Autosaves locally. Save reusable boards to the project library.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`pill ${
              saveState === "error"
                ? "bg-[var(--danger-soft)] text-[var(--danger-text)]"
                : saveState === "saving"
                  ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                  : "bg-[var(--background-alt)] text-[var(--muted-foreground)]"
            }`}
          >
            {saveLabel}
          </span>
          <button
            type="button"
            className="rounded-md border-2 border-[var(--danger-text)] bg-[var(--danger-soft)] px-3 py-1.5 text-xs font-semibold uppercase text-[var(--danger-text)]"
            onClick={clearLocalBoard}
          >
            Clear Local
          </button>
        </div>
      </section>

      {compatNotice ? (
        <section className="panel p-3">
          <p className="text-sm text-[var(--warn-text)]">{compatNotice}</p>
        </section>
      ) : null}

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel h-[72vh] overflow-hidden p-0 sm:h-[78vh] xl:h-[80vh]">
          {canvasReady && ExcalidrawComponent ? (
            <ExcalidrawComponent
              key={`${localStorageKey}:${canvasKey}`}
              excalidrawAPI={(api: any) => setExcalidrawApi(api)}
              initialData={initialData}
              onChange={handleChange}
              theme={theme}
            />
          ) : canvasLoadError ? (
            <div className="flex h-full items-center justify-center px-4 text-center">
              <p className="text-sm text-[var(--danger-text)]">{canvasLoadError}</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="muted text-xs uppercase tracking-wider">Loading canvas...</p>
            </div>
          )}
        </section>

        <aside className="panel flex min-h-[28rem] flex-col p-4">
          <div className="border-b-2 border-[var(--border)] pb-4">
            <h2 className="font-display text-base font-bold uppercase">Project Library</h2>
            <p className="muted mt-1 text-xs">Save reusable boards here. Opening one creates your own editable local copy.</p>

            <div className="mt-4 space-y-2">
              <input
                value={libraryTitle}
                onChange={(event) => setLibraryTitle(event.target.value)}
                className="w-full rounded-md px-3 py-2 text-sm"
                placeholder="Whiteboard title"
                maxLength={80}
              />
              <button
                type="button"
                className="btn-accent w-full rounded-md px-3 py-2 text-xs font-semibold uppercase"
                onClick={saveCurrentToLibrary}
                disabled={librarySaveState === "saving" || !excalidrawApi}
              >
                {librarySaveState === "saving" ? "Saving to Library" : "Save Current Board"}
              </button>
            </div>

            {libraryMessage ? (
              <p
                className={`mt-3 text-sm ${
                  librarySaveState === "error" ? "text-[var(--danger-text)]" : "text-[var(--muted-foreground)]"
                }`}
              >
                {libraryMessage}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex-1 overflow-y-auto">
            {libraryItems === undefined ? (
              <p className="muted text-sm">Loading library...</p>
            ) : libraryItems.length === 0 ? (
              <div className="rounded-md border-2 border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
                No boards saved yet. Save the current canvas to start a shared project library.
              </div>
            ) : (
              <div className="space-y-3">
                {libraryItems.map((item) => (
                  <section key={item.itemId} className="rounded-md border-2 border-[var(--border)] bg-[var(--background)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold uppercase text-[var(--foreground)]">{item.title}</p>
                        <p className="muted mt-1 text-xs">By {item.creatorName}</p>
                        <p className="muted text-xs">Updated {formatTimestamp(item.updatedAt)}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost rounded-md px-3 py-1.5 text-xs font-semibold uppercase"
                        onClick={() => void importLibraryItemAsCopy(item)}
                        disabled={!item.snapshotUrl || activeLibraryItemId === item.itemId}
                      >
                        {activeLibraryItemId === item.itemId ? "Opening" : "Open Copy"}
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
