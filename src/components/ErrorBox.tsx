import { ApiError } from "../api/client";

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? `HTTP ${error.status}: ${error.message}` : String(error);
  return <div className="error">{msg}</div>;
}
