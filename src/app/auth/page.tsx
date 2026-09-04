"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { IconChartLine, IconFlag, IconLayoutKanban, IconShieldCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Mode = "login" | "signup";

const featureTiles = [
  { icon: <IconLayoutKanban size={16} />, label: "Realtime team board" },
  { icon: <IconFlag size={16} />, label: "Sprint management" },
  { icon: <IconChartLine size={16} />, label: "Auto metrics dashboard" },
  { icon: <IconShieldCheck size={16} />, label: "Owner and admin project setup" }
];

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const next = useMemo(() => searchParams.get("next") ?? "/dashboard", [searchParams]);

  useEffect(() => {
    if (!isPending && session) {
      router.replace(next);
    }
  }, [isPending, next, router, session]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({
          name,
          email,
          password
        });
        if (result.error) {
          setError(result.error.message ?? "Failed to create account.");
          return;
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password
        });
        if (result.error) {
          setError(result.error.message ?? "Invalid email or password.");
          return;
        }
      }

      router.replace(next);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-16">
      <div className="grid w-full gap-8 md:grid-cols-[1.2fr_1fr]">
        <section className="hidden md:block">
          <p className="inline-flex items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent-text)]">
            Student teams
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-[var(--foreground)]">
            Run your sprint board without Jira overhead.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)]">
            Plan tasks, drag tickets across a realtime board, and track burndown, velocity, and cycle time
            automatically.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {featureTiles.map((tile) => (
              <div
                key={tile.label}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] shadow-[var(--shadow-sm)]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]">
                  {tile.icon}
                </span>
                {tile.label}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-md)]">
          <div className="mb-6 flex gap-1 rounded-xl bg-[var(--background-alt)] p-1">
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mode === "login" ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mode === "signup" ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            {mode === "signup" ? (
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full"
                  required
                />
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full"
                required
                type="email"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full"
                required
                type="password"
                minLength={8}
              />
            </label>

            {error ? <p className="text-sm text-[var(--danger-text)]">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary w-full disabled:opacity-50"
            >
              {isSubmitting ? "Working..." : mode === "signup" ? "Create account" : "Log in"}
            </button>
          </form>

          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            After sign-in, choose or create a project workspace.
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Need setup help? Open{" "}
            <Link href="/onboarding" className="font-medium text-[var(--accent-text)] underline decoration-1 underline-offset-2">
              project setup
            </Link>{" "}
            after you sign in.
          </p>
        </section>
      </div>
    </main>
  );
}