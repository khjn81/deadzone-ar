import { spawnSync } from "node:child_process";
const checks = [
  ["test:e2e", ["--", "--reporter=list,json"]],
  ["test:release", []],
  [
    "test:graphics",
    [
      "--",
      "--artifact",
      "test-results-release/graphics.json",
      "--screenshot-dir",
      "test-results-release/graphics",
    ],
  ],
];
for (const [name, args] of checks) {
  const result = spawnSync("npm", ["run", name, ...args], {
    stdio: "inherit",
    timeout: 240000,
    env: {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_NAME: "test-results/final-e2e.json",
      NEXT_TELEMETRY_DISABLED: "1",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
