/**
 * Standalone Better Auth adapter. Authentication persistence and password
 * handling stay behind this interface; domain modules only deal in user IDs.
 */

import { betterAuth } from "better-auth";
import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import { domainError } from "./errors.js";
import type { Ids } from "./ids.js";

export interface AuthSession {
  userId: string;
  sessionId: string;
}

export interface CredentialSession extends AuthSession {
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface CredentialUserInput {
  id: string;
  email: string;
  name: string;
  password: string;
}

export interface AuthModule {
  handle(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<AuthSession | null>;
  createCredentialUser(input: CredentialUserInput): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  verifyPassword(userId: string, password: string): Promise<boolean>;
  updatePassword(userId: string, password: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  revokeSession(userId: string, sessionId: string): Promise<void>;
  findSession(token: string): Promise<CredentialSession | null>;
  signInCredentials(email: string, password: string): Promise<CredentialSession>;
  signIn(email: string, password: string, headers?: Headers): Promise<Response>;
}

export interface CreateAuthModuleOptions {
  database: Database.Database;
  config: Config;
  ids: Ids;
}

export function createAuthModule(opts: CreateAuthModuleOptions): AuthModule {
  const { config, ids } = opts;
  if (config.auth.secret === "replace-with-a-random-32-byte-secret") {
    throw domainError(
      "INVALID_STATE",
      "auth.secret must be replaced with a high-entropy value before serving",
    );
  }
  const baseURL = config.baseUrl ?? `http://localhost:${config.port}`;
  const auth = betterAuth({
    appName: "Triathlon",
    baseURL,
    secret: config.auth.secret,
    database: opts.database,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 200,
    },
    user: { modelName: "auth_users" },
    session: {
      modelName: "auth_sessions",
      expiresIn: config.session.ttlDays * 86_400,
      updateAge: 86_400,
    },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/change-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: config.session.secure,
      generateId: () => ids.uuidv7(),
      cookies: {
        session_token: {
          name: config.session.cookieName,
          attributes: {
            httpOnly: true,
            sameSite: "lax",
            secure: config.session.secure,
            path: "/",
          },
        },
      },
    },
    telemetry: { enabled: false },
  });

  const context = () => auth.$context;

  return {
    handle: (request) => auth.handler(request),
    getSession: async (headers) => {
      const result = await auth.api.getSession({ headers });
      if (!result) return null;
      return { userId: result.user.id, sessionId: result.session.id };
    },
    createCredentialUser: async (input) => {
      const ctx = await context();
      const user = await ctx.internalAdapter.createUser({
        id: input.id,
        email: input.email,
        name: input.name,
        emailVerified: false,
      });
      try {
        const password = await ctx.password.hash(input.password);
        await ctx.internalAdapter.createAccount({
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password,
        });
      } catch (cause) {
        await ctx.internalAdapter.deleteUser(user.id).catch(() => undefined);
        throw cause;
      }
    },
    deleteUser: async (userId) => {
      const ctx = await context();
      await ctx.internalAdapter.deleteUser(userId);
    },
    verifyPassword: async (userId, password) => {
      const ctx = await context();
      const account = await ctx.internalAdapter.findAccountByProviderId(userId, "credential");
      if (!account?.password) return false;
      return ctx.password.verify({ password, hash: account.password });
    },
    updatePassword: async (userId, password) => {
      const ctx = await context();
      const passwordHash = await ctx.password.hash(password);
      await ctx.internalAdapter.updatePassword(userId, passwordHash);
      await ctx.internalAdapter.deleteSessions(userId);
    },
    revokeSessions: async (userId) => {
      const ctx = await context();
      await ctx.internalAdapter.deleteSessions(userId);
    },
    revokeSession: async (userId, sessionId) => {
      const ctx = await context();
      const sessions = await ctx.internalAdapter.listSessions(userId);
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (session) await ctx.internalAdapter.deleteSession(session.token);
    },
    findSession: async (token) => {
      const ctx = await context();
      const result = await ctx.internalAdapter.findSession(token);
      if (!result) return null;
      return {
        userId: result.session.userId,
        sessionId: result.session.id,
        token: result.session.token,
        createdAt: result.session.createdAt.toISOString(),
        expiresAt: result.session.expiresAt.toISOString(),
      };
    },
    signInCredentials: async (email, password) => {
      const result = await auth.api.signInEmail({
        body: { email, password, rememberMe: true },
      });
      if (!("token" in result) || !result.token) {
        throw domainError("INVALID_CREDENTIALS", "Invalid email or password");
      }
      const session = await (await context()).internalAdapter.findSession(result.token);
      if (!session) throw domainError("AUTH_REQUIRED", "Session was not created");
      return {
        userId: session.session.userId,
        sessionId: session.session.id,
        token: session.session.token,
        createdAt: session.session.createdAt.toISOString(),
        expiresAt: session.session.expiresAt.toISOString(),
      };
    },
    signIn: (email, password, headers) =>
      auth.api.signInEmail({
        body: { email, password, rememberMe: true },
        headers,
        asResponse: true,
      }),
  };
}
