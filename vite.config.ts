import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // The Cloudflare plugin runs worker/index.ts inside the dev server (real workerd
  // runtime), so `npm run dev` serves the app and /api/* on one origin.
  // Skipped under vitest: unit tests are plain functions and don't need the runtime.
  plugins: process.env.VITEST ? [react()] : [react(), cloudflare()],

  // Never expose server secrets: only VITE_-prefixed vars reach the browser.
  envPrefix: "VITE_",

  test: {
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
    environment: "node",
  },
});
