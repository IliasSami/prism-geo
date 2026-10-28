import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The monorepo root, so file tracing does not guess from lockfiles found further up
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  // Playwright is loaded from node_modules at runtime, never bundled
  serverExternalPackages: ["playwright", "playwright-core"],
  // The app ships no optimized images; turning the optimizer off removes the /_next/image attack surface
  images: { unoptimized: true },
  poweredByHeader: false,
  // Pages merged into others keep working at their old URLs
  async redirects() {
    return [
      { source: "/sov", destination: "/visibility", permanent: false },
      { source: "/competitors", destination: "/visibility", permanent: false },
      { source: "/fan-out", destination: "/responses", permanent: false },
      { source: "/brand", destination: "/settings", permanent: false },
    ];
  },
  transpilePackages: ["@prismgeo/db", "@prismgeo/core", "@prismgeo/crawler", "@prismgeo/mcp"],
  // Still needed: serverExternalPackages does not cover imports from the transpiled workspace packages
  webpack: (config, { isServer }) => {
    if (isServer) config.externals = [...(config.externals || []), "playwright", "playwright-core"];
    return config;
  },
};

export default nextConfig;
