import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config. The web app is a static SPA — no server. It talks to Supabase
// directly using the public anon key (same pattern as the mobile app).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
