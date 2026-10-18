import type { MetadataRoute } from "next";

/** Web app manifest (#44). theme-color is the slate base from docs/design-system.md; icons live in public/icons. */
export const THEME_COLOR = "#dbe1ea";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PaperTrail",
    short_name: "PaperTrail",
    description: "Find the money your inbox says you're owed.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
