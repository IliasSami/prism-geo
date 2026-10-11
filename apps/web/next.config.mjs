/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright", "playwright-core"],
  transpilePackages: ["@prismgeo/db", "@prismgeo/core"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "playwright", "playwright-core"];
    }
    return config;
  },
};

export default nextConfig;
