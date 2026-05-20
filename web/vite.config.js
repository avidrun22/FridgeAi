import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// v1.25 #287 — read the app.json version at build time so the web Settings
// footer always matches the iOS/Android version without manual sync. One
// source of truth (app.json in the repo root) bumped per release; web picks
// it up automatically on the next Netlify build.
const __dirname = dirname(fileURLToPath(import.meta.url));
const appJson = JSON.parse(readFileSync(join(__dirname, "..", "app.json"), "utf-8"));
const APP_VERSION = appJson?.expo?.version || "dev";

// Vite config. The web app is a static SPA — no server. It talks to Supabase
// directly using the public anon key (same pattern as the mobile app).
export default defineConfig({
  plugins: [react()],
  define: {
    // Compile-time constant. Reference as `__APP_VERSION__` in source —
    // Vite replaces at build with the literal string from app.json.
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
