import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"

const pkg = JSON.parse(
  readFileSync(
    new URL("./package.json", import.meta.url),
    "utf-8",
  ),
) as { version: string }

export default defineConfig({
  base: "/m/",
  plugins: [react()],
  define: {
    // Surfaced as ``import.meta.env.APP_VERSION`` in the
    // PWA so the running build identifies itself in the
    // profile drawer footer. Read at build time from
    // package.json so a release bump shows up everywhere
    // automatically.
    "import.meta.env.APP_VERSION":
      JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
  },
  server: {
    port: 5174,
    proxy: {
      "/auth": "http://localhost:3030",
      "/clocks": "http://localhost:3030",
      "/sync": "http://localhost:3030",
      "/ref": "http://localhost:3030",
      "/billing": "http://localhost:3030",
      "/ai": "http://localhost:3030",
      "/health": "http://localhost:3030",
      "/ws": {
        target: "http://localhost:3030",
        ws: true,
      },
    },
  },
})
