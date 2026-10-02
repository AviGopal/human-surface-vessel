import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The design tokens are vendored at `src/design-tokens/` so this repo builds,
 * typechecks and tests with nothing but itself on disk (law 11): the vessel
 * clones that pull-sync and the landing lane use carry no super-repo
 * `packages/` tree. Consumed by ALIAS so the raw TypeScript entry stays in the
 * normal TS pipeline.
 *
 * The npm scope is `@avigopal`. `@metabob` is deprecated and must not appear.
 */
const DESIGN_TOKENS = fileURLToPath(
  new URL("./src/design-tokens/index.ts", import.meta.url),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Source wins over legacy checked-in JS siblings.
    extensions: [".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"],
    alias: {
      "@avigopal/design-tokens": DESIGN_TOKENS,
    },
  },
  server: {
    proxy: {
      // Dev-only convenience. In production the vessel serves this bundle and
      // owns /api itself; nothing here is baked into the build (rule P12).
      "/api": {
        target: process.env.HSS_DEV_ORIGIN ?? "http://127.0.0.1:8270",
        changeOrigin: false,
        // The vessel refuses writes carrying a foreign Origin (proxy.ts
        // refuseForeignOriginWrites); the dev server's own port is foreign to
        // it, so the dev proxy speaks as the vessel's origin. Dev-only.
        configure: (proxy) => {
          const target = process.env.HSS_DEV_ORIGIN ?? "http://127.0.0.1:8270";
          proxy.on("proxyReq", (req) => {
            if (req.getHeader("origin")) req.setHeader("origin", target);
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // No CDN, no remote font, no external module. Everything the page needs is
    // in the bundle (rule P12).
    rollupOptions: { external: [] },
  },
});
