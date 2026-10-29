// Shared by every function that answers a browser: the CORS headers the
// platform expects and the one error type the top-level handler turns into a
// status code (lifted from four byte-identical copies), and the one way a
// function reads its request's body.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A body's fields under the names its contract (contracts.ts) gives them, none checked yet. */
export type Unchecked<T> = { [K in keyof T]?: unknown };

/**
 * The request's body as a JSON object, or a 400. Broken JSON, an empty body,
 * `null`, an array or a bare value used to reach a cast and come back as a 500.
 * Only the outer shape is checked here, so each field comes back `unknown`: it
 * is still the function's to check where it uses it.
 */
export async function readBody<T extends object>(req: Request): Promise<Unchecked<T>> {
  const body: unknown = await req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "That request couldn't be read.");
  }
  return body as Unchecked<T>;
}
