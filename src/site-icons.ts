// Shared by Next's layout and the standalone OAuth/feedback result pages.
export const ICON_LINKS = [
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { rel: "icon", href: "/assets/favicon-96x96.png", type: "image/png", sizes: "96x96" },
  { rel: "icon", href: "/assets/favicon.svg", type: "image/svg+xml", sizes: "any" },
  { rel: "apple-touch-icon", href: "/assets/apple-touch-icon-152x152.png", sizes: "152x152" },
  { rel: "apple-touch-icon", href: "/assets/apple-touch-icon-167x167.png", sizes: "167x167" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
  { rel: "mask-icon", href: "/assets/logo-black.svg", color: "#1f4bff" },
  { rel: "manifest", href: "/site.webmanifest" },
] as const;

// All attributes are fixed, trusted strings above; no request data is interpolated.
export const ICON_LINKS_HTML = ICON_LINKS.map(
  (link) =>
    `<link ${Object.entries(link)
      .map(([key, value]) => `${key}="${value}"`)
      .join(" ")} />`,
).join("\n    ");
