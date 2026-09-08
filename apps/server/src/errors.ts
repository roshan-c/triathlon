/**
 * Domain errors with stable codes, HTTP mapping, and the Problem Details-style
 * envelope used by the HTTP adapter.
 *
 * Codes are part of the public API contract: clients switch on them, they
 * never change meaning, and new codes are additive only.
 */

export const HTTP_STATUS: Record<string, number> = Object.freeze({
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  SUSPENDED: 403,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INVALID_STATE: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ACTIVE_SPRINT_EXISTS: 409,
  BOOTSTRAP_CLOSED: 409,
  INVALID_CODE: 400,
  CODE_EXPIRED: 400,
  EMAIL_EXISTS: 409,
  CYCLE_DETECTED: 409,
  ALREADY_EXISTS: 409,
  WORKFLOW_CONFIRMATION_REQUIRED: 409,
  SPRINT_COMPLETED: 409,
  REQUEST_TOO_LARGE: 413,
  RATE_LIMITED: 429,
});

export type DomainCode = keyof typeof HTTP_STATUS;

export interface FieldError {
  field: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: DomainCode;
  readonly status: number;
  readonly fields?: FieldError[];

  constructor(code: DomainCode, message: string, fields?: FieldError[]) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = HTTP_STATUS[code] ?? 500;
    this.fields = fields;
  }
}

export function domainError(
  code: DomainCode,
  message: string,
  fields?: FieldError[],
): DomainError {
  return new DomainError(code, message, fields);
}

export function validationError(
  message: string,
  fields: FieldError[],
): DomainError {
  return new DomainError("VALIDATION_FAILED", message, fields);
}
