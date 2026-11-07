import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base: the same build works on GitHub Pages (/Warehouse-Designer/),
// an internal web server or a network drive.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
});
