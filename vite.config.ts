import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { writeFileSync } from "fs";

// Stable per-build id: tied to the deployed commit on Vercel, timestamp locally.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString();

// Emits dist/version.json so the running app can poll for newer deploys.
const versionFilePlugin = () => ({
  name: "write-version-json",
  apply: "build" as const,
  closeBundle() {
    writeFileSync("dist/version.json", JSON.stringify({ buildId: BUILD_ID }));
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger(), mcpPlugin(), versionFilePlugin()].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        // Libraries that rarely change get their own files, so a new deploy only makes
        // browsers download the app code again, not React and the database client too.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) return "vendor-react";
          if (/node_modules\/(@supabase|iceberg-js)\//.test(id)) return "vendor-supabase";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core", "@radix-ui/react-tooltip"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "@radix-ui/react-tooltip"],
  },
}));
