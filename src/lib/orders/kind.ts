import { REVIEW_CONFIDENCE_THRESHOLD, type PurchaseKind } from "@/lib/contracts";
import { foldText } from "@/lib/ingestion/text";

/**
 * Purchase kind (#127), decided from rules first: merchant/domain tables for food delivery and travel, shipping
 * evidence, recurring billing, app stores, in-store merchants. The LLM's `kindGuess` is only a fallback and is ignored
 * when the order's extraction confidence is low (the kind is then "other"). Pure.
 */

interface MerchantTable {
  kind: PurchaseKind;
  /** Matches folded merchant names / sender display names. */
  names: RegExp;
  /** Registrable domains (subdomains match). */
  domains: readonly string[];
}

const FOOD_DELIVERY: MerchantTable = {
  kind: "food_delivery",
  names: /doordash|uber ?eats|grubhub|postmates|seamless|deliveroo|foodpanda|menulog|just ?eat|caviar|gopuff|優食|foodomo|ubereats/,
  domains: ["doordash.com", "ubereats.com", "grubhub.com", "postmates.com", "seamless.com", "deliveroo.com", "deliveroo.co.uk", "foodpanda.com", "foodpanda.com.tw", "menulog.com.au", "just-eat.com", "justeat.com", "caviar.com", "gopuff.com"],
};

const TRAVEL: MerchantTable = {
  kind: "travel",
  names: /airlines?|airways|\bair (?:canada|france|china|india|new zealand)\b|jetblue|southwest|spirit airlines|frontier airlines|lufthansa|emirates|qatar|cathay|eva air|長榮|china airlines|中華航空|starlux|星宇|tigerair|peach aviation|\bana\b|booking\.com|expedia|airbnb|hotels\.com|agoda|kayak|trip\.com|tripadvisor|marriott|hilton|hyatt|\bihg\b|amtrak|greyhound|flixbus|eurostar|trainline|lyft|uber trip|\bgrab\b|\bdidi\b|高鐵|台鐵|臺鐵|klook|kkday/,
  domains: ["booking.com", "expedia.com", "airbnb.com", "hotels.com", "agoda.com", "kayak.com", "trip.com", "tripadvisor.com", "marriott.com", "hilton.com", "hyatt.com", "ihg.com", "delta.com", "united.com", "aa.com", "southwest.com", "jetblue.com", "alaskaair.com", "lufthansa.com", "emirates.com", "evaair.com", "china-airlines.com", "starlux-airlines.com", "amtrak.com", "lyft.com", "thsrc.com.tw", "klook.com", "kkday.com", "flixbus.com", "eurostar.com"],
};

const DIGITAL: MerchantTable = {
  kind: "digital",
  names: /app store|itunes|google play|\bsteam\b|steam games|playstation|nintendo|eshop|xbox|microsoft store|epic games|humble bundle|itch\.io|kindle|audible|apple media services/,
  domains: ["itunes.com", "email.apple.com", "steampowered.com", "playstation.com", "nintendo.com", "xbox.com", "epicgames.com", "humblebundle.com", "itch.io", "googleplay.com"],
};

/** Convenience stores, coffee/fast-food chains and point-of-sale platforms: receipts of a purchase made in person. */
const IN_STORE: MerchantTable = {
  kind: "in_store",
  names: /7[- ]?eleven|統一超商|family ?mart|全家|hi-?life|萊爾富|starbucks|星巴克|mcdonald|麥當勞|costco|好市多|trader joe|walgreens|\bcvs\b|dunkin|7-11/,
  domains: ["squareup.com", "square.com", "toasttab.com", "clover.com", "spoton.com", "heartland.us", "upserve.com", "lightspeedhq.com", "sumup.com", "zettle.com", "izettle.com", "loyverse.com", "revelsystems.com", "transactcampus.com", "cbord.com", "atriumcampus.com", "touchnet.com", "nutrislice.com"],
};

/** Words that put an order in a subscription: renewals, recurring billing, per-period plans. */
const SUBSCRIPTION_TEXT =
  /subscription (?:renewed|renewal|receipt|confirmation|invoice|payment|has been)|your (?:\w+ ){0,3}subscription|auto-?renew|renews? (?:on|every|automatically)|recurring (?:payment|billing|charge)|(?:monthly|annual|yearly|weekly) (?:subscription|membership|plan|billing)|next (?:billing|renewal|payment) date|membership (?:fee|renewal)|訂閱|續訂|自動續約|月費|年費/;
const DIGITAL_TEXT = /\b(?:app store|itunes store|google play(?: store)?|steam wallet|playstation store|nintendo eshop)\b/;

