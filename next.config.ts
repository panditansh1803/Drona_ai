import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@remotion/renderer",
    "@remotion/bundler",
    "esbuild",
    "@aws-sdk/client-s3",
    "better-sqlite3",
  ],
};

export default nextConfig;
