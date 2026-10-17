// Writes or verifies the committed seed files (issue #5). tsx is not installed, so vitest runs the generator.
//   Regenerate:  $env:WRITE_SEED='1'; npx vitest run scripts/write-seed.test.ts
//   Verify:      npx vitest run scripts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { seedFileContents } from "./generate-seed";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const writeMode = process.env.WRITE_SEED === "1";

describe("seed files", () => {
  for (const [relativePath, contents] of Object.entries(seedFileContents())) {
    const absolutePath = join(repoRoot, relativePath);
    if (writeMode) {
      it(`writes ${relativePath}`, () => {
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, contents, "utf8");
        expect(readFileSync(absolutePath, "utf8")).toBe(contents);
      });
    } else {
      it(`${relativePath} matches buildSeed() output (regenerate with WRITE_SEED=1)`, () => {
        // Normalize line endings: git may check JSON out with CRLF on Windows.
        const committed = readFileSync(absolutePath, "utf8").replace(/\r\n/g, "\n");
        expect(committed).toBe(contents);
      });
    }
  }
});
