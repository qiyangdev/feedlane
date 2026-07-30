export type ErrorCode =
  | "VALIDATION_ERROR"
  | "ROUTE_NOT_FOUND"
  | "UPSTREAM_NOT_FOUND"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_RESPONSE_ERROR"
  | "SERIALIZATION_ERROR"
  | "INTERNAL_ERROR";

export class FeedlaneError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends FeedlaneError {
  constructor(message = "The request is invalid.") {
    super("VALIDATION_ERROR", 400, message);
  }
}

export class RouteNotFoundError extends FeedlaneError {
  constructor() {
    super("ROUTE_NOT_FOUND", 404, "The requested feed route does not exist.");
  }
}

export class UpstreamNotFoundError extends FeedlaneError {
  constructor() {
    super("UPSTREAM_NOT_FOUND", 404, "The requested upstream resource was not found.");
  }
}

export class UpstreamRateLimitError extends FeedlaneError {
  constructor() {
    super("UPSTREAM_RATE_LIMITED", 429, "The upstream service rate limit was exceeded.");
  }
}

export class UpstreamResponseError extends FeedlaneError {
  constructor(
    message = "The upstream service returned an invalid response.",
    options?: ErrorOptions,
  ) {
    super("UPSTREAM_RESPONSE_ERROR", 502, message, options);
  }
}

export class SerializationError extends FeedlaneError {
  constructor(options?: ErrorOptions) {
    super("SERIALIZATION_ERROR", 500, "The feed could not be serialized.", options);
  }
}
