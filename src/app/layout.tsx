import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// Pages set their own head tags through pageMetadata() in site.tsx; this is only what every page shares.
export const metadata: Metadata = {
  icons: { icon: { url: "/assets/favicon.svg", type: "image/svg+xml" }, apple: "/assets/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* The hand-written stylesheet is served as-is from public/, not through Next's CSS pipeline. */}
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
