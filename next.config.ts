import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: process.env.NEXT_PUBLIC_R2_DOMAIN
          ? new URL(process.env.NEXT_PUBLIC_R2_DOMAIN).hostname
          : 'pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev',
      },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        'www.trianglesquareservices.com',
        'trianglesquareservices.com',
        'verify-order-app.vercel.app', // Adding implicit vercel domains just in case
        'localhost:3000'
      ],
    },
  },
};

export default nextConfig;
