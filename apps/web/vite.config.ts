import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    // Same-origin /api in dev too, so cookies behave exactly like in docker-compose (nginx proxy).
    proxy: { "/api": "http://localhost:3000" },
  },
});
