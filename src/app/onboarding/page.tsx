"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { cvx } from "@/lib/convex";

export default function OnboardingPage() {
  const router = useRouter();
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

  const createProject = useMutation(cvx.projects.create);
  const syncProfile = useMutation(cvx.users.syncProfile);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/auth?next=/onboarding");
    }
  }, [isPending, router, session]);

  if (isPending || projects === undefined || createAccess === undefined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
        <section className="panel w-full p-6">
          <p className="muted animate-pulse text-sm uppercase tracking-wider">Loading project setup...</p>
        </section>
      </main>
    );
  }

  const canCreateProjects = createAccess.canCreate;
  const createBlockedReason = useMemo(() => {
    if (createAccess?.canCreate) {
      return null;
    }

    if (createAccess?.reason === "owner_or_admin_required") {
      return "Only owners or admins can create a project.";
    }

    if (createAccess?.reason === "user_not_found") {
      return "Your account is not initialized yet. Ask an owner/admin to add access.";
    }

    return "You do not have permission to create a project.";
  }, [createAccess?.canCreate, createAccess?.reason]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user?.id) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const created = await createProject({
        externalId: session.user.id,
        name,
        description: description.trim() || undefined,
        creatorName: session.user.name,
        creatorEmail: session.user.email,
        creatorAvatarUrl: session.user.image ?? undefined
      });

      router.replace(`/dashboard?projectId=${encodeURIComponent(created.projectId)}`);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Could not create project.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
      <section className="panel w-full p-6">
        <p className="pill border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]">Workspace setup</p>
        <h1 className="mt-3 font-display text-2xl font-bold uppercase text-[var(--foreground)]">Create your next project</h1>
        <p className="muted mt-2 text-sm">Projects include a default board and columns so your team can start immediately.</p>

        {projects.length > 0 ? (
          <p className="muted mt-2 text-xs">You currently have access to {projects.length} project(s).</p>
        ) : null}

        {canCreateProjects ? (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="muted mb-1 block">Project name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full rounded-md px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="muted mb-1 block">Description (optional)</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-24 w-full rounded-md px-3 py-2"
              />
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-accent w-full rounded-md px-3 py-2.5 font-semibold uppercase disabled:opacity-60"
            >
              {isSubmitting ? "Creating..." : "Create project"}
            </button>
          </form>
        ) : (
          <div className="mt-5 rounded-md border-2 border-[var(--border)] bg-[var(--background-alt)] p-4">
            <p className="text-sm text-[var(--foreground)]">{createBlockedReason}</p>
            <p className="muted mt-2 text-xs">
              Ask an existing owner/admin to create a project for you or grant admin access.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
