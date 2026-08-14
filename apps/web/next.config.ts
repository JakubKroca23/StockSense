import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/cryptosense", destination: "/desk/btc", permanent: true },
      { source: "/gold", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
