# Gmail sync backend (#38)

Uses the existing read-only OAuth session. No send/modify scopes, attachment fetches, bank data, or simulated price feed are used for Gmail sync.

## API

- `GET /api/gmail/preview`: requires the session cookie. Returns `{ query, estimatedMessages, messagesToFetch, countIsEstimate: true, windowDays: 90, maxMessages: 300 }`. Calls `messages.list` once with `maxResults=1`; never fetches message bodies. Google provides an estimate, not an exact count.
- `POST /api/gmail/sync`: requires the session cookie, same-origin submission, and JSON `{ "confirmed": true }`. Returns the existing `PipelineRunResponse` (`mode: "gmail"`, `asOf`, `summary`, `stats`) plus `{ fetched, capped, parseErrors: [{ id, reason }] }`. No raw messages or tokens are returned. `fetched` counts the IDs attempted, including messages that disappeared or could not be decoded.
- Read the resulting data through existing `/api/ledger`, `/api/orders/:id`, `/api/findings/:id`, `/api/audit`, and claim routes using the same browser session.

Show the preview before asking for sync confirmation. The backend requires confirmation but does not maintain a separate preview ticket. UI integration belongs to Alex (#25); this issue adds backend routes only. No real inbox was accessed by development/tests.

## Processing and errors

The query is the canonical `GMAIL_RECEIPT_QUERY`: last 90 days, receipt-like subjects/senders. Pagination deduplicates message IDs and stops at 300. Bodies use `messages.get?format=full`; nested MIME prefers plain text, converts HTML otherwise, and ignores attachments. A message's decoded text is capped at 1 MiB. Malformed or disappeared messages are reported by ID and a fixed reason; partial parse failures also enter the review queue. An all-malformed batch fails without replacing the existing ledger.

Messages pass through the shared classifier, redactor, validated/cached LLM extractor, order matcher, and deterministic rules. No raw bodies are persisted. Without an Anthropic key or cached extraction, eligible messages go to needs-review. No seed/gold extraction is substituted for real Gmail mail.

Every Gmail attempt is audited to the SQLite audit table and the account's API audit stream, using endpoint, message ID/query, and attempt number only. Fetches retry at most three attempts on network failures, rate limits (429 or recognized quota 403), and 5xx. Backoff honors Retry-After within the 10-second retry budget; longer waits return a retryable error. Full-message requests (60 quota units each; 6,000 units/user/min) use a token bucket: a burst of 10, then 1.4/s sustained (at most 94 per minute), with up to 2 in flight; nothing sleeps while under budget. Each email is analyzed as soon as it is fetched (up to 4 extractions in flight, results merged in listing order), so fetching and analysis overlap.

Errors are sanitized JSON with `code`: 401 (`token_expired`, reconnect at `/api/auth/google`), 403 (`gmail_access_denied` or cross-origin request), 409 (`sync_already_running`), 422 (`no_parseable_messages`), 429 (`gmail_rate_limited`), 502 (provider/response failures), or 503 (configuration/unavailable). A failed fetch batch does not replace the existing ledger. Abort stops fetching and prevents result publication; it is not a persistent resumable job.

## Account isolation and lifecycle

The store now supports an AsyncLocalStorage account scope keyed by the validated OAuth user ID. All ledger/data HTTP routes select the same account scope when a valid auth cookie is present. Anonymous demo/upload state remains separate. Invalid/deleted session cookies return 401 rather than falling back to another store. This keeps Gmail-derived orders, audit events, extraction caches, claims, and exclusions out of other accounts' responses.

Delete-all operates in that account scope, clears its derived data and credentials, and expires cookies. A running Gmail sync checks the session still exists before publishing, so deleted data cannot be repopulated by an old request. One Gmail sync runs per account per process. Derived data stays in process memory and disappears on restart; this is the existing development/demo storage model, not a durable multi-instance job system.

Sync currently runs in one HTTP request (Node runtime, up to 300 seconds where hosting supports it). The maximum batch can take several minutes, especially with live extraction. There is no SSE progress stream, persistent cursor, scheduled sync, or push notification in this task. A retry starts the search again; previously extracted redacted-text hashes can hit the account cache.

## Verification

Run `npm run lint`, `npm run typecheck`, and `npm test`. Gmail tests use synthetic responses, injected delays, and mocked credentials, never real accounts. Do not paste credential values, raw emails, or tokens into issues or test output.
