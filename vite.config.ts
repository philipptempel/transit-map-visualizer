import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mapPages } from "./build/pages.ts";

export default defineConfig({
  base: "./",   // relative URLs, so one build works under any GitHub or GitLab Pages path
  plugins: [react(), tailwindcss(), mapPages()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: { input: { index: "index.html", map: "map.html" } },
  },
});
