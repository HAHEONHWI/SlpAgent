import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": { target: process.env.API_PROXY ?? "http://localhost:8080", rewrite: (p) => p.replace(/^\/api/, "") } } },
});
