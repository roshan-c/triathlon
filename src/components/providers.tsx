"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { authClient } from "@/lib/auth-client";

type Props = {
  children: ReactNode;
  initialToken?: string | null;
};

export function Providers({ children, initialToken }: Props) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = useMemo(() => {
    if (!convexUrl) {
      return null;
    }
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!client) {
    return (
      <ThemeProvider>
        <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
          <div className="panel w-full p-6">
            <h1 className="font-display text-xl font-bold uppercase tracking-wider">Missing Convex URL</h1>
            <p className="muted mt-2 text-sm">
              Set <code>NEXT_PUBLIC_CONVEX_URL</code> in your <code>.env</code> file.
            </p>
          </div>
        </main>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ConvexBetterAuthProvider client={client} authClient={authClient} initialToken={initialToken}>
        {children}
      </ConvexBetterAuthProvider>
    </ThemeProvider>
  );
}
