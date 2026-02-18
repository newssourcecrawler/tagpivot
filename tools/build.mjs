import esbuild from "esbuild";
import { mkdirSync, copyFileSync, cpSync } from "node:fs";
import { join } from "node:path";

const outdir = join(process.cwd(), "extension", "dist");
mkdirSync(outdir, { recursive: true });

// 1️⃣ Service Worker (MV3 allows ESM here)
await esbuild.build({
  entryPoints: {
    "bg/service_worker": "extension/src/bg/service_worker.ts"
  },
  bundle: true,
  outdir,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  sourcemap: true,
  minify: false
});

// 2️⃣ Content Script (MUST be IIFE — no top-level export/import)
await esbuild.build({
  entryPoints: {
    "content/inject": "extension/src/content/inject.ts"
  },
  bundle: true,
  outdir,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  sourcemap: true,
  minify: false
});

// static assets
copyFileSync("extension/manifest.json", join(outdir, "manifest.json"));
copyFileSync("extension/src/content/overlay/ui.css", join(outdir, "ui.css"));

// denylist asset (packaged, no external network)
const denySrc = "extension/src/core/deny/deny_domains.generated.txt";
const denyDestDir = join(outdir, "core", "deny");
mkdirSync(denyDestDir, { recursive: true });
copyFileSync(denySrc, join(denyDestDir, "deny_domains.generated.txt"));

// locales (required because manifest specifies default_locale)
const localesSrc = "extension/_locales";
const localesDest = join(outdir, "_locales");
cpSync(localesSrc, localesDest, { recursive: true });

// icons (referenced by manifest: icons/icon16.png etc.)
const iconsSrc = "extension/icons";
const iconsDest = join(outdir, "icons");
cpSync(iconsSrc, iconsDest, { recursive: true });

console.log("Built to extension/dist");