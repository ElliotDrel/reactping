import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API responses keep exactly the headers the shared handler sets.
  poweredByHeader: false,
  // Pin the root to this checkout: a stray lockfile in a parent folder otherwise makes Next guess the wrong one.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
