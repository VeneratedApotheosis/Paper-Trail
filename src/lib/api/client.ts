import type { AuditEntry } from "@/lib/types";
import type {
  ApiErrorBody,
  AuditResponse,
  DeleteAllResponse,
  FindingResponse,
  LedgerResponse,
  MerchantExcludeResponse,
  OrderResponse,
  PipelineRunResponse,
  PrefilterResponse,
  ResetDemoResponse,
  UploadResponse,
} from "./types";

/**
 * Typed browser client for the PaperTrail JSON API (docs/api.md). The UI imports this instead of
 * `@/lib/mock/data`; every function returns the contract shapes and throws ApiError on a non-2xx response.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = json !== null && typeof json === "object" && "error" in json ? (json as ApiErrorBody) : null;
    throw new ApiError(response.status, body);
  }
  return json as T;
}

function sendJson(method: "POST" | "DELETE", body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function getLedger(): Promise<LedgerResponse> {
  return request("/api/ledger");
}

export function getOrder(id: string): Promise<OrderResponse> {
  return request(`/api/orders/${encodeURIComponent(id)}`);
}

export function getFinding(id: string): Promise<FindingResponse> {
  return request(`/api/findings/${encodeURIComponent(id)}`);
}

export function loadDemo(): Promise<PipelineRunResponse> {
  return request("/api/demo", { method: "POST" });
}

export function resetDemo(): Promise<ResetDemoResponse> {
  return request("/api/demo", { method: "DELETE" });
}

/** Uploads .eml / .mbox files (5 MB total) and replaces the ledger with the parsed result. */
export function uploadFiles(files: Iterable<File>): Promise<UploadResponse> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return request("/api/upload", { method: "POST", body: form });
}

export function getPrefilter(): Promise<PrefilterResponse> {
  return request("/api/prefilter");
}

/** Audit log, newest first. */
export async function getAudit(): Promise<AuditEntry[]> {
  const body = await request<AuditResponse>("/api/audit");
  return body.entries;
}

export function deleteAll(): Promise<DeleteAllResponse> {
  return request("/api/delete-all", { method: "POST" });
}

export function excludeMerchant(merchant: string): Promise<MerchantExcludeResponse> {
  return request("/api/merchants/exclude", sendJson("POST", { merchant }));
}

export function includeMerchant(merchant: string): Promise<MerchantExcludeResponse> {
  return request("/api/merchants/exclude", sendJson("DELETE", { merchant }));
}
