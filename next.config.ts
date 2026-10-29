import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  devIndicators: false,
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
