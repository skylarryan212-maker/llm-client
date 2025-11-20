import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Chat URLs → still load the main app
      {
        source: "/c/:conversationId",
        destination: "/",
      },
      // Project URLs → still load the main app
      {
        source: "/p/:projectId",
        destination: "/",
      },
    ];
  },
};

export default nextConfig;
