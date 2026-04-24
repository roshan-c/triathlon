import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const inferredConvexSiteUrl = convexUrl
  ? convexUrl.includes(".convex.cloud")
    ? convexUrl.replace(".convex.cloud", ".convex.site")
    : convexUrl.replace(/:(\d+)$/, (_, port) => `:${Number(port) + 1}`)
  : undefined;
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? inferredConvexSiteUrl;

if (!convexUrl) {
  throw new Error("Set NEXT_PUBLIC_CONVEX_URL.");
}

if (!convexSiteUrl) {
  throw new Error("Set NEXT_PUBLIC_CONVEX_SITE_URL.");
}

export const {
  handler,
  preloadAuthQuery,
  isAuthenticated,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction
} = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl
});
