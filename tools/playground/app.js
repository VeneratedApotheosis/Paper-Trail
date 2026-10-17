// PaperTrail dev playground (issue #34). Vanilla JS, no build step. Talks to the Next API through the
// playground server's /api proxy. Untrusted text (emails, API errors) is only ever set via textContent.
"use strict";

// ---------------------------------------------------------------------------------------------------------------
// DOM + fetch helpers

const $ = (id) => document.getElementById(id);

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
}

/** el("td", { class: "num", onclick: fn }, "text", childNode) */
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}

function render(container, ...children) {
  container.replaceChildren();
  append(container, children);
}

class ApiError extends Error {
  constructor(status, body) {
    super(body && body.error ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function api(path, init) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }
  if (!response.ok) throw new ApiError(response.status, json);
  return json;
}

const jsonInit = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Shows the API error verbatim (status, `error`, and `details` when present). */
function showError(id, error) {
  const box = $(id);
  if (!error) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  const lines = [error instanceof ApiError ? `HTTP ${error.status}: ${error.message}` : String(error.message || error)];
  if (error instanceof ApiError && error.body && error.body.details !== undefined) {
    lines.push(JSON.stringify(error.body.details, null, 2));
  }
  box.hidden = false;
  box.textContent = lines.join("\n");
}

async function guarded(errorId, fn) {
  showError(errorId, null);
  try {
    return await fn();
  } catch (error) {
    showError(errorId, error);
    return undefined;
  }
}

function money(amount, currency) {
  if (typeof amount !== "number") return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : "—");
const pct = (value) => (typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—");
const badge = (text, cls) => el("span", { class: `badge ${cls || ""}` }, text);
const check = (ok, okText, badText) =>
  el("p", { class: ok ? "ok-text" : "bad-text" }, ok ? `✓ ${okText}` : `✗ BUG: ${badText}`);

function kv(entries) {
  return el(
    "dl",
    { class: "kv" },
    entries.filter(([, value]) => value !== undefined).map(([key, value]) => [el("dt", {}, key), el("dd", {}, value ?? "—")]),
  );
}

function table(headers, rows) {
  return el(
    "table",
    {},
    el("thead", {}, el("tr", {}, headers.map((header) => el("th", { class: header.endsWith("#") ? "num" : "" }, header.replace(/#$/, ""))))),
    el("tbody", {}, rows),
  );
}

function emptyNote(text) {
  return el("p", { class: "muted" }, text);
}

// ---------------------------------------------------------------------------------------------------------------
// State, tabs, status

const state = {
  ledger: null,
  status: null,
  /** Findings + orders produced in the Email lab (not in the store), offered on the Claims tab. */
  labPairs: [],
};

function selectTab(name) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  for (const section of document.querySelectorAll(".tab")) section.hidden = section.id !== `tab-${name}`;
  if (name === "claims") fillClaimFindings();
  if (name === "trust") refreshAudit();
}

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
}

async function loadStatus() {
  const pill = $("api-status");
  try {
    state.status = await api("/api/debug/status");
    pill.textContent = state.status.llmConfigured
      ? `Claude key configured (${state.status.model})`
      : "No Claude key: live LLM disabled";
    $("lab-use-llm").disabled = !state.status.llmConfigured;
    $("claim-rephrase").disabled = !state.status.llmConfigured;
  } catch (error) {
    pill.textContent = `API unreachable: ${error.message}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Ledger tab

function latestStatus(order) {
  const events = [...(order.events || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return events.length ? events[events.length - 1].type : "ordered";
}

function simulatedLabel() {
  return (state.ledger && state.ledger.labels && state.ledger.labels.simulatedPrice) || "simulated";
}

function renderFinding(finding, order, options) {
  const explain = finding.explain || {};
  const dates = Array.isArray(explain.dates) ? explain.dates : [];
  const lowConfidence = typeof explain.confidence === "number" && explain.confidence < 0.7;
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      {},
      badge(finding.kind),
      badge(finding.severity, finding.severity),
      finding.status !== "open" ? badge(finding.status) : null,
      finding.simulated ? badge(simulatedLabel(), "simulated") : null,
      order && order.needsReview ? badge("order needs review: not counted", "review") : null,
    ),
    el("div", { class: "amount" }, money(finding.amountAtStake, finding.currency)),
    el(
      "div",
      { class: "muted" },
      `${order ? order.merchant.name : finding.orderId} · ${order && order.orderRef ? order.orderRef : "no ref"} · due ${day(finding.dueAt)}`,
    ),
    el("p", {}, finding.summary),
    options && options.onDraft ? el("button", { class: "small", onclick: options.onDraft }, "Draft claim") : null,
    el(
      "details",
      {},
      el("summary", {}, "Why?"),
      kv([
        ["Summary", explain.summary || finding.summary],
        ["Rule", finding.ruleVersion],
        ["Dates", dates.length ? el("ul", {}, dates.map((entry) => el("li", {}, `${entry.label}: ${day(entry.value)}`))) : "—"],
        ["Source quote", explain.sourceQuote ? `“${explain.sourceQuote}”` : "—"],
        [
          "Confidence",
          typeof explain.confidence === "number"
            ? el("span", { class: lowConfidence ? "bad-text" : "" }, `${explain.confidence}${lowConfidence ? " (below 0.7, check)" : ""}`)
            : "—",
        ],
        ["Simulated", finding.simulated ? `yes: ${simulatedLabel()}` : "no"],
        [
          "Evidence",
          el("ul", {}, (finding.evidence || []).map((item) => el("li", {}, el("span", { class: "mono" }, item.messageId), ` “${item.quote}”`))),
        ],
      ]),
      el("pre", {}, JSON.stringify(explain, null, 2)),
    ),
  );
}

function excludedKeys() {
  return new Set(((state.ledger && state.ledger.excludedMerchants) || []).map((key) => key.toLowerCase()));
}

function renderLedger() {
  const ledger = state.ledger;
  if (!ledger) return;
  const orders = ledger.orders || [];
  const findings = ledger.findings || [];
  const orderById = new Map(orders.map((order) => [order.id, order]));

  render($("ledger-mode"), `mode: ${ledger.mode} · asOf: ${ledger.asOf || "—"}`);

  const notices = [];
  if (ledger.mode === "demo" && ledger.labels) notices.push(el("div", { class: "notice" }, ledger.labels.demo));
  if (ledger.labels && ledger.labels.precomputedExtraction) {
    notices.push(
      el("div", { class: "notice" }, "Precomputed extractions (seed gold labels, no LLM): ", ledger.labels.precomputedExtraction),
    );
  }
  if (ledger.stats) {
    const s = ledger.stats;
    notices.push(
      el(
        "p",
        { class: "muted" },
        `Pipeline: ${s.emails} emails, ${s.prefilteredOut} prefiltered out, ${s.extracted} extracted ` +
          `(llm ${s.extractionOrigins.llm}, cache ${s.extractionOrigins.cache}, gold ${s.extractionOrigins.gold}), ` +
          `${s.skipped} skipped, ${s.orders} orders, ${s.excludedOrders} excluded orders, ${s.findings} findings, ${s.needsReview} need review.`,
      ),
    );
  }
  render($("ledger-notices"), notices);

  // Summary + client-side cross-checks of the owed total (AGENTS.md rule 7) and merchant exclusions.
  const summary = ledger.summary;
  const counted = findings.filter((f) => f.status === "open" && orderById.has(f.orderId) && !orderById.get(f.orderId).needsReview);
  const recomputed = Math.round(counted.reduce((sum, f) => sum + f.amountAtStake, 0) * 100) / 100;
  const excluded = excludedKeys();
  const leaked = orders.filter(
    (order) => excluded.has(order.merchant.name.toLowerCase()) || (order.merchant.domain && excluded.has(order.merchant.domain.toLowerCase())),
  );
  render(
    $("ledger-summary"),
    el("div", {}, el("div", { class: "muted" }, "You're owed"), el("div", { class: "big" }, money(summary.owedTotal, summary.currency))),
    kv([
      ["Findings counted", String(summary.findingCount)],
      ["Excluded (needs review)", `${summary.excludedCount} · ${money(summary.excludedTotal, summary.currency)}`],
      ["Orders", String(orders.length)],
    ]),
    el(
      "div",
      {},
      check(
        Math.abs(recomputed - Math.round(summary.owedTotal * 100) / 100) < 0.005,
        "owed total = open findings on confirmed orders",
        `owed total ${summary.owedTotal} ≠ recomputed ${recomputed}`,
      ),
      check(leaked.length === 0, "no excluded merchant in the ledger", `excluded merchant still listed: ${leaked.map((o) => o.merchant.name).join(", ")}`),
    ),
  );

  render(
    $("ledger-orders"),
    orders.length
      ? table(
          ["Merchant", "Ref", "Placed", "Total#", "Status", "Review", "Conf#", "Findings#", ""],
          orders.map((order) =>
            el(
              "tr",
              {},
              el("td", {}, order.merchant.name, order.merchant.domain ? el("div", { class: "muted mono" }, order.merchant.domain) : null),
              el("td", { class: "mono" }, order.orderRef || "—"),
              el("td", {}, day(order.placedAt)),
              el("td", { class: "num" }, money(order.total, order.currency)),
              el("td", {}, latestStatus(order)),
              el("td", {}, order.needsReview ? badge("needs review", "review") : ""),
              el("td", { class: "num" }, order.confMin.toFixed(2)),
              el("td", { class: "num" }, String(findings.filter((f) => f.orderId === order.id).length)),
              el("td", {}, el("button", { class: "small", onclick: () => setMerchantExcluded(order.merchant.name, true) }, "Exclude merchant")),
            ),
          ),
        )
      : emptyNote("No orders. Load the demo or upload emails."),
  );

  const excludedList = ledger.excludedMerchants || [];
  render(
    $("ledger-excluded"),
    excludedList.length
      ? el(
          "ul",
          {},
          excludedList.map((merchant) =>
            el("li", {}, `${merchant} `, el("button", { class: "small", onclick: () => setMerchantExcluded(merchant, false) }, "Include again")),
          ),
        )
      : emptyNote("None."),
  );

  render(
    $("ledger-findings"),
    findings.length
      ? findings.map((finding) =>
          renderFinding(finding, orderById.get(finding.orderId), {
            onDraft: () => {
              selectTab("claims");
              $("claim-finding").value = `ledger:${finding.id}`;
              $("claim-open").click();
            },
          }),
        )
      : emptyNote("No findings."),
  );

  const review = ledger.reviewQueue || [];
  render(
    $("ledger-review"),
    review.length
      ? table(
          ["Email", "Stage", "Reason", "Order"],
          review.map((item) =>
            el("tr", {}, el("td", { class: "mono" }, item.emailId), el("td", {}, item.stage), el("td", {}, item.reason), el("td", { class: "mono" }, item.orderId || "")),
          ),
        )
      : emptyNote("Review queue is empty."),
  );
}

async function refreshLedger() {
  await guarded("ledger-error", async () => {
    state.ledger = await api("/api/ledger");
    renderLedger();
  });
}

async function setMerchantExcluded(merchant, exclude) {
  await guarded("ledger-error", async () => {
    await api("/api/merchants/exclude", jsonInit(exclude ? "POST" : "DELETE", { merchant }));
    await refreshLedger();
  });
}

$("ledger-refresh").addEventListener("click", refreshLedger);
$("ledger-load-demo").addEventListener("click", () =>
  guarded("ledger-error", async () => {
    await api("/api/demo", { method: "POST" });
    await refreshLedger();
  }),
);
$("ledger-reset-demo").addEventListener("click", () =>
  guarded("ledger-error", async () => {
    await api("/api/demo", { method: "DELETE" });
    await refreshLedger();
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Upload tab

$("upload-send").addEventListener("click", () =>
  guarded("upload-error", async () => {
    const files = $("upload-files").files;
    const form = new FormData();
    for (const file of files) form.append("files", file);
    render($("upload-result"), emptyNote("Uploading…"));
    try {
      const result = await api("/api/upload", { method: "POST", body: form });
      const s = result.stats;
      render(
        $("upload-result"),
        el("h3", {}, `Ledger replaced (mode: ${result.mode})`),
        table(["File", "Emails#"], result.files.map((file) => el("tr", {}, el("td", {}, file.name), el("td", { class: "num" }, String(file.emails))))),
        result.parseErrors.length
          ? [
              el("h3", {}, "Parse errors (not processed)"),
              table(
                ["File", "Index#", "Reason"],
                result.parseErrors.map((e) => el("tr", {}, el("td", {}, e.file), el("td", { class: "num" }, String(e.index)), el("td", {}, e.reason))),
              ),
            ]
          : null,
        el("h3", {}, "Pipeline"),
        kv([
          ["Emails", String(s.emails)],
          ["Prefiltered out", String(s.prefilteredOut)],
          ["Classes", JSON.stringify(s.classes)],
          ["Extracted", `${s.extracted} (llm ${s.extractionOrigins.llm}, cache ${s.extractionOrigins.cache}, gold ${s.extractionOrigins.gold})`],
          ["Skipped", String(s.skipped)],
          ["Orders", String(s.orders)],
          ["Findings", String(s.findings)],
          ["Needs review", String(s.needsReview)],
          ["Owed", money(result.summary.owedTotal, result.summary.currency)],
        ]),
        el("p", { class: "muted" }, "See the Ledger tab for orders, findings and the review queue."),
      );
    } catch (error) {
      render($("upload-result"));
      throw error;
    } finally {
      await refreshLedger();
    }
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Email lab

const TOKEN_SPLIT = /(\[(?:PAN|PHONE|ADDRESS|EMAIL)_\d+\])/;

function highlightTokens(text) {
  return el(
    "pre",
    {},
    String(text)
      .split(TOKEN_SPLIT)
      .map((part, index) => (index % 2 === 1 ? el("mark", { class: "token" }, part) : part)),
  );
}

/** Reads the X-PT-Expect header from the raw email headers (edge-case files). */
function readExpectation(raw) {
  const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0];
  const match = /^X-PT-Expect:[ \t]*(.*)$/im.exec(headerBlock);
  if (!match) return null;
  const pairs = {};
  for (const part of match[1].split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) pairs[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return pairs;
}

function compareExpectation(expect, result) {
  if (!expect) return null;
  const rows = [];
  if (expect.keep) rows.push(["prefilter keep", expect.keep, String(result.prefilter.keep)]);
  if (expect.class) rows.push(["class", expect.class, result.classification.class, expect.class.split("|").includes(result.classification.class)]);
  if (expect.redacts) {
    const actual = Object.entries(result.redaction.redactions)
      .filter(([, count]) => count > 0)
      .map(([kind]) => kind)
      .sort();
    const wanted = expect.redacts === "none" ? [] : expect.redacts.split(",").map((kind) => kind.trim()).sort();
    rows.push(["redacts", expect.redacts, actual.join(",") || "none", actual.join(",") === wanted.join(",")]);
  }
  if (expect.contains) rows.push(["body contains", expect.contains, result.email.text.includes(expect.contains) ? "yes" : "no", result.email.text.includes(expect.contains)]);
  return el(
    "div",
    { class: "stage" },
    el("h3", {}, "X-PT-Expect vs actual"),
    table(
      ["Check", "Expected", "Actual", ""],
      rows.map(([name, wanted, actual, ok]) => {
        const pass = ok === undefined ? wanted === actual : ok;
        return el("tr", {}, el("td", {}, name), el("td", { class: "mono" }, wanted), el("td", { class: "mono" }, actual), el("td", {}, pass ? badge("pass", "ok") : badge("FAIL", "bad")));
      }),
    ),
  );
}

function renderExtraction(stage) {
  if (stage.status !== "ok") {
    const label = { skipped: "Skipped", needs_review: "Needs review (invalid after retry)", error: "Error" }[stage.status];
    return el("p", { class: stage.status === "skipped" ? "muted" : "bad-text" }, `${label}: ${stage.reason}`);
  }
  const extraction = stage.extraction;
  const fieldNames = Object.keys(extraction.fields);
  return [
    kv([
      ["Model", extraction.model],
      ["Cached", extraction.cached ? "yes (no LLM call)" : "no"],
      ["confMin", el("span", { class: extraction.confMin < 0.7 ? "bad-text" : "" }, `${extraction.confMin}${extraction.confMin < 0.7 ? " (needs review)" : ""}`)],
    ]),
    table(
      ["Field", "Value", "Confidence#", "Evidence"],
      fieldNames.map((name) =>
        el(
          "tr",
          {},
          el("td", {}, name),
          el("td", { class: "mono" }, JSON.stringify(extraction.fields[name])),
          el("td", { class: "num" }, extraction.confidence[name] !== undefined ? String(extraction.confidence[name]) : ""),
          el("td", {}, extraction.evidence[name] ? `“${extraction.evidence[name]}”` : ""),
        ),
      ),
    ),
  ];
}

function renderLabResult(result, raw) {
  const { email, prefilter, classification, redaction } = result;
  const orderById = new Map(result.orders.map((order) => [order.id, order]));
  state.labPairs = result.findings.map((finding) => ({ finding, order: orderById.get(finding.orderId) }));
  render(
    $("lab-result"),
    compareExpectation(readExpectation(raw), result),
    el(
      "div",
      { class: "stage" },
      el("h3", {}, "1. Parsed email"),
      kv([
        ["Id", email.id],
        ["From", email.from],
        ["To", email.to || "—"],
        ["Subject", email.subject],
        ["Date", email.date],
        ["Body", `${email.text.length} characters`],
      ]),
      el("details", {}, el("summary", {}, "Decoded plain-text body"), el("pre", {}, email.text || "(empty)")),
    ),
    el(
      "div",
      { class: "stage" },
      el("h3", {}, "2. Prefilter (isReceiptLike)"),
      el("p", {}, prefilter.keep ? badge("keep", "ok") : badge("drop", "bad"), prefilter.reason),
    ),
    el(
      "div",
      { class: "stage" },
      el("h3", {}, "3. Classification (on the raw email)"),
      el(
        "p",
        {},
        badge(classification.class),
        ` confidence ${classification.confidence}`,
        classification.confidence < 0.7 ? badge("below 0.7: review", "review") : null,
      ),
      el("p", { class: "muted" }, classification.reason || ""),
    ),
    el(
      "div",
      { class: "stage" },
      el("h3", {}, "4. Redaction (what an LLM would see)"),
      kv(Object.entries(redaction.redactions).map(([kind, count]) => [kind, String(count)]).concat([["textHash", el("span", { class: "mono" }, redaction.textHash)]])),
      el("div", { class: "muted" }, "Subject"),
      highlightTokens(redaction.subject),
      el("div", { class: "muted" }, "Body"),
      highlightTokens(redaction.text || "(empty)"),
    ),
    el("div", { class: "stage" }, el("h3", {}, "5. Extraction"), renderExtraction(result.extraction)),
    result.audit.length
      ? el(
          "div",
          { class: "stage" },
          el("h3", {}, "Audit rows written"),
          table(
            ["At", "Type", "Model", "PII tokens#", "Detail"],
            result.audit.map((entry) =>
              el("tr", {}, el("td", {}, entry.at), el("td", {}, entry.type), el("td", {}, entry.model || ""), el("td", { class: "num" }, String(entry.redactedTokenCount ?? "")), el("td", {}, entry.detail)),
            ),
          ),
        )
      : null,
    el(
      "div",
      { class: "stage" },
      el("h3", {}, `6. Match + rules at ${result.now}`),
      result.extraction.status !== "ok"
        ? emptyNote("Not run: needs a successful extraction.")
        : [
            result.orders.map((order) =>
              kv([
                ["Order", `${order.merchant.name} · ${order.orderRef || "no ref"}`],
                ["Placed", day(order.placedAt)],
                ["Total", money(order.total, order.currency)],
                ["Status", latestStatus(order)],
                ["Needs review", order.needsReview ? badge("yes: findings suppressed", "review") : "no"],
                ["Policy", JSON.stringify(order.merchant.policy)],
              ]),
            ),
            result.findings.length
              ? result.findings.map((finding) =>
                  renderFinding(finding, orderById.get(finding.orderId), {
                    onDraft: () => {
                      selectTab("claims");
                      $("claim-finding").value = `lab:${finding.id}`;
              $("claim-open").click();
                    },
                  }),
                )
              : emptyNote("No findings for this single email at this time."),
          ],
    ),
  );
}

function toLocalInputValue(date) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

async function loadEdgeCaseList() {
  try {
    const { files } = await api("/edge-cases/index.json");
    for (const file of files) $("lab-case").append(el("option", { value: file }, file));
  } catch {
    // The list is a convenience; pasting still works.
  }
}

$("lab-case").addEventListener("change", () =>
  guarded("lab-error", async () => {
    const name = $("lab-case").value;
    if (!name) return;
    const response = await fetch(`/edge-cases/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status})`);
    $("lab-raw").value = await response.text();
    const expect = readExpectation($("lab-raw").value);
    render($("lab-expect"), expect ? `X-PT-Expect: ${Object.entries(expect).map(([k, v]) => `${k}=${v}`).join("; ")}` : "");
    render($("lab-result"));
  }),
);

$("lab-run").addEventListener("click", () =>
  guarded("lab-error", async () => {
    const raw = $("lab-raw").value;
    const nowValue = $("lab-now").value;
    const body = { raw, useLlm: $("lab-use-llm").checked };
    if (nowValue) body.now = new Date(nowValue).toISOString();
    render($("lab-result"), emptyNote("Running…"));
    try {
      renderLabResult(await api("/api/debug/pipeline", jsonInit("POST", body)), raw);
    } catch (error) {
      render($("lab-result"));
      throw error;
    }
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Claims tab

function claimChoices() {
  const ledger = state.ledger;
  const orderById = new Map(((ledger && ledger.orders) || []).map((order) => [order.id, order]));
  const choices = ((ledger && ledger.findings) || []).map((finding) => ({
    key: `ledger:${finding.id}`,
    finding,
    order: orderById.get(finding.orderId),
  }));
  for (const pair of state.labPairs) choices.push({ key: `lab:${pair.finding.id}`, finding: pair.finding, order: pair.order, lab: true });
  return choices;
}

function fillClaimFindings() {
  const select = $("claim-finding");
  const current = select.value;
  const choices = claimChoices();
  select.replaceChildren(
    ...(choices.length ? [] : [el("option", { value: "" }, "(no findings: load the demo on the Ledger tab)")]),
    ...choices.map((choice) =>
      el(
        "option",
        { value: choice.key },
        `${choice.lab ? "(lab) " : ""}${choice.finding.kind} · ${choice.order ? choice.order.merchant.name : choice.finding.orderId} · ${money(choice.finding.amountAtStake, choice.finding.currency)}`,
      ),
    ),
  );
  if (choices.some((choice) => choice.key === current)) select.value = current;
}

$("claim-reload").addEventListener("click", async () => {
  await refreshLedger();
  fillClaimFindings();
});

function selectedClaimChoice() {
  const choice = claimChoices().find((candidate) => candidate.key === $("claim-finding").value);
  if (!choice) throw new Error("Pick a finding first (load the demo on the Ledger tab, or run the Email lab).");
  if (!choice.order) throw new Error(`Order ${choice.finding.orderId} is not in the ledger (excluded or deleted?).`);
  return choice;
}

function claimOptions() {
  const options = { rephrase: $("claim-rephrase").checked };
  const profileName = $("claim-profile").value.trim();
  const supportEmail = $("claim-support").value.trim();
  if (profileName) options.profileName = profileName;
  if (supportEmail) options.supportEmail = supportEmail;
  return options;
}

const claimPath = (findingId) => `/api/claims/${encodeURIComponent(findingId)}`;

function handOff(clipboardText, mailtoUrl) {
  const copyButton = el("button", {}, "Copy");
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(clipboardText);
      copyButton.textContent = "Copied";
    } catch {
      copyButton.textContent = "Copy failed (select the text manually)";
    }
  });
  return el(
    "div",
    { class: "toolbar" },
    copyButton,
    el("a", { href: mailtoUrl, class: "button-link" }, "Open mailto"),
    el("span", { class: "muted" }, "mailto only opens your own mail client; PaperTrail never sends email."),
  );
}

/**
 * Renders a draft. `mode` is "ledger" (editable, approve via /api/claims) or "lab" (debug route, hand-off right away).
 * `extra` carries { rephrase, handoff: { clipboardText, mailtoUrl } }.
 */
function renderClaim(choice, draft, mode, extra) {
  const amountText = money(choice.finding.amountAtStake, choice.finding.currency);
  const recipientInput = el("input", { type: "email", size: "40" });
  recipientInput.value = draft.recipient || "";
  const subjectInput = el("input", { size: "70" });
  subjectInput.value = draft.subject;
  const bodyInput = el("textarea", { rows: "16", spellcheck: "false" });
  bodyInput.value = draft.body;
  const handOffSlot = el("div", {}, extra.handoff ? handOff(extra.handoff.clipboardText, extra.handoff.mailtoUrl) : null);

  const ledgerActions =
    mode === "ledger"
      ? el(
          "div",
          { class: "toolbar" },
          el(
            "button",
            {
              onclick: () =>
                guarded("claim-error", async () => {
                  const edited = await api(
                    claimPath(choice.finding.id),
                    jsonInit("PUT", { subject: subjectInput.value, body: bodyInput.value, recipient: recipientInput.value.trim() }),
                  );
                  renderClaim(choice, edited.draft, mode, {});
                }),
            },
            "Save edits",
          ),
          el(
            "button",
            {
              class: "primary",
              onclick: () =>
                guarded("claim-error", async () => {
                  const approved = await api(`${claimPath(choice.finding.id)}/approve`, { method: "POST" });
                  renderClaim(choice, approved.draft, mode, {
                    handoff: { clipboardText: approved.clipboardText, mailtoUrl: approved.mailtoUrl },
                  });
                  await refreshLedger();
                }),
            },
            "Approve",
          ),
          el("span", { class: "muted" }, "Approve records your consent (audit row) and unlocks Copy / mailto. Unsaved edits are not approved."),
        )
      : el("p", { class: "muted" }, "Email-lab finding: drafted by /api/debug/claim, not stored, no approval record.");

  render(
    $("claim-result"),
    el(
      "div",
      {},
      mode === "ledger" ? badge(draft.approvedAt ? `approved ${draft.approvedAt}` : "not approved", draft.approvedAt ? "ok" : "review") : badge("lab"),
      draft.edited ? badge("edited", "review") : null,
      draft.rephrased ? badge("rephrased by Claude", "ok") : null,
    ),
    kv([
      ["To", el("span", {}, recipientInput, " ", draft.recipientVerified ? badge("verified", "ok") : badge("guessed: confirm before sending", "review"))],
      ["Subject", subjectInput],
      ["Signed", draft.signedName],
    ]),
    bodyInput,
    check(draft.body.includes(amountText), `body cites the finding amount ${amountText}`, `body does not contain the finding amount ${amountText}`),
    ledgerActions,
    handOffSlot,
    el("h3", {}, "Facts (must appear verbatim)"),
    table(["Label", "Value", "In body"], draft.facts.map((fact) => el("tr", {}, el("td", {}, fact.label), el("td", { class: "mono" }, fact.value), el("td", {}, draft.body.includes(fact.value) ? badge("yes", "ok") : badge("MISSING", "bad"))))),
    draft.warnings.length ? [el("h3", {}, "Warnings"), el("ul", {}, draft.warnings.map((warning) => el("li", {}, warning)))] : null,
    draft.note ? el("p", { class: "muted" }, `Note: ${draft.note}`) : null,
    extra.rephrase
      ? el("p", { class: extra.rephrase.rephrased ? "ok-text" : "muted" }, extra.rephrase.rephrased ? "Rephrased by Claude (fact-checked)." : `Rephrase not used: ${extra.rephrase.reason}`)
      : null,
  );
}

async function draftLabClaim(choice) {
  const result = await api("/api/debug/claim", jsonInit("POST", { finding: choice.finding, order: choice.order, ...claimOptions() }));
  renderClaim(choice, result.draft, "lab", {
    rephrase: result.rephrase,
    handoff: { clipboardText: result.clipboard, mailtoUrl: result.mailto },
  });
}

$("claim-open").addEventListener("click", () =>
  guarded("claim-error", async () => {
    const choice = selectedClaimChoice();
    render($("claim-result"), emptyNote("Loading draft…"));
    if (choice.lab) return draftLabClaim(choice);
    const result = await api(claimPath(choice.finding.id));
    renderClaim(choice, result.draft, "ledger", {});
  }),
);

$("claim-regenerate").addEventListener("click", () =>
  guarded("claim-error", async () => {
    const choice = selectedClaimChoice();
    render($("claim-result"), emptyNote("Regenerating…"));
    if (choice.lab) return draftLabClaim(choice);
    const result = await api(claimPath(choice.finding.id), jsonInit("POST", claimOptions()));
    renderClaim(choice, result.draft, "ledger", { rephrase: { rephrased: result.rephrased, reason: result.reason } });
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Trust & eval tab

async function refreshAudit() {
  await guarded("audit-error", async () => {
    const { entries } = await api("/api/audit");
    const counts = {};
    for (const entry of entries) counts[entry.type] = (counts[entry.type] || 0) + 1;
    render(
      $("audit-log"),
      el("p", { class: "muted" }, `${entries.length} entries (newest first): ${Object.entries(counts).map(([type, n]) => `${type} ${n}`).join(", ") || "none"}`),
      entries.length
        ? table(
            ["At", "Type", "Detail", "Model", "PII tokens#", "Cost#"],
            entries.map((entry) =>
              el(
                "tr",
                {},
                el("td", { class: "mono" }, entry.at),
                el("td", {}, entry.type),
                el("td", {}, entry.detail),
                el("td", {}, entry.model || ""),
                el("td", { class: "num" }, entry.redactedTokenCount !== undefined ? String(entry.redactedTokenCount) : ""),
                el("td", { class: "num" }, entry.cost !== undefined ? String(entry.cost) : ""),
              ),
            ),
          )
        : null,
    );
  });
}

$("audit-refresh").addEventListener("click", refreshAudit);

$("delete-all").addEventListener("click", () =>
  guarded("delete-error", async () => {
    if (!window.confirm("Delete everything? This purges orders, findings, drafts, the review queue, the extraction cache, exclusions and the audit log.")) return;
    const result = await api("/api/delete-all", { method: "POST" });
    const ledger = await api("/api/ledger");
    const { entries } = await api("/api/audit");
    state.ledger = ledger;
    state.labPairs = [];
    renderLedger();
    const leftovers = {
      orders: ledger.orders.length,
      findings: ledger.findings.length,
      reviewQueue: ledger.reviewQueue.length,
      excludedMerchants: (ledger.excludedMerchants || []).length,
      auditBesidesDelete: entries.filter((entry) => entry.type !== "delete").length,
    };
    const empty = Object.values(leftovers).every((count) => count === 0) && ledger.mode === "empty";
    render(
      $("delete-result"),
      kv([
        ["deleted / ok", `${result.deleted} / ${result.ok}`],
        ["At", result.at],
        ["OAuth token revoked", String(result.revokedToken)],
        ["Purged", Object.entries(result.purged).map(([key, n]) => `${key} ${n}`).join(", ")],
        ["Ledger after", `mode ${ledger.mode}; ${Object.entries(leftovers).map(([key, n]) => `${key} ${n}`).join(", ")}`],
      ]),
      check(empty, "everything is gone (only the delete audit record remains)", `data remains after delete-all: ${JSON.stringify(leftovers)}`),
    );
    await refreshAudit();
  }),
);

function findingModeRow(report) {
  return el(
    "tr",
    {},
    el("td", {}, report.label || report.mode),
    el("td", { class: "num" }, String(report.expected)),
    el("td", { class: "num" }, String(report.actual)),
    el("td", { class: "num" }, String(report.truePositives)),
    el("td", { class: "num" }, pct(report.precision)),
    el("td", { class: "num" }, pct(report.recall)),
    el("td", { class: "num" }, pct(report.f1)),
  );
}

function findingMisses(report) {
  return el(
    "details",
    {},
    el("summary", {}, `${report.label || report.mode}: ${report.falseNegatives.length} missed, ${report.falsePositives.length} unexpected`),
    el("pre", {}, JSON.stringify({ falseNegatives: report.falseNegatives, falsePositives: report.falsePositives }, null, 2)),
  );
}

$("eval-run").addEventListener("click", () =>
  guarded("eval-error", async () => {
    render($("eval-result"), emptyNote("Running eval…"));
    const report = await api("/api/eval");
    const classification = report.classification;
    const realistic = report.findings.realisticRouting;
    // Same thresholds as src/lib/eval/gate.test.ts.
    const gates = [
      ["Realistic-routing finding recall ≥ 0.90", realistic.recall >= 0.9, pct(realistic.recall)],
      ["Realistic-routing finding precision ≥ 0.95", realistic.precision >= 0.95, pct(realistic.precision)],
      ["No phishing/marketing routed as an order", classification.safety.phishingOrMarketingAsOrder === 0, String(classification.safety.phishingOrMarketingAsOrder)],
      ["15-email holdout set", report.counts.holdout === 15, String(report.counts.holdout)],
    ];
    render(
      $("eval-result"),
      kv([
        ["Synthetic", String(report.synthetic)],
        ["asOf", report.asOf],
        ["Emails", `${report.counts.emails} (dev ${report.counts.dev}, holdout ${report.counts.holdout})`],
        ["Classifier", report.sources.classifier],
        ["Extraction", report.sources.extraction],
        ["Price feed", report.sources.priceFeed],
      ]),
      el("h3", {}, "Gate"),
      table(["Check", "Value", ""], gates.map(([name, ok, value]) => el("tr", {}, el("td", {}, name), el("td", { class: "num" }, value), el("td", {}, ok ? badge("PASS", "ok") : badge("FAIL", "bad"))))),
      el("h3", {}, "Classifier by split"),
      table(
        ["Split", "Total#", "Correct#", "Accuracy#", "Macro F1#"],
        Object.entries(classification.splits).map(([split, m]) =>
          el("tr", {}, el("td", {}, split), el("td", { class: "num" }, String(m.total)), el("td", { class: "num" }, String(m.correct)), el("td", { class: "num" }, pct(m.accuracy)), el("td", { class: "num" }, pct(m.macroF1))),
        ),
      ),
      el(
        "p",
        {},
        `Phishing/marketing routed as order: ${classification.safety.phishingOrMarketingAsOrder}`,
        classification.safety.phishingOrMarketingAsOrderEmails.length ? ` (${classification.safety.phishingOrMarketingAsOrderEmails.join(", ")})` : "",
        ` · non-receipt routed to extraction: ${classification.safety.nonReceiptRoutedToExtraction}`,
      ),
      classification.misclassified.length
        ? el(
            "details",
            {},
            el("summary", {}, `${classification.misclassified.length} misclassified emails (${report.split})`),
            table(
              ["Email", "Holdout", "Gold", "Predicted", "Conf#", "Reason"],
              classification.misclassified.map((m) =>
                el("tr", {}, el("td", { class: "mono" }, m.emailId), el("td", {}, m.holdout ? "yes" : ""), el("td", {}, m.gold), el("td", {}, m.predicted), el("td", { class: "num" }, String(m.confidence)), el("td", {}, m.reason || "")),
              ),
            ),
          )
        : null,
      el("h3", {}, "Extraction"),
      el("p", {}, report.extraction.status === "ok" ? `Scored (${report.extraction.source})` : `Not run: ${report.extraction.reason}`),
      el("h3", {}, "Findings (full inbox)"),
      table(["Mode", "Expected#", "Actual#", "TP#", "Precision#", "Recall#", "F1#"], [findingModeRow(report.findings.oracleExtraction), findingModeRow(realistic)]),
      findingMisses(report.findings.oracleExtraction),
      findingMisses(realistic),
    );
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Boot

$("lab-now").value = toLocalInputValue(new Date());
loadStatus();
loadEdgeCaseList();
refreshLedger();
