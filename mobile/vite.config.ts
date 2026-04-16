import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  base: "/m/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/auth": "http://localhost:3000",
      "/clocks": "http://localhost:3000",
      "/sync": "http://localhost:3000",
      "/ref": "http://localhost:3000",
      "/billing": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
})
