import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The design-token package lives in the super-repo's `packages/` tree, outside
 * this vite root. It is consumed by ALIAS rather than by a `file:` dependency:
 * the package's entry point is raw TypeScript (`index.ts`), and a symlinked
 * node_modules copy would sit behind vite's default node_modules transform
 * exclusion. Aliasing straight at the source file keeps it inside the normal
 * TS pipeline and keeps ONE copy of the tokens in the tree.
 *
 * The npm scope is `@avigopal`. `@metabob` is deprecated and must not appear.
 */
const DESIGN_TOKENS = fileURLToPath(
  new URL("../../../packages/design-tokens/index.ts", import.meta.url),
);
const PACKAGES_ROOT = fileURLToPath(new URL("../../../packages", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@avigopal/design-tokens": DESIGN_TOKENS,
    },
  },
  server: {
    // The token package is outside the vite root, so dev-server file serving
    // has to be told it is allowed. Build does not need this; dev does.
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), PACKAGES_ROOT] },
    proxy: {
      // Dev-only convenience. In production the vessel serves this bundle and
      // owns /api itself; nothing here is baked into the build (rule P12).
      "/api": {
        target: process.env.HSS_DEV_ORIGIN ?? "http://127.0.0.1:8270",
        changeOrigin: false,
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
