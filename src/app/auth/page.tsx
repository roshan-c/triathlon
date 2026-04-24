"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Mode = "login" | "signup";

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
        <section className="panel p-8">
          <p className="pill border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]">Student teams</p>
          <h1 className="mt-4 font-display text-4xl font-bold uppercase leading-tight text-[var(--foreground)]">
            Run your sprint board without Jira overhead.
          </h1>
          <p className="muted mt-4 max-w-xl text-sm">
            Plan tasks, drag cards across a realtime board, and track burndown, velocity, and cycle time automatically.
          </p>
          <div className="mt-8 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border-2 border-[var(--border)] bg-[var(--background-alt)] p-3">Realtime team board</div>
            <div className="rounded-lg border-2 border-[var(--border)] bg-[var(--background-alt)] p-3">Sprint management</div>
            <div className="rounded-lg border-2 border-[var(--border)] bg-[var(--background-alt)] p-3">Auto metrics dashboard</div>
            <div className="rounded-lg border-2 border-[var(--border)] bg-[var(--background-alt)] p-3">Owner/admin project setup</div>
          </div>
        </section>

        <section className="panel p-6">
          <div className="mb-5 flex gap-2 rounded-lg border-2 border-[var(--border)] bg-[var(--background-alt)] p-1">
            <button
              type="button"
              className={`w-full rounded-md px-3 py-2 text-sm font-semibold uppercase ${
                mode === "login" ? "btn-accent" : "btn-ghost"
              }`}
              onClick={() => setMode("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={`w-full rounded-md px-3 py-2 text-sm font-semibold uppercase ${
                mode === "signup" ? "btn-accent" : "btn-ghost"
              }`}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            {mode === "signup" ? (
              <label className="block text-sm">
                <span className="muted mb-1 block">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-md px-3 py-2"
                  required
                />
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="muted mb-1 block">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md px-3 py-2"
                required
                type="email"
              />
            </label>

            <label className="block text-sm">
              <span className="muted mb-1 block">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md px-3 py-2"
                required
                type="password"
                minLength={8}
              />
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-accent w-full rounded-md px-3 py-2.5 font-semibold uppercase disabled:opacity-50"
            >
              {isSubmitting ? "Working..." : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="muted mt-4 text-xs">After sign-in, choose or create a project workspace.</p>
          <p className="muted mt-1 text-xs">
            Need setup help? Open{" "}
            <Link href="/onboarding" className="font-semibold underline decoration-2 underline-offset-2">
              project setup
            </Link>{" "}
            after you sign in.
          </p>
        </section>
      </div>
    </main>
  );
}
