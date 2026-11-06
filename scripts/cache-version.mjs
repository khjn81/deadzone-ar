import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { APP_SHELL, CACHE_PREFIX } from "../public/game/src/pwa-config.mjs";
const root = new URL("../", import.meta.url);
const config = new URL("public/game/src/pwa-config.mjs", root);
const versionLine = /^export const CACHE_NAME = .*;$/m;
export async function expectedCacheName() {
  const digest = createHash("sha256");
  for (const asset of [...APP_SHELL].sort()) {
    let bytes = await readFile(new URL(`public${asset}`, root));
    if (asset.endsWith("/src/pwa-config.mjs")) {
      bytes = Buffer.from(
        bytes
          .toString()
          .replace(
            versionLine,
            'export const CACHE_NAME = "<content-version>";',
          ),
      );
    }
    digest.update(asset).update("\0").update(bytes).update("\0");
  }
  return `${CACHE_PREFIX}v3-${digest.digest("hex").slice(0, 16)}`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const expected = await expectedCacheName(),
    source = await readFile(config, "utf8");
  const next = source.replace(
    versionLine,
    `export const CACHE_NAME = '${expected}';`,
  );
  if (process.argv.includes("--write")) {
    if (next !== source) await writeFile(config, next);
    console.log(`Cache version: ${expected}`);
  } else {
    if (next !== source)
      throw new Error(
        "Offline shell changed. Run npm run cache:stamp and commit its updated content version.",
      );
    console.log(`Cache version verified: ${expected}`);
  }
}