function domainOf(candidate: string, domains: readonly string[]): boolean {
  return domains.some((domain) => candidate === domain || candidate.endsWith(`.${domain}`));
}

function tableMatches(table: MerchantTable, evidence: KindEvidence): boolean {
  return (
    evidence.names.some((name) => table.names.test(foldText(name))) ||
    evidence.domains.some((domain) => domainOf(domain.toLowerCase(), table.domains))
  );
}

export interface KindEvidence {
  /** Merchant names and sender display names seen in the order's emails. */
  names: readonly string[];
  /** Sender and extracted merchant domains. */
  domains: readonly string[];
  /** Folded subject + body of the order's emails (confirmations first). */
  text: string;
  /** A shipped / delivered email, a tracking number or a shipment status was seen. */
  shippingEvidence: boolean;
  /** Same merchant and same total again ~a month apart (decided across orders). */
  recurringCharge: boolean;
  /** What the extraction's subscription block says: an interval makes a subscription likely. */
  llmSubscriptionInterval: boolean;
  llmGuess: PurchaseKind | null;
  /** Lowest extraction confidence of the order. */
  confMin: number;
}

export interface KindDecision {
  kind: PurchaseKind;
  reason: string;
}

/** True for merchants that deliver restaurant food or book travel: their delivered / confirmed emails are not parcels. */
export function isFoodOrTravelMerchant(evidence: Pick<KindEvidence, "names" | "domains">): boolean {
  const full = { ...evidence, text: "", shippingEvidence: false, recurringCharge: false, llmSubscriptionInterval: false, llmGuess: null, confMin: 1 };
  return tableMatches(FOOD_DELIVERY, full) || tableMatches(TRAVEL, full);
}

/** Order of the rules matters: see the module comment. */
export function decideKind(evidence: KindEvidence): KindDecision {
  if (tableMatches(FOOD_DELIVERY, evidence)) return { kind: "food_delivery", reason: "known food-delivery merchant" };
  if (tableMatches(TRAVEL, evidence)) return { kind: "travel", reason: "known travel merchant" };
  if (evidence.shippingEvidence) return { kind: "shipped", reason: "shipping or tracking evidence" };
  if (evidence.recurringCharge) return { kind: "subscription", reason: "same charge again about a month later" };
  if (SUBSCRIPTION_TEXT.test(evidence.text) || evidence.llmSubscriptionInterval) return { kind: "subscription", reason: "recurring billing wording" };
  if (tableMatches(DIGITAL, evidence) || DIGITAL_TEXT.test(evidence.text)) return { kind: "digital", reason: "app store or digital platform" };
  if (tableMatches(IN_STORE, evidence)) return { kind: "in_store", reason: "in-store merchant or point-of-sale platform" };
  if (evidence.llmGuess !== null && evidence.confMin >= REVIEW_CONFIDENCE_THRESHOLD) return { kind: evidence.llmGuess, reason: "model guess" };
  return { kind: "other", reason: evidence.llmGuess !== null ? "model guess with low confidence" : "no kind evidence" };
}

/** Platform label for a digital purchase when the email does not name one. */
export function digitalPlatformOf(evidence: Pick<KindEvidence, "names" | "domains" | "text">): string | null {
  const text = `${evidence.names.join(" ")} ${evidence.domains.join(" ")} ${evidence.text}`.toLowerCase();
  const platforms: Array<[RegExp, string]> = [
    [/app store|itunes|apple media services/, "App Store"],
    [/google play/, "Google Play"],
    [/steam/, "Steam"],
    [/playstation/, "PlayStation Store"],
    [/nintendo|eshop/, "Nintendo eShop"],
    [/xbox|microsoft store/, "Microsoft Store"],
    [/epic games/, "Epic Games Store"],
    [/humble bundle/, "Humble Bundle"],
    [/kindle|audible/, "Amazon digital"],
  ];
  return platforms.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Interval stated in text: "monthly", "per year", "每月"; null when none (or both). */
export function subscriptionIntervalOf(text: string): "week" | "month" | "year" | null {
  const found = new Set<"week" | "month" | "year">();
  if (/\b(?:weekly|per week|every week)\b|\/wk\b|每週/.test(text)) found.add("week");
  if (/\b(?:monthly|per month|every month)\b|\/mo\b|每月|月費/.test(text)) found.add("month");
  if (/\b(?:annual|annually|yearly|per year|every year)\b|\/yr\b|每年|年費/.test(text)) found.add("year");
  return found.size === 1 ? [...found][0] : null;
}
