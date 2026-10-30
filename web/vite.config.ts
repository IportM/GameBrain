import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { importApi } from "./server/plugin";

export default defineConfig({
  plugins: [react(), importApi()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "three";
          if (id.includes("node_modules/@react-three/")) return "react-three";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) return "react";
        },
      },
    },
  },
});
