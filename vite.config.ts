import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and no screen clearing (keeps Rust errors visible).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/library/**"] } },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 4000 },
  test: { environment: "node" },
});
