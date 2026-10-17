# PaperTrail JSON API (issues #4, #31)

Page-independent backend for the ledger UI. All routes are Next.js route handlers in `src/app/api/**`
(Node runtime, never cached), return JSON only, and answer bad input with a 4xx `{ error, details? }` body.
Response types live in `src/lib/api/types.ts`; data shapes are the canonical contracts from `@/lib/contracts`
(`NormalizedOrder`, `Finding`) and `@/lib/types` (`AuditEntry`, `OwedSummary`).

State is an in-memory session store (`src/lib/store`, kept on `globalThis`); restarting the server empties it.
Raw email bodies are never stored: only orders, findings, drafts, the review queue and the audit log.

| Method + path | Request | Response (200) | Errors |
|---|---|---|---|
| `POST /api/demo` | none | `PipelineRunResponse` `{ mode: "demo", asOf, summary, stats }` | |
| `DELETE /api/demo` | none | `{ mode: "empty" }` (audit log kept) | 409 when the ledger holds non-demo data |
| `GET /api/ledger` | none | `LedgerResponse` `{ mode, asOf, orders, findings, summary, reviewQueue, excludedMerchants, stats, labels }` | |
| `GET /api/orders/:id` | id URL-encoded (`encodeURIComponent`) | `{ order, findings }` | 400 empty id, 404 unknown / excluded |
| `GET /api/findings/:id` | id URL-encoded | `{ finding, order }` | 400, 404 |
| `POST /api/upload` | `multipart/form-data`, one or more `.eml` / `.mbox` files (any field name), 5 MB total | `UploadResponse` = `PipelineRunResponse` (`mode: "upload"`) + `{ files: [{ name, emails }], parseErrors: [{ file, index, reason }] }` | 400 no files / wrong type / nothing parseable, 413 too large |
| `GET /api/prefilter` | none | `{ query, description, windowDays }` (exact Gmail search + plain-language text) | |
| `GET /api/audit` | none | `{ entries: AuditEntry[] }`, newest first | |
| `POST /api/delete-all` | none | `{ deleted: true, ok: true, at, revokedToken, purged: { orders, findings, drafts, reviewItems, audit } }` | |
| `POST /api/merchants/exclude` | `{ merchant: string }` (name or domain, case-insensitive) | `{ excludedMerchants: string[] }` | 400 invalid JSON / body |
| `DELETE /api/merchants/exclude` | `{ merchant: string }` | `{ excludedMerchants: string[] }` | 400 |

Notes:
- `mode` is `"empty" | "demo" | "upload" | "gmail"`. Show `labels.demo` ("Demo data — synthetic") on every page while
  `mode === "demo"`, and `labels.simulatedPrice` on findings with `simulated: true`.
- `labels.precomputedExtraction` is non-null when extractions came from seed gold labels instead of an LLM
  (demo mode without a committed `seed/llm-cache.json`); show it with the demo banner.
- `summary` is `computeOwedSummary(findings, orders)` from `src/lib/view.ts`: needs-review orders are excluded from
  `owedTotal` (AGENTS.md rule 7).
- `reviewQueue` items are `{ emailId, stage: "classify" | "extract" | "match", reason, orderId? }`: uncertain
  classifications that were not extracted, failed / invalid / low-confidence extractions, and orders that need review.
- Excluded merchants are hidden from every response (ledger, orders, findings, review queue) until re-included.
- Delete-all purges orders, findings, drafts, review queue, extraction cache, exclusions and the audit log, keeping
  one `delete` audit record. OAuth revocation is a hook (`setRevokeOAuthHook` in `src/lib/store`) that #3 registers;
  until then `revokedToken` is `false`.
- Audit `llm_call` entries carry model, `redactedTokenCount` (= number of PII tokens redaction replaced in that email)
  and token counts in `detail`; never email text. Demo-mode gold extractions are logged with `model: "gold"` and
  "Precomputed extraction from seed gold label, no LLM call".
- Uploads use real extraction (`ANTHROPIC_API_KEY`) with a session cache; without a key, cache misses land in the
  review queue instead of failing. Uploads replace the current ledger.

## Pipeline

`runPipeline` (`src/lib/pipeline/run.ts`) is shared by demo, upload and (later) Gmail sync:
`isReceiptLike` (demo/upload only) → `classify` (raw email, for phishing detection) → `redact` → extractor on the
redacted email (marketing / not_receipt are never extracted) → `matchOrders` → `runRules(defaultRules)`.
Demo mode (`loadSeedDemo` in `src/lib/demo`) runs `seed/inbox.json` with `now = asOf` and the simulated seed
price feed, fully offline: recorded LLM output from `seed/llm-cache.json` when present, otherwise gold labels.

## Swapping the UI from mocks to the API

The client in `src/lib/api/client.ts` returns the same shapes as `@/lib/mock/data`, but asynchronously, and throws
`ApiError` (`status`, `body.error`) on non-2xx:

| Mock (`@/lib/mock/data`) | Client (`@/lib/api/client`) |
|---|---|
| `orders`, `findings`, `owedSummary()` | `const { orders, findings, summary, mode, labels } = await getLedger()` |
| `getOrder(id)` | `(await getOrder(id)).order` (+ `.findings`) |
| `getFinding(id)` | `(await getFinding(id)).finding` (+ `.order`) |
| `auditLog` | `await getAudit()` |
| `DEMO_LABEL`, `SIMULATED_PRICE_LABEL` | `labels.demo`, `labels.simulatedPrice` from `getLedger()` |
| (none) | `loadDemo()`, `resetDemo()`, `uploadFiles(files)`, `getPrefilter()`, `deleteAll()`, `excludeMerchant(name)`, `includeMerchant(name)` |

```ts
// before
import { findings, orders, owedSummary } from "@/lib/mock/data";
// after (client component)
import { ApiError, getLedger } from "@/lib/api/client";
const ledger = await getLedger(); // ledger.orders, ledger.findings, ledger.summary
```

Drafts (`getDraftForFinding`) are served by the claims routes (#17), not by this API.
