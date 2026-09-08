"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_TRIATHLON_URL ?? "http://localhost:8080";

export default function SetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/api/v1/bootstrap/redeem`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          email,
          displayName,
          password
        })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Could not complete instance setup.");
      }
      router.replace("/onboarding");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not complete instance setup.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-md)] sm:p-8">
        <p className="inline-flex items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent-text)]">
          First-run setup
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--foreground)]">Create the instance owner</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          This one-time code is valid for 30 minutes and closes bootstrap registration after use.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Bootstrap code</span>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} className="w-full font-mono uppercase" required autoComplete="off" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Display name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="w-full" required />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} className="w-full" required type="email" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Password</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} className="w-full" required minLength={8} type="password" />
          </label>

          {error ? <p className="text-sm text-[var(--danger-text)]">{error}</p> : null}

          <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full disabled:opacity-60">
            {isSubmitting ? "Creating owner..." : "Create instance owner"}
          </button>
        </form>

        <p className="mt-4 text-xs text-[var(--muted-foreground)]">
          Already have an account? <Link href="/auth" className="font-medium text-[var(--accent-text)] underline decoration-1 underline-offset-2">Log in</Link>.
        </p>
      </section>
    </main>
  );
}
