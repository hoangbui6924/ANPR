import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// backend Express (chapter 8); override with API_URL=http://localhost:3000 if needed
const API = process.env.API_URL ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  server: {
    port: 5173,
    proxy: {
      "/api": API,
      "/uploads": API,
      "/socket.io": { target: API, ws: true },
    },
  },
});
