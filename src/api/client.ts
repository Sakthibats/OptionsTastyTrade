/**
 * Browser-side client. Every call goes to our own Worker at /api/tt/*, which
 * attaches the tastytrade access token server-side. The browser never sees the
 * OAuth client secret, refresh token, or access token.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | string[] | undefined>;

/** GET a tastytrade endpoint and unwrap its `{ data: ... }` envelope. */
export async function ttGet<T>(path: string, params?: Params): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined) continue;
    qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return getJson<T>(`/api/tt${path}${qs.size ? `?${qs}` : ""}`);
}

/** GET one of our own /api endpoints and unwrap `{ data: ... }`. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: unknown };

  if (!res.ok) {
    const msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error ?? res.statusText);
    throw new ApiError(res.status, msg);
  }
  return body.data as T;
}
