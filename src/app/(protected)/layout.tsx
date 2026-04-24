"use client";

import { AppContextProvider, useAppContext } from "@/components/app-context";
import { SidebarNav } from "@/components/sidebar-nav";

function ProtectedScaffold({ children }: { children: React.ReactNode }) {
  const { project, projects, canCreateProjects, setProjectId } = useAppContext();

  return (
    <SidebarNav
      projectName={project.name}
      currentProjectId={project.projectId}
      projects={projects}
      canCreateProjects={canCreateProjects}
      onProjectChange={setProjectId}
    >
      {children}
    </SidebarNav>
  );
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppContextProvider>
      <ProtectedScaffold>{children}</ProtectedScaffold>
    </AppContextProvider>
  );
}
