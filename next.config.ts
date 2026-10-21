import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // CSV imports (module m19) send a file of up to 2 MB through a Server Action; the default cap is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
