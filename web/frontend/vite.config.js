import { defineConfig, loadEnv } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";

// Load env from web/frontend/ first, then web/ (parent) so vars from
// web/.env (PREMIUM_PLAN_PRICE etc) are available to the `define` block below.
// Pass "" as the third arg so non-VITE_ vars (PREMIUM_PLAN_PRICE, SHOPIFY_API_KEY)
// are loaded into process.env. Without this, loadEnv silently filters to VITE_ only
// and Vite's index.html `%VAR%` transform finds nothing.
process.env = {
  ...process.env,
  ...loadEnv("", process.cwd(), ""),
  ...loadEnv("", resolve(process.cwd(), ".."), ""),
};


//console.log("API key: ", process.env.SHOPIFY_API_KEY);
console.log("Host: ", process.env.HOST);

if (
  process.env.npm_lifecycle_event === "build" &&
  !process.env.SHOPIFY_API_KEY
) {
  console.warn(
    "\nBuilding the frontend app without an API key. The frontend build will not run without an API key. Set the SHOPIFY_API_KEY environment variable when running the build command.\n"
  );
}

const proxyOptions = {
  target: `http://127.0.0.1:${process.env.BACKEND_PORT}`,
  changeOrigin: false,
  secure: true,
  ws: false,
};

const host = process.env.HOST
  ? process.env.HOST.replace(/https?:\/\//, "")
  : "localhost";

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: process.env.FRONTEND_PORT,
    clientPort: 443,
  };
}

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  plugins: [react()],
  server: {
    host: "localhost",
    port: process.env.FRONTEND_PORT,
    hmr: hmrConfig,
    proxy: {
      "^/(\\?.*)?$": proxyOptions,
      "^/api(/|(\\?.*)?$)": proxyOptions,
    },
  },
  define: {
    "process.env.SHOPIFY_API_KEY": JSON.stringify(process.env.SHOPIFY_API_KEY || process.env.VITE_SHOPIFY_API_KEY),
    "process.env.PREMIUM_PLAN_PRICE": JSON.stringify(process.env.PREMIUM_PLAN_PRICE),
  },
});
