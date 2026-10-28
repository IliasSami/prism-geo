/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright", "playwright-core"],
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
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "playwright", "playwright-core"];
    }
    return config;
  },
};

export default nextConfig;
