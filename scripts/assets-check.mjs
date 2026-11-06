import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const manifest = JSON.parse(
  await readFile(new URL("../quality/assets.json", import.meta.url)),
);
for (const item of manifest.files) {
  const bytes = await readFile(new URL("../" + item.path, import.meta.url));
  if (
    bytes.length !== item.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== item.sha256
  )
    throw new Error(`Asset integrity mismatch: ${item.path}`);
}
const root = new URL("../", import.meta.url);
const result = await build({
  entryPoints: [
    new URL("public/game/src/vendor/three-runtime-entry.mjs", root).pathname,
  ],
  bundle: true,
  write: false,
  format: "esm",
  minify: true,
  platform: "browser",
  target: ["es2020"],
  legalComments: "none",
  banner: {
    js: "/*! Three.js 0.185.1 | MIT License | https://threejs.org/license */",
  },
});
const rebuilt = result.outputFiles[0].text
  .replace(/^ +\t/gm, "\t")
  .replace(/[\t ]+$/gm, "");
if (
  rebuilt !==
  (await readFile(
    new URL("public/game/src/vendor/three-runtime.mjs", root),
    "utf8",
  ))
)
  throw new Error(
    "Vendored Three.js does not reproduce from the pinned dependencies",
  );
if (
  !Buffer.from(
    await readFile(new URL("node_modules/three/LICENSE", root)),
  ).equals(
    await readFile(new URL("public/game/src/vendor/THREE-LICENSE.txt", root)),
  )
)
  throw new Error("Three.js license mismatch");
console.log(
  `${manifest.files.length} asset hashes and the pinned Three.js rebuild verified`,
);
