import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EmailClassSchema, RedactionKindSchema, type EmailClass, type RedactionKind } from "@/lib/contracts";
import { parseEml } from "@/lib/demo";
import { classify, isReceiptLike, redact } from "@/lib/ingestion";

/**
 * Edge-case pack for the dev playground (issue #34). Every tools/playground/edge-cases/*.eml file carries an
 * `X-PT-Expect` header (see edge-cases/README.md); this test parses each file with the upload parser and checks the
 * prefilter, classifier and redaction against it.
 */

const EDGE_CASE_DIR = fileURLToPath(new URL("./edge-cases/", import.meta.url));

type EdgeCaseExpectation = {
  /** Accepted classes (`class=marketing|not_receipt` accepts either). */
  classes: EmailClass[];
  keep: boolean;
  /** Redaction kinds that must be replaced at least once; every other kind must not be replaced. */
  redacts: RedactionKind[];
  /** Substring the parsed plain-text body must contain (decoding checks). */
  contains?: string;
};

type EdgeCaseAspect = "prefilter" | "classification" | "redaction";

/**
 * Cases that expose a real, still-open bug in src/lib/ingestion (classifier owned by #6). Marked `it.fails` so they stay
 * visible and flip to a failure once fixed (then remove the entry). Key: `<file>:<aspect>`.
 */
const KNOWN_FAILURES: Partial<Record<`${string}:${EdgeCaseAspect}`, string>> = {
  // A labeled order ref ("order #LB-60111") disables the promo check, and "Thanks for your order" in the body then
  // routes a 20%-off promo (4 promo signals) to `order`, so it would be extracted and could become a ledger row.
  "07-promo-with-order-number.eml:classification": "promo mentioning a past order number is classified as order",
};

function readExpectHeader(source: string): string {
  const headerBlock = source.split(/\r?\n\r?\n/, 1)[0];
  const match = /^X-PT-Expect:[ \t]*(.*(?:\r?\n[ \t].*)*)$/im.exec(headerBlock);
  if (!match) throw new Error("missing X-PT-Expect header");
  return match[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

function parseExpectation(header: string): EdgeCaseExpectation {
  const pairs = new Map(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf("=");
        if (eq <= 0) throw new Error(`bad X-PT-Expect entry "${part}"`);
        return [part.slice(0, eq).trim(), part.slice(eq + 1).trim()] as const;
      }),
  );
  const classValue = pairs.get("class");
  const keepValue = pairs.get("keep");
  const redactsValue = pairs.get("redacts");
  if (!classValue || !keepValue || !redactsValue) throw new Error("X-PT-Expect needs class, keep and redacts");
  return {
    classes: classValue.split("|").map((value) => EmailClassSchema.parse(value.trim())),
    keep: keepValue === "true",
    redacts: redactsValue === "none" ? [] : redactsValue.split(",").map((value) => RedactionKindSchema.parse(value.trim())),
    contains: pairs.get("contains"),
  };
}

const files = readdirSync(EDGE_CASE_DIR)
  .filter((name) => name.endsWith(".eml"))
  .sort();

describe("edge-case pack", () => {
  it("has 20+ cases, all listed in the README, with unique message ids", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    const readme = readFileSync(`${EDGE_CASE_DIR}README.md`, "utf8");
    for (const file of files) expect(readme, `README lists ${file}`).toContain(file);
    const ids = files.map((file) => parseEml(readFileSync(`${EDGE_CASE_DIR}${file}`, "utf8")).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(files)("%s", (file) => {
  const source = readFileSync(`${EDGE_CASE_DIR}${file}`, "utf8");
  const expectation = parseExpectation(readExpectHeader(source));
  const email = parseEml(source);

  const check = (aspect: EdgeCaseAspect, assertion: () => void) => {
    const knownFailure = KNOWN_FAILURES[`${file}:${aspect}`];
    if (knownFailure) it.fails(`${aspect} (known bug: ${knownFailure})`, assertion);
    else it(aspect, assertion);
  };

  it("parses into a synthetic RawEmail", () => {
    expect(email.from).not.toBe("");
    if (expectation.contains) expect(email.text).toContain(expectation.contains);
  });

  check("prefilter", () => {
    const decision = isReceiptLike(email);
    expect(decision.keep, decision.reason).toBe(expectation.keep);
  });

  check("classification", () => {
    const classification = classify(email);
    expect(expectation.classes, `${classification.class} (${classification.confidence}): ${classification.reason}`).toContain(
      classification.class,
    );
  });

  check("redaction", () => {
    const redacted = redact(email);
    const replaced = RedactionKindSchema.options.filter((kind) => (redacted.redactions[kind] ?? 0) > 0);
    expect(replaced.sort()).toEqual([...expectation.redacts].sort());
    // Test card numbers must never survive redaction in any form.
    expect(redacted.text).not.toMatch(/4242[ -]?4242[ -]?4242[ -]?4242/);
  });
});
