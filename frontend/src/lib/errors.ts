import "server-only";

/** An error whose message is safe and useful to show to the person using the app. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Turns anything thrown in a Route Handler into a JSON response. Unknown errors are logged, not leaked. */
export function errorResponse(err: unknown, context: string): Response {
  if (err instanceof AppError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error(`${context} failed:`, err);
  return Response.json(
    { error: "Something went wrong on our side. Please retry.", code: "internal" },
    { status: 500 },
  );
}
