# Papercuts

Small frictions the agent hit while working here ("bullshit tax").
Run `/fix-papercuts` in pi to have the agent clear them out.

- [ ] PC-1 (2026-09-04) [api] gh issue create
  gh issue create has no --json flag, so ticket numbers had to be parsed from the URL string instead of machine output.
- [ ] PC-2 (2026-09-04) [build] /Users/roshan/Documents/DDD/Group Project/triathlon (npm install)
  npm install --save-exact oxlint timed out at 180s but actually completed: packages present in node_modules, package.json, and lockfile were all updated. The timeout report was misleading.
- [ ] PC-3 (2026-09-04) [api] triathlon (vinext + Next RSC)
  @phosphor-icons/react crashes vinext's RSC module runner ((0, import_react.createContext) is not a function) on Server Components. Use @tabler/icons-react instead - single-file ESM exports work fine. Also, after npm install/remove of icon packages, the Vite dep optimizer cache goes stale: must kill the dev server and rm -rf node_modules/.vite before restarting, or you get "file does not exist in deps_rsc" errors.
- [ ] PC-4 (2026-09-07) [api] apps/server/src/http/app.ts
  @fastify/type-provider-typebox v5: TypeBoxTypeProvider is type-only (import type required) — runtime import crashes with a confusing SyntaxError; the package also re-exports all of @sinclair/typebox. @fastify/swagger v9 removed exposeRoute/routePrefix (moved to @fastify/swagger-ui).
- [ ] PC-5 (2026-09-10) [ux] apps/server/dist/index.js init / apps/server/src/index.ts
  Once the instance is bootstrapped there is no supported way to get a test credential: 'init' exits with 'bootstrap is closed', no reset codes exist, and V2_TESTING.md only covers a clean instance. Testing an existing instance requires direct DB pokes.
- [ ] PC-6 (2026-09-10) [docs] V2_TESTING.md §5 and README.md §API and clients vs docs/specs/2026-09-07-v2-backend-design.md:126
  V2_TESTING.md checklist says 'A reused or revoked invitation is rejected', but the design spec line 126 says invitations are 'reusable until revoked or expired'. The code follows the spec, so the testing guide sends you hunting a bug that is intended behaviour. README also says access keys look like 'tri_...' but the secrets are prefixed 'tka_'.
- [ ] PC-7 (2026-09-11) [docs] docs/extensions.md (pi 0.85.1) + examples/extensions/subagent/index.ts
  Returning `isError: true` from a custom tool's execute() does NOT set the error flag (docs say only throwing does), yet the bundled subagent example returns `isError: true`, so it silently misreports failures. Also `isError` is on the render context (4th arg), not on the result object passed to renderResult, which is easy to confuse with ToolRenderResultOptions.
