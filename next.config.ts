import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * standalone: Docker obrazi uchun. Next kerakli node_modules ni
   * `.next/standalone` ga oʻzi yigʻadi — obraz ~200 MB oʻrniga ~1 GB
   * boʻlmaydi va konteyner ichida `npm install` kerak emas.
   */
  output: "standalone",

  /** Javob sarlavhalarida server versiyasi koʻrinmasin */
  poweredByHeader: false,

  /**
   * Musobaqa kunida sahifa manzilining oxiridagi «/» tufayli
   * qayta yoʻnaltirish boʻlmasin — TV brauzerida bu ortiqcha sakrash.
   */
  trailingSlash: false,

  async headers() {
    return [
      {
        // SSE oqimi hech qanday qatlamda keshlanmasin
        source: "/api/stream",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-transform" },
          { key: "X-Accel-Buffering", value: "no" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
