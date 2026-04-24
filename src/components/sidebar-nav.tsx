"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/auth-client";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/board", label: "Board" },
  { href: "/backlog", label: "Backlog" },
  { href: "/sprints", label: "Sprints" },
  { href: "/metrics", label: "Metrics" },
  { href: "/whiteboard", label: "Whiteboard" }
];

type ProjectOption = {
  projectId: string;
  name: string;
  role: "owner" | "member";
};

type Props = {
  projectName: string;
  currentProjectId: string;
  projects: ProjectOption[];
  canCreateProjects: boolean;
  onProjectChange: (projectId: string) => void;
  children: ReactNode;
};

export function SidebarNav({
  projectName,
  currentProjectId,
  projects,
  canCreateProjects,
  onProjectChange,
  children
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [isDesktopOpen, setIsDesktopOpen] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const applyViewport = () => {
      const isDesktop = mediaQuery.matches;
      setIsDesktopViewport(isDesktop);

      if (isDesktop) {
        const saved = window.localStorage.getItem("tri-sidebar-open");
        setIsDesktopOpen(saved !== "0");
        setIsMobileOpen(false);
      }
    };

    applyViewport();
    mediaQuery.addEventListener("change", applyViewport);
    return () => mediaQuery.removeEventListener("change", applyViewport);
  }, []);

  useEffect(() => {
    if (isDesktopViewport) {
      window.localStorage.setItem("tri-sidebar-open", isDesktopOpen ? "1" : "0");
    }
  }, [isDesktopOpen, isDesktopViewport]);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isSidebarOpen = isDesktopViewport ? isDesktopOpen : isMobileOpen;

  const toggleSidebar = () => {
    if (isDesktopViewport) {
      setIsDesktopOpen((value) => !value);
      return;
    }
    setIsMobileOpen((value) => !value);
  };

  const logout = async () => {
    await authClient.signOut();
    router.replace("/auth");
  };

  const projectScopedLinks = useMemo(
    () =>
      links.map((link) => ({
        ...link,
        href: `${link.href}?projectId=${encodeURIComponent(currentProjectId)}`
      })),
    [currentProjectId]
  );

  const mainStyle = isDesktopViewport && isDesktopOpen ? { paddingLeft: "19rem" } : undefined;

  return (
    <div className="min-h-screen">
      <header className="fixed inset-x-0 top-0 z-[55] h-14 border-b-2 border-[var(--border)] bg-[var(--card)]/95 backdrop-blur">
        <div className="flex h-full items-center gap-3 px-3 sm:px-6">
          <button
            type="button"
            aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
            className="btn-ghost flex h-10 w-10 items-center justify-center rounded-md"
            onClick={toggleSidebar}
          >
            <span className="relative h-4 w-5">
              <span
                className={`absolute left-0 top-0 block h-0.5 w-5 bg-[var(--foreground)] transition-transform ${
                  isSidebarOpen ? "translate-y-[7px] rotate-45" : "translate-y-0"
                }`}
              />
              <span
                className={`absolute left-0 top-[7px] block h-0.5 w-5 bg-[var(--foreground)] transition-opacity ${
                  isSidebarOpen ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute left-0 top-[14px] block h-0.5 w-5 bg-[var(--foreground)] transition-transform ${
                  isSidebarOpen ? "-translate-y-[7px] -rotate-45" : "translate-y-0"
                }`}
              />
            </span>
          </button>

          <div>
            <p className="font-display text-base font-bold uppercase tracking-widest text-[var(--foreground)]">Triathlon</p>
          </div>
        </div>
      </header>

      <aside
        className={`fixed bottom-0 left-0 top-14 z-[60] flex w-72 flex-col border-r-2 border-[var(--border)] bg-[var(--card)] p-3 transition-transform duration-200 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 border-b-2 border-[var(--border)] pb-3">
          <p className="font-display text-base font-bold uppercase tracking-widest text-[var(--foreground)]">Agile Board</p>
          <p className="muted mt-1 text-xs">{projectName}</p>

          <label className="mt-3 block text-xs">
            <span className="muted mb-1 block uppercase tracking-wide">Project</span>
            <select
              value={currentProjectId}
              onChange={(event) => onProjectChange(event.target.value)}
              className="w-full rounded-md px-2 py-2 text-sm"
            >
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.name} ({project.role})
                </option>
              ))}
            </select>
          </label>

          {canCreateProjects ? (
            <Link
              href="/onboarding"
              className="btn-ghost mt-2 inline-flex w-full items-center justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase"
            >
              Create Project
            </Link>
          ) : null}
        </div>

        <nav className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {projectScopedLinks.map((link) => {
            const isActive = pathname === link.href.split("?")[0];
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                className={`rounded-md border-2 px-3 py-2 text-sm font-semibold uppercase tracking-wide transition ${
                  isActive
                    ? "is-selected"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--accent)]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-3 flex flex-col gap-2 border-t-2 border-[var(--border)] pt-3">
          <button
            type="button"
            className="btn-ghost rounded-md px-3 py-2 text-xs font-semibold uppercase"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>

          <button
            type="button"
            className="btn-ghost rounded-md px-3 py-2 text-xs font-semibold uppercase"
            onClick={logout}
            title="Logout"
          >
            Logout
          </button>
        </div>
      </aside>

      {!isDesktopViewport && isSidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      ) : null}

      <main className="w-full px-3 pb-4 pt-16 transition-[padding] duration-200 sm:px-6 sm:pb-6" style={mainStyle}>
        {children}
      </main>
    </div>
  );
}
