/**
 * Fastify HTTP adapter: plugins, auth hook, error envelope, route
 * registration, and OpenAPI. One seam between HTTP and the four domain
 * modules; business rules never live here.
 */

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance, FastifyBaseLogger, RawServerDefault } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Config } from "../config.js";
import type { AuthModule } from "../auth.js";
import type { Clock } from "../time.js";
import type { Ids } from "../ids.js";
import type { RequestContext } from "../domain/context.js";
import type { IdentityService } from "../domain/identity.js";
import type { ProjectsService } from "../domain/projects.js";
import type { WorkService } from "../domain/work.js";
import type { PlanningService } from "../domain/planning.js";
import type { ProjectEventBus } from "../domain/events.js";
import { DomainError } from "../errors.js";
import { registerAuthHook } from "./auth.js";
import { fastifyValidationFields, sendProblem } from "./problem.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerKeysRoutes } from "./routes/keys.js";
import { registerProjectsRoutes } from "./routes/projects.js";
import { registerTicketsRoutes } from "./routes/tickets.js";
import { registerSprintsRoutes } from "./routes/sprints.js";
import { registerEventsRoute } from "./routes/events.js";

export type App = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export interface AppDeps {
  config: Config;
  clock: Clock;
  ids: Ids;
  serverVersion: string;
  identity: IdentityService;
  auth: AuthModule;
  projects: ProjectsService;
  work: WorkService;
  planning: PlanningService;
  bus: ProjectEventBus;
}

export async function buildApp(deps: AppDeps): Promise<App> {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "req.body.password",
          "req.body.currentPassword",
          "req.body.newPassword",
          "req.body.code",
        ],
        censor: "[redacted]",
      },
    },
    genReqId: () => deps.ids.uuidv7(),
    trustProxy: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cookie);
  await app.register(cors, {
    // An empty allowlist means same-origin deployment only; never turn an
    // omitted allowlist into credentialed CORS for every origin.
    origin: config.trustedOrigins.length > 0 ? config.trustedOrigins : false,
    credentials: true,
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Triathlon API",
        version: deps.serverVersion,
        description:
          "One public HTTP interface for all Triathlon clients. " +
          "Error responses share the Problem Details envelope with a stable domain code.",
      },
      servers: [{ url: config.baseUrl ?? `http://${config.host}:${config.port}` }],
      components: {
        securitySchemes: {
          bearerKey: { type: "http", scheme: "bearer" },
        },
      },
    },
  });
  if (config.docs.enabled) {
    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: false },
    });
  }

  registerAuthHook(app, { config, identity: deps.identity, auth: deps.auth });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return sendProblem(reply, error.status, error.code, error.message, error.fields);
    }
    // SAFETY: Fastify validation errors always carry `validation`; other
    // FastifyError shapes fall through to the generic branch below.
    const fastifyError = error as FastifyErrorLike;
    if (fastifyError.validation) {
      return sendProblem(
        reply,
        422,
        "VALIDATION_FAILED",
        fastifyError.message ?? "Request validation failed",
        // SAFETY: cast only adds the validation field used by the helper; the
        // shape is asserted by the `.validation` guard above.
        fastifyValidationFields(fastifyError as never),
      );
    }
    request.log.error({ err: error }, "unhandled error");
    return sendProblem(reply, 500, "INTERNAL", "Internal server error");
  });

  // OpenAPI JSON under /api/v1/openapi.json (registered before routes so
  // swagger can still see them; swagger collects routes at ready time).
  app.get("/api/v1/openapi.json", async (_request, reply) => {
    const doc = app.swagger();
    reply.header("content-type", "application/json").send(doc);
  });

  const authDeps = { config, identity: deps.identity, auth: deps.auth };
  registerAuthRoutes(app, authDeps);
  registerKeysRoutes(app, {
    serverVersion: deps.serverVersion,
    identity: deps.identity,
    projects: deps.projects,
  });
  registerProjectsRoutes(app, {
    identity: deps.identity,
    projects: deps.projects,
    work: deps.work,
  });
  registerTicketsRoutes(app, {
    work: deps.work,
    projects: deps.projects,
  });
  registerSprintsRoutes(app, {
    planning: deps.planning,
  });
  registerEventsRoute(app, {
    bus: deps.bus,
    work: deps.work,
  });

  return app;
}

interface FastifyErrorLike {
  validation?: Array<{ instancePath: string; message: string }>;
  message?: string;
}

export type { RequestContext };
