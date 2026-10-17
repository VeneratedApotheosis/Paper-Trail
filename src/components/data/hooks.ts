"use client";

// Client-side data hooks for the UI. These wrap the backend typed client
// (@/lib/api/client) so screens fetch live data instead of importing
// @/lib/mock/data. Each hook returns { data, error, loading, refetch }.
import { useEffect, useState } from "react";
import {
  getAudit,
  getFinding,
  getLedger,
  getOrder,
} from "@/lib/api/client";
import type {
  FindingResponse,
  LedgerResponse,
  OrderResponse,
} from "@/lib/api/types";
import type { AuditEntry } from "@/lib/types";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // fn is recreated each render; deps + nonce drive refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, refetch: () => setNonce((n) => n + 1) };
}

export function useLedger(): AsyncState<LedgerResponse> {
  return useAsync(() => getLedger(), []);
}

export function useOrder(id: string): AsyncState<OrderResponse> {
  return useAsync(() => getOrder(id), [id]);
}

export function useFinding(id: string): AsyncState<FindingResponse> {
  return useAsync(() => getFinding(id), [id]);
}

export function useAudit(): AsyncState<AuditEntry[]> {
  return useAsync(() => getAudit(), []);
}

export interface SessionStatus {
  connected: boolean;
  error?: string;
  reconnectUrl?: string;
}

// Gmail connection status (GET /api/auth/session). `connected: false` is normal
// in demo mode and is not an error.
export function useSession(): AsyncState<SessionStatus> {
  return useAsync(async () => {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as SessionStatus | null;
    return json ?? { connected: false };
  }, []);
}
