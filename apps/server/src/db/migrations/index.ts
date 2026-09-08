import { migration0001 } from "./0001-init.js";
import { migration0002 } from "./0002-permanent-activity.js";
import { migration0003 } from "./0003-better-auth.js";
import { migration0004 } from "./0004-rate-limits.js";

export const MIGRATIONS = {
  "0001-init": migration0001,
  "0002-permanent-activity": migration0002,
  "0003-better-auth": migration0003,
  "0004-rate-limits": migration0004,
} as const;

export const LATEST_MIGRATION = "0004-rate-limits";
