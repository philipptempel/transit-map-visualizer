import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",   // relative URLs, so one build works under any GitHub or GitLab Pages path
  plugins: [tailwindcss()],
  build: {
    rollupOptions: { input: { index: "index.html", map: "map.html" } },
  },
});
