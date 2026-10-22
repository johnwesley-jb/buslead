/** Error type whose message is safe to show to the dashboard user. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) => new AppError(400, code, message, details)
export const unauthorized = (message = 'Your session has ended. Sign in again.') => new AppError(401, 'UNAUTHORIZED', message)
export const forbidden = (message = 'You do not have permission to do this.') => new AppError(403, 'FORBIDDEN', message)
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message)
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details)
