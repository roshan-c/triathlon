import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_TRIATHLON_URL ?? "http://localhost:8080"
});
