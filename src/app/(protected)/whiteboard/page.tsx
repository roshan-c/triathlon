"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import type { GenericId as Id, JSONValue } from "convex/values";
import { z } from "zod";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { useAppContext } from "@/components/app-context";
import { useTheme } from "@/components/theme-provider";
import { cvx } from "@/lib/convex";

type SaveState = "loading" | "idle" | "saving" | "saved" | "error";
type LibrarySaveState = "idle" | "saving" | "saved" | "error";

type ExcalidrawInitialDataState = {
  elements?: readonly unknown[];
  appState?: null;
  files?: BinaryFiles;
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

const snapshotSchema = z.object({
  elements: z.array(z.any()),
  files: z.record(z.string(), z.any()).catch({}).optional()
});

const uploadResponseSchema = z.object({ storageId: z.string() });

function serializeSnapshot(snapshot: SceneSnapshot): string {
  return JSON.stringify(snapshot);
}

function normalizeSnapshot(value: JSONValue): SceneSnapshot | null {
  const check = snapshotSchema.safeParse(value);
  if (!check.success) {
    return null;
  }
  return {
    elements: check.data.elements,
    appState: null,
    files: check.data.files
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
  });

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
    (elements: readonly any[], _appState: any, files: BinaryFiles) => {
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

      const uploadResponse = uploadResponseSchema.safeParse(await uploadResult.json());
      if (!uploadResponse.success) {
        throw new Error("Upload failed");
      }

      await saveToLibrary({
        projectId: project.projectId,
        externalId,
        title: trimmedTitle,
        // SAFETY: The storage upload endpoint returns the new _storage Id as a
        // string; `Id<"_storage">` is that same string at the type level.
        storageId: uploadResponse.data.storageId as Id<"_storage">
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

    const confirmed = window.confirm(`Replace your current local whiteboard with a copy of "${item.title}"?`);
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
      setLibraryMessage(`Loaded "${item.title}" as your own local copy.`);
    } catch {
      setSaveState("error");
      setLibrarySaveState("error");
      setLibraryMessage("Could not open that library whiteboard.");
    } finally {
      setActiveLibraryItemId("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">Whiteboard</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Autosaves locally. Save reusable boards to the project library.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
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
            className="btn btn-danger btn-sm"
            onClick={clearLocalBoard}
          >
            Clear local
          </button>
        </div>
      </div>

      {compatNotice ? (
        <section className="rounded-xl border border-[var(--warn-text)]/25 bg-[var(--warn-soft)] px-4 py-3">
          <p className="text-sm text-[var(--warn-text)]">{compatNotice}</p>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="h-[72vh] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] sm:h-[78vh] xl:h-[80vh]">
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
              <p className="text-xs text-[var(--muted-foreground)]">Loading canvas...</p>
            </div>
          )}
        </section>

        <aside className="flex min-h-[28rem] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
          <div className="border-b border-[var(--border)] px-4 py-3.5">
            <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">Project library</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Save reusable boards here. Opening one creates your own editable local copy.
            </p>
          </div>

          <div className="space-y-2 p-4">
            <input
              value={libraryTitle}
              onChange={(event) => setLibraryTitle(event.target.value)}
              className="w-full text-sm"
              placeholder="Whiteboard title"
              maxLength={80}
            />
            <button
              type="button"
              className="btn btn-primary w-full text-xs"
              onClick={saveCurrentToLibrary}
              disabled={librarySaveState === "saving" || !excalidrawApi}
            >
              {librarySaveState === "saving" ? "Saving to library" : "Save current board"}
            </button>
            {libraryMessage ? (
              <p
                className={`text-xs ${
                  librarySaveState === "error" ? "text-[var(--danger-text)]" : "text-[var(--muted-foreground)]"
                }`}
              >
                {libraryMessage}
              </p>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto border-t border-[var(--border)] p-2 thin-scroll">
            {libraryItems === undefined ? (
              <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">Loading library...</p>
            ) : libraryItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
                No boards saved yet. Save the current canvas to start a shared project library.
              </p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {libraryItems.map((item: LibraryItem) => (
                  <div key={item.itemId} className="flex items-center justify-between gap-3 px-2 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{item.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        By {item.creatorName} <span className="mx-1">·</span> Updated {formatTimestamp(item.updatedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm shrink-0"
                      onClick={() => void importLibraryItemAsCopy(item)}
                      disabled={!item.snapshotUrl || activeLibraryItemId === item.itemId}
                    >
                      {activeLibraryItemId === item.itemId ? "Opening" : "Open copy"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}