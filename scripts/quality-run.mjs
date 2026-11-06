import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const root = ".improvement-runs/20261106-github-release";
const spec = JSON.parse(fs.readFileSync(`${root}/current-experiment.json`));
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
const seal = JSON.parse(fs.readFileSync(`${root}/evaluator-seal.json`));
for (const [file, digest] of Object.entries(seal))
  if (hash(fs.readFileSync(file)) !== digest)
    throw new Error(`Frozen evaluator changed: ${file}`);
const folder = `${root}/rounds/${String(spec.round).padStart(3, "0")}`;
fs.mkdirSync(folder, { recursive: true });
let attempt = 1;
while (fs.existsSync(`${folder}/evaluation-${attempt}.json`)) attempt++;
const files = [];
for (const base of [
  "public",
  "app",
  "docs",
  "release-checks",
  "release.config.mjs",
  "vite.config.ts",
  ".openai/hosting.json",
  "worker",
  "build",
  "tests",
  "e2e",
  "scripts",
  "playwright.config.mjs",
  "package.json",
  "package-lock.json",
  "README.md",
  ".github",
  "quality",
]) {
  function visit(file) {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory())
      for (const name of fs.readdirSync(file).sort())
        visit(path.join(file, name));
    else files.push([file, hash(fs.readFileSync(file))]);
  }
  visit(base);
}
const result = {
  ...spec,
  attempt,
  timestamp: new Date().toISOString(),
  sourceHash: hash(JSON.stringify(files)),
  files,
  measurements: {},
};
const checks = [
  ["unit", "NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false npm test"],
  [
    "syntax",
    "node --check public/game/src/app.mjs && node --check public/game/src/ar-controller.mjs",
  ],
  [
    "e2e",
    `npx playwright test --project=desktop --reporter=json --grep '${spec.grep.replaceAll("'", "'\\''")}'`,
  ],
];
if (spec.extra) checks.push(["probe", spec.extra]);
for (const [name, command] of checks) {
  const started = Date.now(),
    run = spawnSync(command, {
      shell: true,
      encoding: "utf8",
      timeout: name === "probe" ? 600000 : 240000,
      maxBuffer: 12 * 1024 * 1024,
    });
  fs.writeFileSync(`${folder}/${attempt}-${name}.stdout`, run.stdout || "");
  fs.writeFileSync(`${folder}/${attempt}-${name}.stderr`, run.stderr || "");
  result.measurements[name] = {
    exit: run.status,
    durationMs: Date.now() - started,
    error: run.error?.message,
  };
  if (name === "e2e")
    try {
      result.measurements[name].stats = JSON.parse(run.stdout).stats;
    } catch {}
  console.log(
    `${spec.round}/${attempt} ${name}: ${run.status} (${Date.now() - started}ms)`,
  );
}
const valid = Object.values(result.measurements).every((x) => x.exit === 0);
result.decision = valid ? "keep" : "needs_retest";
result.score = valid ? spec.ratings.reduce((a, b) => a + b, 0) : null;
result.scoreMeaning =
  "Implementation-agent rubric judgment backed by selected regressions; not independent human, learning, physical-camera, or motion-device validation.";
fs.writeFileSync(
  `${folder}/evaluation-${attempt}.json`,
  JSON.stringify(result, null, 2) + "\n",
);
fs.writeFileSync(
  `${folder}/candidate-${attempt}.patch`,
  spawnSync("git", ["diff", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 12 * 1024 * 1024,
  }).stdout || "",
);
console.log(
  JSON.stringify({
    round: spec.round,
    attempt,
    decision: result.decision,
    score: result.score,
    stats: result.measurements.e2e.stats,
  }),
);
process.exitCode = valid ? 0 : 1;
