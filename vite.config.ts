import cloudflare from "@alchemy.run/cloudflare-runtime/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    // `alchemy deploy` and `alchemy dev` add this plugin with the Worker's settings. A plain `vite build` adds it here,
    // so dist/ holds the same Worker that production runs.
    process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"
      ? null
      : cloudflare({
          compatibilityDate: "2026-10-26",
          compatibilityFlags: ["nodejs_compat"],
        }),
  ],
});
