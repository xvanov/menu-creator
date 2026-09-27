import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker/Cloud Run image only (the Dockerfile sets STANDALONE=1); local installs use `next start`.
  output: process.env.STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
