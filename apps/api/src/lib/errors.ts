export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message = "Bad request") => new AppError(400, "BAD_REQUEST", message);
export const unauthorized = (message = "Not signed in") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Not allowed") => new AppError(403, "FORBIDDEN", message);
/** Prefer notFound over forbidden when revealing existence would leak information. */
export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message = "Conflict") => new AppError(409, "CONFLICT", message);
