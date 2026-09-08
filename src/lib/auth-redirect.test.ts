import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAuthRedirect } from "./auth-redirect.js";

test("does not redirect when the auth page is already mounted", () => {
  assert.equal(buildAuthRedirect("/auth", "next=%2Fdashboard"), null);
});

test("preserves the protected destination when redirecting to auth", () => {
  assert.equal(buildAuthRedirect("/dashboard", ""), "/auth?next=%2Fdashboard");
});
