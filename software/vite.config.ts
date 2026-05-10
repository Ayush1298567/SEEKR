import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650
  },
  server: {
    port: Number(process.env.SEEKR_CLIENT_PORT ?? 5173),
    proxy: {
      "/api": `http://127.0.0.1:${process.env.SEEKR_API_PORT ?? "8787"}`,
      "/ws": {
        target: `ws://127.0.0.1:${process.env.SEEKR_API_PORT ?? "8787"}`,
        ws: true
      }
    }
  }
});
