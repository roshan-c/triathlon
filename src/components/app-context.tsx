"use client";

import { useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { authClient } from "@/lib/auth-client";
import { cvx } from "@/lib/convex";

type ProjectSummary = {
  projectId: string;
  name: string;
  description?: string;
  role: "owner" | "member";
  createdAt: number;
};

type AppContextValue = {
  externalId: string;
  session: any;
  project: ProjectSummary;
  projects: ProjectSummary[];
  canCreateProjects: boolean;
  setProjectId: (projectId: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const externalId = session?.user?.id as string | undefined;

  const projects = useQuery(
    cvx.projects.listMine,
    externalId
      ? {
          externalId
        }
      : "skip"
  );

  const createAccess = useQuery(
    cvx.projects.canCreate,
    externalId
      ? {
          externalId
        }
      : "skip"
  );

  const syncProfile = useMutation(cvx.users.syncProfile);

  const queryString = searchParams.toString();
  const requestedProjectId = searchParams.get("projectId");

  const project = useMemo(() => {
    if (!projects || projects.length === 0) {
      return null;
    }

    const selected = requestedProjectId
      ? projects.find((item: ProjectSummary) => item.projectId === requestedProjectId)
      : null;

    return selected ?? projects[0];
  }, [projects, requestedProjectId]);

  useEffect(() => {
    if (isPending) {
      return;
    }

    if (!session) {
      const next = `${pathname}${queryString ? `?${queryString}` : ""}`;
      router.replace(`/auth?next=${encodeURIComponent(next)}`);
      return;
    }

    if (projects === undefined || createAccess === undefined) {
      return;
    }

    if (projects.length === 0) {
      router.replace("/onboarding");
      return;
    }

    if (!project) {
      return;
    }

    if (requestedProjectId !== project.projectId) {
      const params = new URLSearchParams(queryString);
      params.set("projectId", project.projectId);
      const next = params.toString();
      router.replace(`${pathname}?${next}`);
    }
  }, [createAccess, isPending, pathname, project, projects, queryString, requestedProjectId, router, session]);

  useEffect(() => {
    if (!session?.user || !externalId) {
      return;
    }
    void syncProfile({
      externalId,
      name: session.user.name,
      email: session.user.email,
      avatarUrl: session.user.image ?? undefined
    });
  }, [externalId, session?.user, syncProfile]);

  const setProjectId = useCallback(
    (nextProjectId: string) => {
      const params = new URLSearchParams(queryString);
      params.set("projectId", nextProjectId);
      const next = params.toString();
      router.push(`${pathname}${next ? `?${next}` : ""}`);
    },
    [pathname, queryString, router]
  );

  const value = useMemo(() => {
    if (!externalId || !session || !project || !projects) {
      return null;
    }

    return {
      externalId,
      session,
      project,
      projects,
      canCreateProjects: createAccess?.canCreate ?? false,
      setProjectId
    };
  }, [createAccess?.canCreate, externalId, project, projects, session, setProjectId]);

  if (isPending || projects === undefined || createAccess === undefined || value === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
        <div className="panel w-full p-6">
          <p className="muted animate-pulse text-sm uppercase tracking-wider">Loading workspace...</p>
        </div>
      </main>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return context;
}
