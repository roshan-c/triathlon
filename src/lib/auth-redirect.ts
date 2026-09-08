export function buildAuthRedirect(pathname: string, queryString: string): string | null {
  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    return null;
  }

  const next = `${pathname}${queryString ? `?${queryString}` : ""}`;
  return `/auth?next=${encodeURIComponent(next)}`;
}
