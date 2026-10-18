"use client";

// Data hook for the Promotions page (#131): GET /api/promotions through the shared cache. While Claude is still reading
// offer details (`enriching`) the list refreshes every few seconds, so rules-only cards fill in without a reload.
import { useEffect } from "react";
import { getPromotions } from "@/lib/api/client";
import type { PromotionsResponse } from "@/lib/api/types";
import { CACHE_KEYS } from "./cache";
import type { AsyncState } from "./useAsync";
import { useCached } from "./useCached";

export const PROMOTIONS_POLL_MS = 3000;

export function usePromotions(includeExpired: boolean): AsyncState<PromotionsResponse> {
  const state = useCached(includeExpired ? `${CACHE_KEYS.promotions}:expired` : CACHE_KEYS.promotions, () => getPromotions({ includeExpired }));
  const { data, refetch } = state;
  const enriching = data?.enriching === true;
  useEffect(() => {
    if (!enriching) return;
    const timer = setTimeout(refetch, PROMOTIONS_POLL_MS);
    return () => clearTimeout(timer);
  }, [enriching, data, refetch]);
  return state;
}