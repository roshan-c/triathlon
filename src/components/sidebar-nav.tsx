"use client";

import {
  IconChartLine,
  IconClipboardList,
  IconFlag,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconLogout,
  IconMenu2,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSun
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/auth-client";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/board", label: "Board", icon: IconLayoutKanban },
  { href: "/backlog", label: "Backlog", icon: IconClipboardList },
  { href: "/sprints", label: "Sprints", icon: IconFlag },
  { href: "/metrics", label: "Metrics", icon: IconChartLine },
  { href: "/whiteboard", label: "Whiteboard", icon: IconPencil }
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
  const isCollapsed = isDesktopViewport && !isDesktopOpen;

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

  const mainStyle = isCollapsed ? { paddingLeft: "5.5rem" } : isDesktopViewport ? { paddingLeft: "17.5rem" } : undefined;

  return (
    <div className="min-h-[100dvh]">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:hidden">
        <button
          type="button"
          aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          className="icon-btn"
          onClick={toggleSidebar}
        >
          <IconMenu2 size={20} />
        </button>
        <BrandMark />
        <span className="font-semibold text-sm tracking-tight text-[var(--foreground)]">Triathlon</span>
      </div>

      <aside
        className={`fixed bottom-0 left-0 top-14 z-50 flex flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[transform,width] duration-200 lg:top-0 lg:bottom-0 ${
          isCollapsed ? "w-[4.25rem] items-center" : "w-64"
        } ${
          // Desktop: the sidebar never leaves the viewport (closed = icon rail).
          // Mobile: the drawer slides away and reopens via the top bar button.
          isDesktopViewport || isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div
          className={`flex shrink-0 items-center gap-3 border-b border-[var(--border)] ${
            isCollapsed ? "flex-col gap-2 py-3" : "h-14 px-4"
          }`}
        >
          <BrandMark />
          {isCollapsed ? (
            <button
              type="button"
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="icon-btn"
              onClick={toggleSidebar}
            >
              <IconMenu2 size={18} stroke={2.5} />
            </button>
          ) : (
            <>
              <span className="font-semibold text-sm tracking-tight text-[var(--foreground)]">Triathlon</span>
              <button
                type="button"
                aria-label="Collapse sidebar"
                className="icon-btn ml-auto hidden lg:inline-flex"
                onClick={toggleSidebar}
              >
                <IconMenu2 size={18} stroke={2.5} />
              </button>
            </>
          )}
        </div>

        {/* Project switcher */}
        <div className={`shrink-0 px-4 py-4 ${isCollapsed ? "hidden" : ""}`}>
          <div className="flex items-center gap-2">
            <select
              value={currentProjectId}
              onChange={(event) => onProjectChange(event.target.value)}
              aria-label="Switch project"
              className="min-w-0 flex-1 rounded-lg text-sm"
              title={projectName}
            >
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.name}
                </option>
              ))}
            </select>
            {canCreateProjects ? (
              <Link href="/onboarding" aria-label="Create project" className="icon-btn shrink-0">
                <IconPlus size={18} />
              </Link>
            ) : null}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4 thin-scroll">
          {projectScopedLinks.map((link) => {
            const isActive = pathname === link.href.split("?")[0];
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                title={isCollapsed ? link.label : undefined}
                aria-label={isCollapsed ? link.label : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isCollapsed ? "justify-center px-0" : ""
                } ${
                  isActive
                    ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                    : "text-[var(--foreground)] hover:bg-[var(--background-alt)]"
                }`}
              >
                <Icon size={19} />
                {isCollapsed ? null : <span className="truncate">{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer actions */}
        <div
          className={`shrink-0 space-y-1 border-t border-[var(--border)] p-3 ${
            isCollapsed ? "flex flex-col items-center" : ""
          }`}
        >
          <button
            type="button"
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background-alt)] hover:text-[var(--foreground)] ${
              isCollapsed ? "justify-center px-0" : ""
            }`}
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <IconSun size={19} /> : <IconMoon size={19} />}
            {isCollapsed ? null : <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
          </button>
          <button
            type="button"
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background-alt)] hover:text-[var(--foreground)] ${
              isCollapsed ? "justify-center px-0" : ""
            }`}
            onClick={logout}
            title="Log out"
          >
            <IconLogout size={19} />
            {isCollapsed ? null : <span>Log out</span>}
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

      <main
        className="w-full px-4 pb-10 pt-20 transition-[padding] duration-200 sm:px-6 lg:pt-10"
        style={mainStyle}
      >
        {children}
      </main>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] font-display text-sm font-bold text-[var(--accent-text)]">
      T
    </span>
  );
}