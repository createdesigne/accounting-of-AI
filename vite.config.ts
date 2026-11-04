import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/accounting-of-AI/",
  plugins: [react()],
  server: { proxy: { "/api/ai": { target: "http://127.0.0.1:8787" } } },
});
