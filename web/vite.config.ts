import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { importApi } from "./server/plugin";

export default defineConfig({
  plugins: [react(), importApi()],
});
