import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev',
      },
    ],
  },
};

export default nextConfig;
