/** An error whose message is safe to show to the caller. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Server configuration is missing or invalid. The message names variables, never their values. */
export class ConfigError extends AppError {
  constructor(message: string) {
    super(503, 'CONFIG_ERROR', message);
    this.name = 'ConfigError';
  }
}

export const notFound = (what = 'Not found') => new AppError(404, 'NOT_FOUND', what);
export const conflict = (message: string, code = 'INVALID_TRANSITION') => new AppError(409, code, message);
export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'VALIDATION_ERROR', message, fields);
