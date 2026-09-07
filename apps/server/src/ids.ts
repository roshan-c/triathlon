/**
 * Identifier generation: UUIDv7 for entity identifiers (canonical for writes
 * and relationships), opaque random tokens for secrets, and short codes for
 * manual entry (bootstrap, invitations, password reset).
 */

import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

export interface Ids {
  uuidv7(): string;
  /** 43-char base64url token, CSPRNG-backed. */
  token(): string;
  /** 12-char code over an unambiguous alphabet for manual entry. */
  code(): string;
}

export const realIds: Ids = {
  uuidv7: () => uuidv7(),
  token: () => randomBytes(32).toString("base64url"),
  code: () => {
    // 32 chars, no 0/O/1/I/L to keep manual entry unambiguous.
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(12);
    let out = "";
    for (const b of bytes) {
      out += alphabet[b % alphabet.length];
    }
    return out;
  },
};

/** Deterministic ids for tests. */
export function fixedIds(): Ids {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let n = 0;
  return {
    uuidv7: () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`,
    token: () => `token-${(n++).toString().padStart(8, "0")}`,
    code: () => {
      const v = n++;
      return alphabet.charAt(v % alphabet.length).repeat(12);
    },
  };
}