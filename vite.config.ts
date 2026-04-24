import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@excalidraw/mermaid-to-excalidraw": path.resolve(__dirname, "src/lib/excalidraw-mermaid-stub.ts"),
    },
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
