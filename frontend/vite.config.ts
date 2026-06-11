import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(frontendRoot, "..");

function resolveDevApiTarget(mode: string) {
  const env = loadEnv(mode, workspaceRoot, "");
  if (env.VITE_DEV_API_TARGET) return env.VITE_DEV_API_TARGET;

  const configuredHost = env.API_HOST?.trim();
  const host =
    configuredHost && configuredHost !== "0.0.0.0"
      ? configuredHost
      : "127.0.0.1";
  const port = env.API_PORT || env.PORT || "13001";
  return `http://${host}:${port}`;
}

export default defineConfig(({ mode }) => ({
  envDir: workspaceRoot,
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 13000,
    proxy: {
      "/api": {
        changeOrigin: true,
        target: resolveDevApiTarget(mode),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: "./src/test/setup.ts",
  },
}));
