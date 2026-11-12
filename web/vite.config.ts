import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { importApi } from "./server/plugin";

export default defineConfig({
  plugins: [react(), importApi()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "three-core";
          if (id.includes("node_modules/@react-three/fiber/")) return "react-three-fiber";
          if (
            id.includes("node_modules/@react-three/drei/")
            || id.includes("node_modules/three-stdlib/")
          ) return "three-extras";
          return undefined;
        },
      },
    },
  },
});
