import type { Classification, EmailClass, RawEmail, RedactedEmail } from "@/lib/contracts";
import { foldText, hasOrderRef, senderDisplayName, senderDomain } from "./text";

/**
 * Rules-based email classifier (issue #6). Deterministic, no LLM.
 * Order of checks: unwrap forwards -> phishing look-alikes (never receipts) -> marketing (never orders)
 * -> lifecycle event by subject, then body. Confidence < 0.7 means "ambiguous, needs review".
 *
 * Phishing checks read the From header domain, so classify the RawEmail when available:
 * redaction tokenizes addresses inside forwarded bodies, which hides the inner sender domain.
 */

type TransactionalClass = Exclude<EmailClass, "marketing" | "not_receipt">;

type ClassRule = { cls: TransactionalClass; subject: RegExp; body: RegExp };

/** Precedence order: the first matching rule wins when several match. All patterns run on folded text. */
const CLASS_RULES: readonly ClassRule[] = [
  {
    cls: "cancel",
    subject: /\bcancel(?:l)?(?:ed|ation)\b|\bcancelad[oa]\b|\bcancelacion\b/,
    body: /\b(?:order|pedido|purchase)\b[^.\n]{0,40}\b(?:has been |was |is |ha sido |fue )?(?:cancel(?:l)?ed|cancelad[oa])\b|\bwe(?:'ve| have) cancel(?:l)?ed\b|\bcancellation (?:is )?confirmed\b/,
  },
  {
    cls: "refund",
    subject:
      /^refund\b(?! request)|\brefund(?:ed| (?:issued|processed|complete|completed|confirmation|sent|on (?:its|the) way))\b|\byour refund\b|\bstore credit (?:issued|added)\b|\breembolso (?:emitido|procesado|realizado|confirmado)\b|\b(?:tu|su) reembolso\b/,
    body: /\brefund (?:of [$€£]?[\d,.]+ (?:usd |eur )?)?(?:has been |was |is being )?(?:issued|processed|completed|sent)\b|\bwe(?:'ve| have) (?:issued|processed) (?:a|your) refund\b|\bwe(?:'ve| have) refunded\b|\b(?:has|have) been refunded\b|\bstore credit (?:has been |was )?(?:issued|added)\b|\breembolso (?:de [$€£]?[\d,.]+ )?(?:ha sido |fue )?(?:emitido|procesado|realizado)\b|\bhemos (?:procesado|emitido) (?:tu|su) reembolso\b/,
  },
  {
    cls: "return_received",
    subject:
      /\breturn (?:has been |was )?(?:received|processed|complete|completed|arrived)\b|\b(?:received|got) your return\b(?! request)|\bdevolucion (?:ha sido )?recibida\b|\bhemos recibido (?:tu|su) devolucion\b/,
    body: /\bwe(?:'ve| have)? (?:received|got) your return\b(?! request| label)|\b(?:your )?return (?:has been |was )?(?:received|checked in)\b|\breturn has arrived\b|\bhemos recibido (?:tu|su) devolucion\b|\bdevolucion (?:ha sido )?recibida\b/,
  },
  {
    cls: "return_started",
    subject:
      /\breturn (?:label|request|started|initiated|authorized|approved|created|confirmation|instructions|dropped off|in transit|on its way)\b|\breturn\b[^.\n]{0,60}\b(?:has |have |was |is )(?:been )?(?:started|initiated|created|approved|authorized|submitted|dropped off)\b|\bstart(?:ed)? (?:a|your) return\b|\brma\b|\bdevolucion (?:iniciada|solicitada|aprobada)\b|\b(?:etiqueta|solicitud) de devolucion\b/,
    body: /\byour return (?:request )?(?:has been |was |is )?(?:started|initiated|created|approved|authorized|submitted)\b|\byour return\b[^.\n]{0,60}\b(?:has |have |was |is )(?:been )?(?:started|initiated|created|approved|authorized|submitted|dropped off)\b|\bwe(?:'ve| have) (?:created|started|initiated|opened|approved|authorized) (?:a|your) return\b|\b(?:print|download|attached)[^.\n]{0,20}return label\b|\breturn label (?:has been |was |is )?(?:attached|ready|below|created)\b|\bwe(?:'ve| have) received your return request\b|\breturn request (?:has been |was |is )?(?:received|approved|accepted)\b|\bdropped off your return\b|\b(?:tu|su) devolucion (?:ha sido )?(?:iniciada|solicitada|aprobada)\b/,
  },
  {
    cls: "price_adjust",
    subject: /\bprice (?:adjustment|protection|match)\b|\bajuste de precio\b/,
    body: /\bprice adjustment (?:of [$€£]?[\d,.]+ )?(?:has been |was )?(?:issued|applied|processed|credited|approved)\b|\bwe(?:'ve| have) (?:issued|applied) a price adjustment\b|\bajuste de precio (?:aplicado|emitido)\b/,
  },
  {
    cls: "delivered",
    subject: /(?<!(?:will|to|should|would|can|may) be )\bdelivered\b|(?<!sera )\bentregad[oa]\b/,
    body: /\b(?:has been|was|were) delivered\b|(?<!be )\bdelivered (?:on|at|to)\b|\b(?:ha sido|fue) entregad[oa]\b/,
  },
  {
    cls: "shipped",
    subject:
      /\bshipped\b|\bshipping confirmation\b|\bshipment\b|\bon (?:its|the) way\b|\bout for delivery\b|\bin transit\b|\benviad[oa]\b|\ben camino\b/,
    body: /\b(?:has|have|was|were) (?:been )?shipped\b|\bout for delivery\b|\btracking (?:number|#)\s*:|\bon (?:its|the) way\b|\b(?:ha sido|fue) enviad[oa]\b|\ben camino\b/,
  },
  {
    cls: "order",
    subject:
      /\border (?:(?:is |has been )?confirmed|confirmation|received|placed|summary|details)\b|\bthanks? (?:you )?for (?:your )?(?:order|purchase|shopping)\b|\breceipt\b|\binvoice\b|\bpayment (?:received|confirmation|sent|receipt)\b|\bsubscription (?:renewed|renewal)\b|\bconfirmacion (?:de|del) (?:(?:tu|su) )?(?:pedido|compra)\b|\bpedido (?:confirmado|recibido)\b|\bgracias por tu (?:pedido|compra)\b|\brecibo\b|\bfactura\b/,
    body: /\bthanks? (?:you )?for (?:your )?(?:order|purchase)\b|\border (?:confirmed|confirmation|summary)\b|\bwe(?:'ve| have) received your order\b|\border total\b|\bgracias por tu (?:pedido|compra)\b|\bresumen del pedido\b|\bpedido confirmado\b|\bpayment (?:received|confirmation)\b/,
  },
];

/** Real shipping evidence. Bare transit wording ("on its way", "en camino") is not enough on its own. */
const STRONG_SHIPPING_EVIDENCE =
  /\bshipped\b|\bshipping confirmation\b|\bshipment\b|\bout for delivery\b|\bin transit\b|\btracking (?:number|#|id|link)\b|\btrack (?:your|my) (?:package|shipment|order)\b|\bcarrier\s*:|\b(?:ups|usps|fedex|dhl)\b|\benviad[oa]\b|\bnumero de (?:seguimiento|rastreo)\b/;

/** Order-confirmation wording; with an order number and an order total or items list it outranks transit wording. */
const ORDER_CONFIRMATION_WORDING =
  /\border (?:(?:is |has been )?confirmed|confirmation|received|placed)\b|\bthanks? (?:you )?for (?:your )?(?:order|purchase)\b|\bwe(?:'ve| have) received your order\b|\byour order (?:has been |was |is )?(?:placed|confirmed)\b|\bconfirmacion (?:de|del) (?:(?:tu|su) )?(?:pedido|compra)\b|\bpedido (?:confirmado|recibido)\b|\bgracias por tu (?:pedido|compra)\b/;
const ORDER_TOTAL_OR_ITEMS = /\border total\b|\bsubtotal\b|\bgrand total\b|^[ \t]*items\b|\bresumen del pedido\b/m;

/** Concrete purchase details, not promotional headings such as "Items you might like". */
// ":" or "|": table-aware HTML-to-text (#116) renders label/value cells as "Order total | $134.45".
const PURCHASE_TOTAL = /\b(?:order total|subtotal|grand total|total(?: paid)?|total del pedido)\s*[:|]?\s*(?:[a-z]{3}\s*)?[$€£]?\s*\d/;
const ITEM_QUANTITY = /\b(?:qty|quantity)\s*:?\s*\d|\bx\s*\d|\b\d+\s*x\b/;
const ITEM_PRICE = /[$€£]\s*\d|\b\d[\d,.]*\s*(?:usd|eur|gbp|cad|mxn)\b/;

const RETURN_CLASSES: ReadonlySet<TransactionalClass> = new Set(["return_started", "return_received"]);

const PROMO_PATTERNS: readonly RegExp[] = [
  /\bunsubscribe\b|\bdarse de baja\b|\bcancelar (?:la )?suscripcion\b/,
  /\d+\s?% off\b/,
  /(?<!final )\b(?:sale|clearance)\b/,
  /\bshop (?:now|the)\b|\bcompra ahora\b/,
  /\blimited[- ]time\b/,
  /\bpromo code\b|\buse code\b|\bcoupon\b/,
  /\bnew arrivals\b/,
  /\bdon'?t miss\b/,
  /\bexclusive (?:offer|deal|access)\b/,
  /\bview (?:this email )?in (?:your )?browser\b/,
  /\bprice drop\b|\bprices? (?:just )?dropped\b/,
  /\bback in stock\b/,
  /\bends (?:tonight|today|soon|sunday|at midnight)\b/,
  /\b(?:oferta|ofertas|descuento|rebajas)\b/,
  /\bdeals?\b/,
];

/** Urgent account/card verification language typical of phishing "receipts". */
const URGENT_VERIFICATION_PATTERNS: readonly RegExp[] = [
  /\bverify (?:your )?(?:card|account|identity|payment|billing)\b/,
  /\bconfirm (?:your )?(?:card|account|billing|payment) (?:details|information|info)\b/,
  /\b(?:account|card) (?:has been |is |was )?(?:suspended|locked|on hold|restricted|disabled)\b/,
  /\bunusual (?:activity|sign-in)\b/,
  /\bupdate (?:your )?(?:payment|billing) (?:information|details|method)\b/,
  /\b(?:click|tap) (?:here|below|the link) to (?:verify|confirm|restore|unlock)\b/,
  /\benter your (?:card|password|pin|cvv)\b/,
  /\bverifi(?:que|ca) (?:su|tu) (?:cuenta|tarjeta)\b/,
];

/** Display-name words that are not brands. */
const GENERIC_NAME_WORDS = new Set([
  "team", "your", "customer", "customers", "service", "services", "support", "orders", "order", "store",
  "shop", "shopping", "receipts", "receipt", "noreply", "reply", "notifications", "notification", "info",
  "hello", "from", "with", "help", "care", "updates", "mail", "online", "official", "account", "accounts",
  "billing", "security", "alert", "alerts", "shipping", "returns", "refunds", "the",
]);

const SECURITY_HYPHEN_DOMAIN =
  /(?:^|[.-])(?:secure|security|verify|verification|account|accounts|login|signin|alert|alerts|support)-|-(?:secure|security|verify|verification|account|accounts|login|signin|alert|alerts|support)(?:[.-]|$)/;

const LEET_MAP: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t" };

const FORWARD_MARKER =
  /^[ \t>]*(?:-{2,}\s*(?:forwarded message|mensaje reenviado|original message|mensaje original)\s*-{2,}|begin forwarded message:)[ \t]*$/im;
const FORWARD_HEADER = /^[ \t>]*(from|de|subject|asunto|date|fecha|sent|to|para|cc):[ \t]*(.*)$/i;
const FORWARD_SUBJECT_PREFIX = /^\s*(?:(?:fwd?|fw|rv)\s*:\s*)+/i;

/** The message actually being classified: the inner message for forwards. */
type EmailView = {
  from: string;
  subject: string;
  text: string;
  forwarded: boolean;
  /** False when the real sender is unknown (forward without inner From, or a redacted inner address). */
  senderKnown: boolean;
};

function unwrapForward(email: RawEmail | RedactedEmail): EmailView {
  const marker = FORWARD_MARKER.exec(email.text);
  const strippedSubject = email.subject.replace(FORWARD_SUBJECT_PREFIX, "");
  if (!marker) {
    const forwarded = strippedSubject !== email.subject;
    return { from: email.from, subject: strippedSubject, text: email.text, forwarded, senderKnown: !forwarded };
  }

  const lines = email.text.slice(marker.index + marker[0].length).split("\n");
  const headers: Partial<Record<string, string>> = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const header = FORWARD_HEADER.exec(lines[i]);
    if (header) {
      headers[header[1].toLowerCase()] = header[2].trim();
      bodyStart = i + 1;
    } else if (lines[i].trim() !== "" || Object.keys(headers).length > 0) {
      break;
    }
  }

  const innerFrom = headers.from ?? headers.de;
  const innerSubject = headers.subject ?? headers.asunto;
  return {
    from: innerFrom ?? email.from,
    subject: innerSubject ?? strippedSubject,
    text: lines.slice(bodyStart).join("\n"),
    forwarded: true,
    senderKnown: innerFrom !== undefined && senderDomain(innerFrom) !== null,
  };
}

/** Brand-like words from the display name, e.g. "Northwind Outfitters" -> ["northwind", "outfitters"]. */
function brandWords(from: string): string[] {
  const name = senderDisplayName(from);
  if (!name) return [];
  return foldText(name)
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word));
}

type Suspicion = { score: number; reasons: string[] };

/** Phishing look-alike signals. Score >= 2 is phishing; 1 is suspicious (never a receipt class). */
function assessSuspicion(view: EmailView, foldedAll: string): Suspicion {
  const reasons: string[] = [];
  let score = 0;

  if (URGENT_VERIFICATION_PATTERNS.some((pattern) => pattern.test(foldedAll))) {
    score += 2;
    reasons.push("urgent card/account verification language");
  }

  const domain = view.senderKnown ? senderDomain(view.from) : null;
  if (!domain) return { score, reasons };

  const labels = domain.split(".").slice(0, -1).join(".");
  const lettersOnly = labels.replace(/[^a-z]/g, "");
  const deleeted = labels.replace(/[013457]/g, (digit) => LEET_MAP[digit]).replace(/[^a-z]/g, "");
  const brands = brandWords(view.from);

  const spoofedBrand = brands.find((word) => !lettersOnly.includes(word) && deleeted.includes(word));
  if (spoofedBrand || (brands.length === 0 && /[a-z][013457][a-z]/.test(labels))) {
    score += 2;
    reasons.push(`look-alike sender domain ${domain}`);
  } else if (brands.length > 0 && !brands.some((word) => lettersOnly.includes(word))) {
    score += 1;
    reasons.push(`sender domain ${domain} does not match "${senderDisplayName(view.from)}"`);
  }

  if (SECURITY_HYPHEN_DOMAIN.test(labels)) {
    score += 1;
    reasons.push(`security-themed sender domain ${domain}`);
  }

  return { score, reasons };
}

function promoScore(foldedAll: string): number {
  return PROMO_PATTERNS.filter((pattern) => pattern.test(foldedAll)).length;
}

function matchingClasses(text: string, field: "subject" | "body"): TransactionalClass[] {
  return CLASS_RULES.filter((rule) => rule[field].test(text)).map((rule) => rule.cls);
}

type Verdict = { cls: EmailClass; confidence: number; reason: string };

/**
 * Drops "shipped" hits that are not a shipment: transit wording in a return email describes the package going back,
 * and bare "on its way" in an order confirmation (order number + total/items + confirmation wording) is a greeting.
 */
function dropNonShipmentHits(
  subjectHits: TransactionalClass[],
  bodyHits: TransactionalClass[],
  foldedAll: string,
  orderRef: boolean,
): { subjectHits: TransactionalClass[]; bodyHits: TransactionalClass[] } {
  const returnEvent = [...subjectHits, ...bodyHits].some((hit) => RETURN_CLASSES.has(hit));
  const orderConfirmation =
    orderRef && ORDER_CONFIRMATION_WORDING.test(foldedAll) && ORDER_TOTAL_OR_ITEMS.test(foldedAll);
  const notShipment = returnEvent || (orderConfirmation && !STRONG_SHIPPING_EVIDENCE.test(foldedAll));
  if (!notShipment) return { subjectHits, bodyHits };
  const keep = (hit: TransactionalClass) => hit !== "shipped";
  return { subjectHits: subjectHits.filter(keep), bodyHits: bodyHits.filter(keep) };
}

/** Lifecycle class from subject first (strongest signal), then body. */
function classifyTransactional(subject: string, body: string, orderRef: boolean): Verdict | null {
  const { subjectHits, bodyHits } = dropNonShipmentHits(
    matchingClasses(subject, "subject"),
    matchingClasses(body, "body"),
    `${subject}\n${body}`,
    orderRef,
  );

  if (subjectHits.length > 0) {
    const cls = subjectHits[0];
    const conflicting = subjectHits.filter((hit) => hit !== cls && hit !== "order").length > 0;
    const confidence = conflicting ? 0.8 : bodyHits.includes(cls) ? 0.95 : 0.9;
    return { cls, confidence, reason: `subject matches ${cls}` };
  }

  const bodyEvent = bodyHits.find((hit) => hit !== "order");
  if (bodyEvent) {
    const conflicting = bodyHits.filter((hit) => hit !== bodyEvent && hit !== "order").length > 0;
    return { cls: bodyEvent, confidence: conflicting ? 0.65 : 0.75, reason: `body matches ${bodyEvent}` };
  }

  const subjectRef = hasOrderRef(subject);
  const bodyOrder = bodyHits.includes("order");
  if (subjectRef || bodyOrder) {
    const confidence = subjectRef && bodyOrder ? 0.85 : subjectRef ? 0.8 : 0.75;
    const reason = subjectRef ? "order number in subject" : "body matches order";
    return { cls: "order", confidence, reason };
  }

  if (orderRef) {
    return { cls: "order", confidence: 0.6, reason: "order number but no lifecycle wording" };
  }
  return null;
}

function decide(view: EmailView): Verdict {
  const subject = foldText(view.subject);
  const body = foldText(view.text);
  const foldedAll = `${subject}\n${body}`;

  const suspicion = assessSuspicion(view, foldedAll);
  if (suspicion.score >= 2) {
    return {
      cls: "not_receipt",
      confidence: suspicion.score >= 3 ? 0.95 : 0.9,
      reason: `phishing look-alike: ${suspicion.reasons.join("; ")}`,
    };
  }

  const orderRef = hasOrderRef(foldedAll);
  const promo = promoScore(foldedAll);
  const subjectHits = matchingClasses(subject, "subject");
  const bodyHits = matchingClasses(body, "body");
  // A past order number (or "thanks for your order" in an offer) is not proof
  // of a new purchase. Preserve real confirmations and lifecycle events, including
  // terse confirmations with offer-heavy footers. Bare "on the way" is not shipping evidence.
  const lifecycleEvidence = [...subjectHits, ...bodyHits].some(
    (cls) => cls !== "order" && (cls !== "shipped" || STRONG_SHIPPING_EVIDENCE.test(foldedAll)),
  );
  const orderEvidence =
    (subjectHits.includes("order") && bodyHits.includes("order")) ||
    (ORDER_CONFIRMATION_WORDING.test(foldedAll) &&
      (PURCHASE_TOTAL.test(body) || (ITEM_QUANTITY.test(body) && ITEM_PRICE.test(body))));
  if (promo >= 2 && !lifecycleEvidence && !orderEvidence) {
    return { cls: "marketing", confidence: promo >= 3 ? 0.9 : 0.8,
      reason: `promotional language (${promo} signals), no transaction evidence` };
  }

  const transactional = classifyTransactional(subject, body, orderRef);
  if (transactional && suspicion.score === 1) {
    return {
      cls: "not_receipt",
      confidence: 0.55,
      reason: `looks like ${transactional.cls} but suspicious: ${suspicion.reasons.join("; ")}`,
    };
  }
  if (transactional) return transactional;

  if (promo >= 1) return { cls: "marketing", confidence: 0.6, reason: "promotional language, no receipt wording" };
  const mentionsMoney = /[$€£]\s?\d/.test(foldedAll);
  return mentionsMoney
    ? { cls: "not_receipt", confidence: 0.6, reason: "mentions amounts but no receipt wording" }
    : { cls: "not_receipt", confidence: 0.85, reason: "no receipt wording" };
}

/** Classifies one email into an EmailClass with a confidence and a short reason. */
export function classify(email: RedactedEmail | RawEmail): Classification {
  const view = unwrapForward(email);
  const verdict = decide(view);
  let { confidence, reason } = verdict;
  if (view.forwarded) {
    confidence -= view.senderKnown ? 0.05 : 0.15;
    reason = `forwarded${view.senderKnown ? "" : ", original sender unknown"}; ${reason}`;
  }
  return {
    emailId: email.id,
    class: verdict.cls,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    reason: reason.slice(0, 200),
  };
}
