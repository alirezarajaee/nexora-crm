import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Production hardening: genuine TypeScript errors must fail the build.
  // (Non-app scaffold dirs examples/ and skills/ are excluded via tsconfig.)
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
