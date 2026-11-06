import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await mkdir(".improvement-runs", { recursive: true });
const destination = await mkdtemp(
  path.join(root, ".improvement-runs", "clean-"),
);
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
for (const file of new Set(files)) {
  const target = path.join(destination, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
}
for (const [name, args] of [
  ["install", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]],
  ["test", ["test"]],
]) {
  const result = spawnSync("npm", args, {
    cwd: destination,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  await writeFile(
    path.join(destination, `${name}.log`),
    (result.stdout || "") + (result.stderr || ""),
  );
  if (result.status !== 0)
    throw new Error(`Fresh-source ${name} failed; evidence in ${destination}`);
  console.log(`Fresh-source ${name} passed`);
}
console.log(
  `Retained fresh-source evidence: ${path.relative(root, destination)}`,
);
