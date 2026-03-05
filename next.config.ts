import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  turbopack: {},

  async redirects() {
    return [
      {
        source: "/",
        destination: "/map",
        permanent: false,
      },
    ];
  },
};

export default withPWA(nextConfig);