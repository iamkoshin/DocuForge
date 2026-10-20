import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp", "@remotion/renderer", "@remotion/bundler"],
  experimental: { serverActions: { bodySizeLimit: "500mb" } },
  agentRules: false,
};

export default nextConfig;
