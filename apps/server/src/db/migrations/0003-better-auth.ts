/** Core Better Auth tables, kept in the same SQLite database as the domain. */

import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

export const migration0003 = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    await sql`
      create table auth_users (
        id text primary key,
        name text not null,
        email text not null unique,
        emailVerified integer not null,
        image text,
        createdAt integer not null,
        updatedAt integer not null
      )
    `.execute(db);
    await sql`
      create table auth_sessions (
        id text primary key,
        expiresAt integer not null,
        token text not null unique,
        createdAt integer not null,
        updatedAt integer not null,
        ipAddress text,
        userAgent text,
        userId text not null references auth_users(id) on delete cascade
      )
    `.execute(db);
    await db.schema
      .createIndex("auth_sessions_user_idx")
      .on("auth_sessions")
      .column("userId")
      .execute();
    await sql`
      create table auth_accounts (
        id text primary key,
        accountId text not null,
        providerId text not null,
        userId text not null references auth_users(id) on delete cascade,
        accessToken text,
        refreshToken text,
        idToken text,
        accessTokenExpiresAt integer,
        refreshTokenExpiresAt integer,
        scope text,
        password text,
        createdAt integer not null,
        updatedAt integer not null
      )
    `.execute(db);
    await db.schema
      .createIndex("auth_accounts_user_idx")
      .on("auth_accounts")
      .column("userId")
      .execute();
    await sql`
      create table auth_verifications (
        id text primary key,
        identifier text not null,
        value text not null,
        expiresAt integer not null,
        createdAt integer not null,
        updatedAt integer not null
      )
    `.execute(db);
    await db.schema
      .createIndex("auth_verifications_identifier_idx")
      .on("auth_verifications")
      .column("identifier")
      .execute();
  },
  down: async (db: Kysely<unknown>): Promise<void> => {
    await db.schema.dropTable("auth_verifications").ifExists().execute();
    await db.schema.dropTable("auth_accounts").ifExists().execute();
    await db.schema.dropTable("auth_sessions").ifExists().execute();
    await db.schema.dropTable("auth_users").ifExists().execute();
  },
} satisfies Migration;
