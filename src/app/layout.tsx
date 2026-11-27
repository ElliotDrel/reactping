import type { Viewport } from "next";
import { ICON_LINKS } from "../site-icons.ts";
import type { ReactNode } from "react";

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {ICON_LINKS.map((icon) => (
          <link key={icon.href} {...icon} />
        ))}
        {/* The hand-written stylesheet is served as-is from public/, not through Next's CSS pipeline. */}
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
