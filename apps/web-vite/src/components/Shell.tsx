import {
  IconChartLine,
  IconClipboardList,
  IconFlag,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconLogout,
  IconMenu2,
  IconX,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { authClient } from "../lib/auth";
import type { Project, RouteName } from "../types";
import { initials } from "../lib/format";

const navItems = [
  { route: "dashboard", label: "Dashboard", icon: IconLayoutDashboard },
  { route: "board", label: "Board", icon: IconLayoutKanban },
  { route: "backlog", label: "Backlog", icon: IconClipboardList },
  { route: "sprints", label: "Sprints", icon: IconFlag },
  { route: "metrics", label: "Metrics", icon: IconChartLine },
] as const;

export function Shell({ route, navigate, project, projects, onProjectChange, user, children }: {
  route: RouteName;
  navigate: (route: RouteName) => void;
  project: Project;
  projects: Project[];
  onProjectChange: (id: string) => void;
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const go = (next: RouteName) => { navigate(next); setOpen(false); };
  return (
    <div className="app-shell">
      <button className="mobile-menu" type="button" onClick={() => setOpen(true)} aria-label="Open navigation"><IconMenu2 size={20} /></button>
      {open ? <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand-row"><span className="brand-mark">T</span><strong>TRIATHLON</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close navigation"><IconX size={18} /></button></div>
        <label className="project-switcher">
          <span className="sr-only">Project</span>
          <select value={project.id} onChange={(event) => onProjectChange(event.target.value)}>
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <small>{project.role === "owner" ? "Owner workspace" : "Member workspace"}</small>
        </label>
        <span className="sidebar-label">WORKSPACE</span>
        <nav>
          {navItems.map(({ route: itemRoute, label, icon: Icon }) => (
            <button key={itemRoute} type="button" className={route === itemRoute ? "selected" : ""} onClick={() => go(itemRoute)} aria-current={route === itemRoute ? "page" : undefined}>
              <Icon size={20} stroke={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{initials(user.name)}</span>
          <span><strong>{user.name}</strong><small>{user.email}</small></span>
          <button type="button" aria-label="Log out" title="Log out" onClick={() => void authClient.signOut().then(() => window.location.reload())}><IconLogout size={18} /></button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
