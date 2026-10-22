// Client-side API helper with consistent error handling.
// Error codes are stable machine identifiers; the UI maps them to localized
// messages via i18n (see locales/*/errors.json section "codes").
//
// Auth model (dual-mode):
// - Primary: httpOnly session cookie (same-site usage).
// - Fallback: Bearer token persisted in localStorage, sent via the
//   `Authorization` header on every request. This keeps the session alive in
//   contexts where browsers refuse SameSite cookies, e.g. when the app is
//   embedded in a cross-site iframe (sandbox preview panel).

export class ApiRequestError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---- Session token storage (iframe-safe fallback) ----

const TOKEN_KEY = "nexora-token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | undefined | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable — cookie auth may still work
  }
}

export function clearStoredToken(): void {
  setStoredToken(null);
}

export function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sp.set(key, value.join(","));
    } else if (typeof value === "boolean") {
      sp.set(key, value ? "true" : "false");
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(
  method: string,
  path: string,
  opts?: {
    query?: Record<string, unknown>;
    body?: unknown;
    workspaceId?: string;
  }
): Promise<T> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts?.workspaceId) headers["x-workspace-id"] = opts.workspaceId;

  const res = await fetch(`/api/v1${path}${buildQuery(opts?.query)}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });

  if (res.status === 204) return undefined as T;

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? "Request failed",
      err?.details
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>, workspaceId?: string) =>
    request<T>("GET", path, { query, workspaceId }),
  post: <T>(path: string, body?: unknown, workspaceId?: string) =>
    request<T>("POST", path, { body, workspaceId }),
  patch: <T>(path: string, body?: unknown, workspaceId?: string) =>
    request<T>("PATCH", path, { body, workspaceId }),
  put: <T>(path: string, body?: unknown, workspaceId?: string) =>
    request<T>("PUT", path, { body, workspaceId }),
  delete: <T>(path: string, query?: Record<string, unknown>, workspaceId?: string) =>
    request<T>("DELETE", path, { query, workspaceId }),
};

/**
 * Triggers a client-side file download via fetch so the `Authorization`
 * header is attached (plain navigation would drop it in iframe contexts).
 */
export async function downloadFile(path: string, query?: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(`/api/v1${path}${buildQuery(query)}`, {
      headers: { ...getAuthHeaders() },
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.error(`[download] failed with status ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i.exec(disposition);
    const fallbackName = path.split("/").filter(Boolean).pop() ?? "download";
    const filename = match?.[1]
      ? decodeURIComponent(match[1])
      : `${fallbackName}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[download] failed:", err);
  }
}
