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

    process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"
      ? null
      : cloudflare({
          compatibilityDate: "2026-10-26",
          compatibilityFlags: ["nodejs_compat"],
        }),
  ],
});
