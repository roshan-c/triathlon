import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { Shell } from "./components/Shell";
import { ActionButton, ErrorBlock, LoadingBlock } from "./components/ui";
import { apiBase, bootstrapOwner, createProject, getProjects } from "./lib/api";
import { authClient } from "./lib/auth";
import { useResource } from "./lib/use-resource";
import { useRoute } from "./lib/router";
import type { WorkspaceData } from "./types";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const BoardPage = lazy(() => import("./pages/BoardPage").then((module) => ({ default: module.BoardPage })));
const BacklogPage = lazy(() => import("./pages/BacklogPage").then((module) => ({ default: module.BacklogPage })));
const SprintsPage = lazy(() => import("./pages/SprintsPage").then((module) => ({ default: module.SprintsPage })));
const MetricsPage = lazy(() => import("./pages/MetricsPage").then((module) => ({ default: module.MetricsPage })));

export default function App() {
  const { data: session, isPending } = authClient.useSession();
  const projects = useResource(() => session ? getProjects() : Promise.resolve([]), [session?.user?.id]);
  const [route, navigate] = useRoute();
  const [selectedProjectId, setSelectedProjectId] = useState(() => window.localStorage.getItem("triathlon-vite-project") ?? "");
  const [refreshKey, setRefreshKey] = useState(0);
  const project = projects.data?.find((item) => item.id === selectedProjectId) ?? projects.data?.[0];

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem("triathlon-vite-project", project.id);
  }, [project]);

  useEffect(() => {
    if (!project) return;
    const source = new EventSource(`${apiBase}/api/v1/projects/${encodeURIComponent(project.id)}/events`, { withCredentials: true });
    const refresh = () => setRefreshKey((value) => value + 1);
    const eventTypes = ["ticket.created", "ticket.updated", "ticket.moved", "ticket.resolved", "ticket.reopened", "ticket.deleted", "sprint.created", "sprint.activated", "sprint.completed", "sprint.member.added", "sprint.member.removed"];
    eventTypes.forEach((eventType) => source.addEventListener(eventType, refresh));
    return () => { eventTypes.forEach((eventType) => source.removeEventListener(eventType, refresh)); source.close(); };
  }, [project]);

  if (isPending) return <main className="centered-state"><LoadingBlock /></main>;
  if (!session?.user) return <AuthScreen />;
  if (projects.loading) return <main className="centered-state"><LoadingBlock label="Loading project access…" /></main>;
  if (projects.error) return <main className="centered-state"><ErrorBlock message={projects.error} onRetry={projects.reload} /></main>;
  if (!project) return <FirstProjectSetup onCreated={projects.reload} />;

  const workspace: WorkspaceData = {
    project,
    projects: projects.data ?? [],
    user: { id: session.user.id, name: session.user.name || session.user.email, email: session.user.email, image: session.user.image },
    refreshKey,
    refresh: () => setRefreshKey((value) => value + 1),
  };

  return (
    <Shell route={route} navigate={navigate} project={project} projects={projects.data ?? []} onProjectChange={setSelectedProjectId} user={workspace.user}>
      <Suspense fallback={<LoadingBlock label="Opening workspace…" />}>
        {route === "dashboard" ? <DashboardPage workspace={workspace} navigate={navigate} /> : null}
        {route === "board" ? <BoardPage workspace={workspace} /> : null}
        {route === "backlog" ? <BacklogPage workspace={workspace} navigate={navigate} /> : null}
        {route === "sprints" ? <SprintsPage workspace={workspace} /> : null}
        {route === "metrics" ? <MetricsPage workspace={workspace} /> : null}
      </Suspense>
    </Shell>
  );
}

function FirstProjectSetup({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProject(name.trim());
      onCreated();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "The project could not be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centered-state first-project-state">
      <section className="panel first-project-card">
        <span className="brand-mark">T</span>
        <span className="eyebrow accent-text">FIRST PROJECT</span>
        <h1>Set your crew’s course.</h1>
        <p>Create the workspace that will hold your board, tickets, sprints, and delivery signals.</p>
        <form onSubmit={submit}>
          <label>Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Product delivery" maxLength={120} required /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <ActionButton type="submit" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create project"}</ActionButton>
        </form>
        <button className="text-button" type="button" onClick={() => void authClient.signOut().then(() => window.location.reload())}>Log out</button>
      </section>
    </main>
  );
}

function AuthScreen() {
  const setupCode = new URLSearchParams(window.location.search).get("code") ?? "";
  const [mode, setMode] = useState<"login" | "signup" | "setup">(() => window.location.pathname === "/setup" && setupCode ? "setup" : "login");
  const [name, setName] = useState("");
  const [code, setCode] = useState(setupCode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === "setup") {
        await bootstrapOwner({ code, email, displayName: name, password });
        window.history.replaceState({}, "", "/");
        window.location.reload();
        return;
      }
      const result = mode === "login" ? await authClient.signIn.email({ email, password }) : await authClient.signUp.email({ name, email, password, code } as Parameters<typeof authClient.signUp.email>[0]);
      if (result.error) setError(result.error.message ?? "Authentication failed."); else window.location.reload();
    } catch (unknownError) { setError(unknownError instanceof Error ? unknownError.message : "Authentication failed."); }
    finally { setBusy(false); }
  };

  const title = useMemo(() => mode === "login" ? "Return to the boathouse" : mode === "signup" ? "Join the crew" : "Claim the helm", [mode]);
  return (
    <main className="auth-shell">
      <section className="auth-story dark-panel"><span className="brand-mark large">T</span><span className="eyebrow accent-text">TRIATHLON / DELIVERY CONTROL</span><h1>Run the sprint without the Jira overhead.</h1><p>Plan work, move tickets through the race, and read delivery signals from one focused workspace.</p></section>
      <section className="auth-card panel">{mode !== "setup" ? <div className="auth-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>Log in</button><button type="button" className={mode === "signup" ? "selected" : ""} onClick={() => setMode("signup")}>Sign up</button></div> : <span className="eyebrow accent-text">FIRST-RUN OWNER SETUP</span>}<h2>{title}</h2><form onSubmit={submit}>{mode !== "login" ? <><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>{mode === "setup" ? "Bootstrap code" : "Invitation code"}<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required readOnly={mode === "setup" && Boolean(setupCode)} /></label></> : null}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<ActionButton type="submit" disabled={busy}>{busy ? "Working…" : mode === "login" ? "Log in" : mode === "setup" ? "Create owner account" : "Create account"}</ActionButton></form></section>
    </main>
  );
}
