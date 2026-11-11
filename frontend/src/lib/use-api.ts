"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "@/lib/types";

type Result<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "ready"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: string };

const LOADING = { status: "loading", data: undefined, error: undefined } as const;

/**
 * GET a JSON route. Refetches when `url` or any `deps` value changes (for
 * example the current persona id) and when `reload()` is called. A reload
 * keeps showing the previous data until the new response arrives.
 * Pass `null` as the url to wait.
 */
export function useApi<T>(url: string | null, deps: readonly unknown[] = []) {
  // Results are tagged with the request they answer, so a result for an old
  // url or persona is never shown for a new one.
  const key = url === null ? null : JSON.stringify([url, ...deps]);
  const [settled, setSettled] = useState<{ key: string; result: Result<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!url || !key) return;
    let cancelled = false;

    fetch(url)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (T & ApiError) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? "Something went wrong. Please retry.");
        return body as T;
      })
      .then((data) => {
        if (!cancelled) setSettled({ key, result: { status: "ready", data, error: undefined } });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setSettled({ key, result: { status: "error", data: undefined, error: err.message } });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const result: Result<T> = settled && settled.key === key ? settled.result : LOADING;
  return { ...result, reload };
}

/** A failed request: `message` is safe to show, `code` identifies the case. */
export class ApiRequestError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
  }
}

/** POST JSON and return the parsed body, or throw an ApiRequestError carrying the server's message. */
export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => null)) as (T & ApiError) | null;
  if (!res.ok || !data) {
    throw new ApiRequestError(data?.error ?? "Something went wrong. Please retry.", data?.code);
  }
  return data as T;
}
