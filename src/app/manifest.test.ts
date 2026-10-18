import { describe, expect, it } from "vitest";
import manifest, { THEME_COLOR } from "./manifest";

describe("web app manifest (#44)", () => {
  const m = manifest();

  it("is installable as a standalone app with the slate theme colour", () => {
    expect(m).toMatchObject({ name: "PaperTrail", start_url: "/", display: "standalone", theme_color: "#dbe1ea" });
    expect(THEME_COLOR).toBe("#dbe1ea");
  });

  it("lists 192 and 512 icons for both purposes under /icons (PNG files are Alex's, public/icons)", () => {
    const icons = m.icons ?? [];
    for (const purpose of ["any", "maskable"]) {
      expect(icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
    }
    for (const icon of icons) expect(icon.src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
  });
});
