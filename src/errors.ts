export type HttpErrorKind = "host" | "timeout" | "network" | "status" | "redirect" | "parse" | "backoff";

export class HttpError extends Error {
  override readonly name = "HttpError";

  constructor(
    readonly kind: HttpErrorKind,
    readonly host: string,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

export type ApiSource = "uci" | "webtic";

export class ApiShapeError extends Error {
  override readonly name = "ApiShapeError";

  constructor(
    readonly source: ApiSource,
    message: string,
  ) {
    super(message);
  }
}

export class WebticError extends Error {
  override readonly name = "WebticError";

  constructor(
    readonly reasonCode: number | null,
    message: string,
  ) {
    super(message);
  }
}
