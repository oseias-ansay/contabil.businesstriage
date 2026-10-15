/** Cliente HTTP do frontend (usado pelo TanStack Query). */
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "include",
  });
  if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new HttpError(res.status, (data as { error?: string })?.error ?? "Erro", (data as { details?: unknown })?.details);
  return data as T;
}
