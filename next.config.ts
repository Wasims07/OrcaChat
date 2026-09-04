import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ✅ Standalone output for Docker deployments
  output: "standalone",

  // ✅ Keep existing
  serverExternalPackages: ['pdf-parse'],
  
  // ✅ Turbopack configuration (Next.js 16.3.1)
  turbopack: {
    // Pin the project root so Turbopack doesn't resolve node_modules/lockfiles
    // up into the home directory (avoids the stray package-lock warning).
    root: __dirname,
  },
  
  // ❌ REMOVE swcMinify - no longer needed in Next.js 16
  // swcMinify is enabled by default
  
  // ✅ Remove console logs in production (faster)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  
  // ✅ Webpack optimizations
  webpack: (config) => {
    // Optimize bundle size
    config.optimization = {
      ...config.optimization,
      moduleIds: 'deterministic',
      chunkIds: 'deterministic',
    };
    
    return config;
  },
  
  // ✅ Experimental features
  experimental: {
    optimizeCss: true,
    scrollRestoration: true,
  },
  
  // ✅ Image optimization
  images: {
    unoptimized: process.env.NODE_ENV === 'development',
    formats: ['image/avif', 'image/webp'],
  },
  
  // ✅ Production optimizations
  productionBrowserSourceMaps: false,

  // ✅ Security headers on every response (hardening: clickjacking, MIME
  // sniffing, referrer leakage, and a baseline Content-Security-Policy).
  // Notes:
  //  - 'unsafe-inline' in script-src is required for Next's RSC bootstrap
  //    scripts and 'unsafe-eval' for dev HMR + Emscripten (tesseract OCR).
  //    The real XSS defense is server-side sanitization of preview HTML, not
  //    relying on CSP alone.
  //  - cdn.jsdelivr.net is required by tesseract.js (OCR worker + language
  //    data load from CDN); blob: is used for local file preview object URLs.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
              "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
              "img-src 'self' blob: data: https:; " +
              "font-src 'self' data: https://cdn.jsdelivr.net; " +
              "media-src 'self' blob: data:; " +
              "frame-src 'self' blob:; " +
              "frame-ancestors 'none'; " +
              "worker-src 'self' blob:; " +
              "connect-src 'self' https://cdn.jsdelivr.net blob:; " +
              "object-src 'none'; " +
              "base-uri 'self'; " +
              "form-action 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;