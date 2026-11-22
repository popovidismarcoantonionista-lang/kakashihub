// Generate a static HTML snapshot of the Kakashi Hub from the production build.
// The app is client-only after hydration, so ".output/public" plus this file is
// enough to host it on any static provider (Render static site, Netlify, S3...).
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, ".output/public");
const port = 32000 + Math.floor(Math.random() * 12000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [resolve(root, ".output/server/index.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
  stdio: "ignore",
});

let page;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        page = await response.text();
        ready = true;
      }
    } catch {
      await new Promise((done) => setTimeout(done, 150));
    }
  }
  if (!ready) throw new Error("O servidor de preview não respondeu a tempo.");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "index.html"), page, "utf8");
  console.log(`Static export written to ${resolve(outputDir, "index.html")}`);
} finally {
  server.kill("SIGTERM");
}
