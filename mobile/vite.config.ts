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
      "/auth": "http://localhost:3030",
      "/clocks": "http://localhost:3030",
      "/sync": "http://localhost:3030",
      "/ref": "http://localhost:3030",
      "/billing": "http://localhost:3030",
      "/health": "http://localhost:3030",
    },
  },
})
