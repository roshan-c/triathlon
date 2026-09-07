/**
 * Problem Details-style error envelope.
 *
 * Every error response shares one shape: HTTP status, stable domain code,
 * request ID, human message, and optional field errors. Fastify validation
 * errors are translated into the same envelope under VALIDATION_FAILED.
 */

import type { FastifyError, FastifyReply } from "fastify";
import { DomainError } from "../errors.js";

export interface ProblemBody {
  error: {
    status: number;
    code: string;
    message: string;
    requestId: string;
    fields?: Array<{ field: string; message: string }>;
  };
}

export function sendProblem(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  fields?: Array<{ field: string; message: string }>,
): FastifyReply {
  const error: ProblemBody["error"] = {
    status,
    code,
    message,
    requestId: reply.request.id,
  };
  if (fields !== undefined && fields.length > 0) {
    error.fields = fields;
  }
  return reply.status(status).send({ error });
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function fastifyValidationFields(
  error: FastifyError,
): Array<{ field: string; message: string }> | undefined {
  // SAFETY: only called when `error.validation` is present (guarded by the
  // error handler before invoking this helper).
  const validation = (error as { validation?: Array<{ instancePath: string; message: string }> })
    .validation;
  if (!validation || validation.length === 0) return undefined;
  return validation.map((v) => ({
    field: v.instancePath || "(body)",
    message: v.message ?? "invalid value",
  }));
}

/** Backing status for the SSE/streaming case where JSON is not applicable. */
export const INTERNAL_CODE = "INTERNAL";