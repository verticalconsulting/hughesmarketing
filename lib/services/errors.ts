export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, suggestions: string[] = []) {
    super("not_found", message, { suggestions });
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", message, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, field?: string) {
    super("validation", message, field ? { field } : {});
  }
}

export class ApprovalError extends DomainError {
  constructor(message: string) {
    super("approval_required", message);
  }
}
