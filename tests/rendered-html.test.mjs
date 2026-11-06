import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("루트 주소는 정적 AR 게임으로 바로 이동한다", async () => {
  const response = await render();

  assert.ok([307, 308].includes(response.status));
  assert.equal(
    new URL(response.headers.get("location"), "http://localhost").pathname,
    "/game/index.html",
  );
});

test("배포본은 카메라 게임 코드와 군체 테마 공유 자산을 모두 포함한다", async () => {
  const [html, app, controller, image, favicon] = await Promise.all([
    readFile(new URL("public/game/index.html", root), "utf8"),
    readFile(new URL("public/game/src/app.mjs", root), "utf8"),
    readFile(new URL("public/game/src/ar-controller.mjs", root), "utf8"),
    readFile(new URL("public/og.png", root)),
    readFile(new URL("public/favicon.svg", root), "utf8"),
  ]);

  assert.match(html, /DEADZONE: SWARM/);
  assert.match(html, /감염 군체/);
  assert.match(html, /\.\/src\/app\.mjs/);
  assert.match(html, /\/og\.png/);
  assert.match(app, /ARController/);
  assert.match(controller, /facingMode:\s*\{\s*ideal:\s*["']environment["']/);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  assert.notEqual(
    createHash("sha256").update(image).digest("hex"),
    "44e5ee95deb146e08aec5a48d1e187bd3e0b2dc5d548fa8baa16b76bedf08e54",
    "링크 미리보기에 구형 좀비 키 아트를 다시 배포하면 안 된다",
  );
  assert.ok(image.byteLength > 100_000);
  assert.match(favicon, /<title>DEADZONE: SWARM<\/title>/);
  assert.match(favicon, /data-theme="swarm"/);
  assert.doesNotMatch(favicon, /#68C4FF|#0C79D8|#2E9EFF/i);
});

test("배포본은 접근 가능한 3D 월드 레이어와 모델 출처를 포함한다", async () => {
  const [html, app, renderer, styles, readme] = await Promise.all([
    readFile(new URL("public/game/index.html", root), "utf8"),
    readFile(new URL("public/game/src/app.mjs", root), "utf8"),
    readFile(new URL("public/game/src/renderer.mjs", root), "utf8"),
    readFile(new URL("public/game/styles.css", root), "utf8"),
    readFile(new URL("public/game/README.md", root), "utf8"),
  ]);

  assert.match(
    html,
    /<canvas id="worldCanvas" class="world-canvas"[^>]*aria-hidden="true"[^>]*><\/canvas>\s*<canvas id="arCanvas" class="ar-canvas"/,
  );
  assert.match(styles, /\.world-canvas\s*\{[^}]*z-index:\s*1;[^}]*pointer-events:\s*none;[^}]*\}/s);
  assert.match(styles, /\.ar-canvas\s*\{[^}]*z-index:\s*2;/s);
  assert.match(app, /worldCanvas:\s*element\('worldCanvas'\)/);
  assert.match(app, /rendererFactory\s*=\s*createRenderer/);
  assert.match(app, /rendererFactory\(elements\.canvas,\s*\{\s*globalObject,\s*worldCanvas:\s*elements\.worldCanvas\s*\}\)/s);
  assert.match(renderer, /import\('\.\/three-world-layer\.mjs'\)/);
  const modelLinks = [
    "https://sketchfab.com/3d-models/real-time-refraction-demo-mosquito-in-amber-37233d6ed84844fea1ebe88069ea58d1",
    "https://poly.pizza/m/GcttdvsqsQ",
    "https://poly.pizza/m/3tCnJC9UYA",
    "https://poly.pizza/m/6HsU6GQt3a",
  ];
  for (const href of modelLinks) {
    assert.equal((html.match(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 2, `${href} must be visible in pause and result credits`);
  }
  assert.equal((html.match(/CC BY 4\.0/g) || []).length, 2);
  assert.equal((html.match(/CC0 1\.0 Universal/g) || []).length, 2);
  assert.equal((html.match(/https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//g) || []).length, 2);
  assert.equal((html.match(/https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\//g) || []).length, 2);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 12);
  assert.match(html, /Mosquito \(swarmer\)/);
  assert.match(html, /Armabee Evolved \(stinger\)/);
  assert.match(html, /Ladybird \(bulwark\)/);
  assert.match(html, /Bee Enemy \(queen\)/);
  assert.match(readme, /infected-stinger\.glb.*Armabee Evolved/s);
  assert.match(readme, /infected-bulwark\.glb.*Ladybird/s);
  assert.match(readme, /infected-queen\.glb.*Bee Enemy/s);
  assert.match(readme, /61a48cfba610e46abba0c98f5371d331f60ed087a55a335580cbf27ba4b3d190/);
  assert.match(readme, /718b2be1cd6c1b4361e9e4cb7610459b994575d9e3e7b7818348670f53612166/);
  assert.match(readme, /29a3ac29e6859208bdab9db3d34387e1d154f14564bd17cdc57eda669cb557cf/);
  assert.match(readme, /6 live insects/);
  assert.match(readme, /4 corpses/);
  assert.match(html, />치명타<\/dt><dd><b id="resultCriticalHits">0<\/b><small>CRITICAL HITS<\/small>/);
  assert.match(html, /카메라 영상은 저장하거나 전송하지 않습니다/);
  assert.match(html, /<video[^>]*autoplay muted playsinline[^>]*aria-hidden="true"/);
  assert.match(html, /id="capabilityStatus"/);
  assert.match(html, /id="retryAccessButton"[^>]*>카메라·센서 다시 연결/);
  assert.match(html, /id="shareResultButton"[^>]*>결과 공유/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\.\/icons\/icon-192\.png"/);
  assert.match(html, /name="mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="DEADZONE: SWARM"/);
  assert.match(html, /name="application-name" content="DEADZONE: SWARM"/);
  assert.doesNotMatch(html, /zombie|좀비|fuse-female-zombie|possessed-undead/i);
});

test("배포본의 조준은 폰 기울기가 아니라 후면 카메라 방향을 따른다", async () => {
  const geometryUrl = new URL("public/game/src/ar-geometry.mjs", root);
  const controllerUrl = new URL("public/game/src/ar-controller.mjs", root);
  geometryUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  controllerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { cameraPoseFromDeviceOrientation } = await import(geometryUrl.href);
  const { ARController } = await import(controllerUrl.href);

  const right = cameraPoseFromDeviceOrientation(330, 90, 0);
  const upward = cameraPoseFromDeviceOrientation(0, 110, 0);
  const rollOnly = cameraPoseFromDeviceOrientation(330, 90, 30);

  assert.ok(Math.abs(right.yaw - 30) < 0.001);
  assert.ok(Math.abs(upward.pitch - 20) < 0.001);
  assert.ok(Math.abs(rollOnly.yaw) < 0.001);
  assert.ok(Math.abs(rollOnly.pitch) < 0.001);

  const createController = () => new ARController({
    globalObject: { performance: { now: () => 1000 } }
  });
  const calibratedView = (next) => {
    const controller = createController();
    controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0 });
    controller.calibrate();
    controller.handleOrientation(next);
    return controller.getView();
  };

  assert.ok(calibratedView({ alpha: 330, beta: 90, gamma: 0 }).yaw > 0.5);
  assert.ok(calibratedView({ alpha: 0, beta: 110, gamma: 0 }).pitch > 0.5);
  assert.ok(Math.abs(calibratedView({ alpha: 330, beta: 90, gamma: 30 }).yaw) < 0.1);

  const vertical = createController();
  vertical.handleOrientation({ alpha: 0, beta: 90, gamma: 0 });
  vertical.calibrate();
  vertical.handleOrientation({ alpha: 0, beta: 179.99, gamma: 0 });
  vertical.handleOrientation({ alpha: 180, beta: 179.99, gamma: 0 });
  vertical.handleOrientation({ alpha: 0, beta: 180.01, gamma: 0 });
  assert.ok(Math.abs(vertical.getView().yaw) < 0.1);

  const hysteresis = createController();
  hysteresis.handleOrientation({ alpha: 0, beta: 90, gamma: 0 });
  hysteresis.calibrate();
  hysteresis.handleOrientation({ alpha: 180, beta: 176, gamma: 0 });
  assert.ok(Math.abs(hysteresis.getView().yaw) < 0.1);
  hysteresis.handleOrientation({ alpha: 180, beta: 172, gamma: 0 });
  assert.ok(Math.abs(hysteresis.getView().yaw) < 0.1);
  hysteresis.handleOrientation({ alpha: 180, beta: 169, gamma: 0 });
  assert.ok(Math.abs(hysteresis.getView().yaw) > 10);

  const steep = createController();
  steep.handleOrientation({ alpha: 0, beta: 170, gamma: 0 });
  steep.calibrate();
  steep.handleOrientation({ alpha: 0, beta: 165, gamma: 0 });
  assert.ok(steep.getView().pitch < -0.5);
});

test("배포본은 앉은 자세 회전과 카메라 조준 선택기를 제공한다", async () => {
  const html = await readFile(new URL("public/game/index.html", root), "utf8");
  assert.match(html, /id="cameraAimButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="seatedTurnButton"[^>]*aria-pressed="true"/);
  assert.match(html, /카메라 조준/);
  assert.match(html, /앉은 자세 회전/);
});

test("배포본은 다섯 무기와 좌우 홀드 회전 버튼을 제공한다", async () => {
  const html = await readFile(new URL("public/game/index.html", root), "utf8");
  for (const id of ["sidearm", "burst", "scatter", "rail", "cryo"]) {
    assert.match(html, new RegExp(`id="weapon-${id}"`));
  }
  assert.match(html, /id="turnLeftButton"[^>]*aria-label="왼쪽으로 회전"/);
  assert.match(html, /id="turnRightButton"[^>]*aria-label="오른쪽으로 회전"/);
  assert.match(html, /BURST SMG/);
  assert.match(html, /고위력 관통/);
  assert.match(html, /적 감속 제어/);
});

test("스타터 미리보기 표식은 배포 코드에 남지 않는다", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /redirect\(["']\/game\/index\.html["']\)/);
  assert.match(layout, /DEADZONE: SWARM/);
  assert.match(layout, /후면 카메라[^"\n]*감염 곤충[^"\n]*제거/);
  assert.match(layout, /\/og\.png/);
  assert.doesNotMatch(`${page}${layout}${packageJson}`, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});
