# Papercuts

Small frictions the agent hit while working here ("bullshit tax").
Run `/fix-papercuts` in pi to have the agent clear them out.

- [ ] PC-1 (2026-09-04) [api] gh issue create
  gh issue create has no --json flag, so ticket numbers had to be parsed from the URL string instead of machine output.
- [ ] PC-2 (2026-09-04) [build] /Users/roshan/Documents/DDD/Group Project/triathlon (npm install)
  npm install --save-exact oxlint timed out at 180s but actually completed: packages present in node_modules, package.json, and lockfile were all updated. The timeout report was misleading.
- [ ] PC-3 (2026-09-04) [api] triathlon (vinext + Next RSC)
  @phosphor-icons/react crashes vinext's RSC module runner ((0, import_react.createContext) is not a function) on Server Components. Use @tabler/icons-react instead - single-file ESM exports work fine. Also, after npm install/remove of icon packages, the Vite dep optimizer cache goes stale: must kill the dev server and rm -rf node_modules/.vite before restarting, or you get "file does not exist in deps_rsc" errors.
