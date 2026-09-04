import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import schema from "./schema";

export const authComponent = createClient<DataModel, typeof schema>(
  components.betterAuth,
  {
    local: { schema },
    verbose: false
  }
);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  return {
    appName: "Triathlon",
    baseURL: process.env.SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    // The Next.js adapter forwards auth requests through the Convex Site URL.
    // Trust both browser-facing origins so cookie-bearing requests pass the
    // Better Auth origin check at the Convex boundary.
    trustedOrigins: [process.env.SITE_URL, process.env.CONVEX_SITE_URL].filter(
      (origin): origin is string => Boolean(origin)
    ),
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false
    },
    plugins: [convex({ authConfig })]
  } satisfies BetterAuthOptions;
};

// SAFETY: This value is used only to construct static Better Auth options; the
// runtime auth path always calls createAuthOptions with a real Convex context.
export const options = createAuthOptions({} as GenericCtx<DataModel>);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth(createAuthOptions(ctx));
};
