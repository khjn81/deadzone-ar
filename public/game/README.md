# DEADZONE: SWARM assets and renderer

## Infected insect models

The renderer keeps the gameplay roles (`swarmer`, `stinger`, `bulwark`, and
the `elite`/`queen` presentation) stable while selecting a distinct local GLB
for each species. Every model is bundled with its attribution sidecar and is
available offline; no runtime request is made to the upstream model pages.

| Gameplay role | Bundled model and open source | SHA-256 | License / runtime treatment |
| --- | --- | --- | --- |
| `swarmer` | [`infected-swarmer.glb`](./assets/models/infected-swarmer.glb), [MosquitoInAmber](https://sketchfab.com/3d-models/real-time-refraction-demo-mosquito-in-amber-37233d6ed84844fea1ebe88069ea58d1) by Loïc Norgeot, Geoffrey Marchal, and Sketchfab | `ccda1802038a0399b2c9cc835fa313e5b710455f484d3d44da7e57833b177d4b` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); infected materials and weak-point overlay at runtime |
| `stinger` | [`infected-stinger.glb`](./assets/models/infected-stinger.glb), [Armabee Evolved](https://poly.pizza/m/GcttdvsqsQ) by Quaternius | `61a48cfba610e46abba0c98f5371d331f60ed087a55a335580cbf27ba4b3d190` | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/); infection materials, scale, animation, and weak-point overlay at runtime |
| `bulwark` | [`infected-bulwark.glb`](./assets/models/infected-bulwark.glb), [Ladybird](https://poly.pizza/m/3tCnJC9UYA) by Exceptional_3D | `718b2be1cd6c1b4361e9e4cb7610459b994575d9e3e7b7818348670f53612166` | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/); infection materials, scale, animation, and weak-point overlay at runtime |
| `elite` / `queen` | [`infected-queen.glb`](./assets/models/infected-queen.glb), [Bee Enemy](https://poly.pizza/m/6HsU6GQt3a) by Quaternius | `29a3ac29e6859208bdab9db3d34387e1d154f14564bd17cdc57eda669cb557cf` | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/); enlarged queen presentation with infection materials and weak-point overlay |

The adjacent `infected-swarmer.CC-BY-4.0.txt` and
`infected-{stinger,bulwark,queen}.CC0-1.0.txt` files are required with every
redistribution. Each records the source URL, author, license, source/download
hash, and the runtime-only changes. The three Poly Pizza downloads are
preserved byte-for-byte; their `Derived SHA-256` therefore matches the
`Original SHA-256` in each sidecar.

The four GLBs total 2,490,804 bytes (about 2.38 MiB) before browser decoding.
This is the complete precached model budget for the species set. Runtime pools
remain bounded at six live insects and four corpses, with one shared WebGL
context and a 1.5 device-pixel-ratio cap during camera play. If one model
fails, that species uses a bounded procedural Three.js template while the
remaining models stay live. If the Three.js context fails, the same frame
falls back to the procedural Canvas renderer.

## Rendering architecture and limits

`src/renderer.mjs` remains the synchronous Canvas facade. It projects world
coordinates through `src/ar-geometry.mjs`, draws the camera grade, aim UI, and
particles, and sends live insect, corpse, casing, impact, and fragment
descriptors to `src/three-world-layer.mjs`. That world layer owns one
transparent WebGL context and reuses the same model geometry and textures.

Runtime collections are deliberately bounded for mobile devices:

- 6 live insects
- 4 corpses
- 8 impact marks
- 20 shell casings
- 36 fragments

If the Three.js runtime, WebGL context, or frame render fails, the facade
permanently switches to the procedural Canvas insect renderer in the same
frame. An individual GLB load failure is isolated to that species and keeps
the Three.js scene alive with its bounded procedural template. The 2D fallback
covers both live insects and corpses and does not draw ground-contact shadows.

## Camera privacy and performance

The rear camera remains a browser-managed `<video>` layer. Camera frames are
never copied or uploaded into WebGL, and no camera image is stored or sent to a
server. While the camera is active, the renderer caps device pixel ratio at
1.5 to protect mobile frame time.

From the repository root, run `npm run smoke:three:browser` to serve the
committed game locally and exercise the real browser shader, GLB/PBR texture,
alpha-composition, pool-cap, camera-budget, and context-loss paths. Set
`DEADZONE_CHROME_PATH` only when Chrome or Chromium is installed outside its
conventional platform location.

## Aim controls

The intro screen defaults to `SEATED TURN` for players who are sitting down.
After calibration, tilt the phone a few degrees to the left or right and the
virtual camera keeps turning in that direction; return to the neutral band to
stop without recentering. The deadzone is about 6 degrees and the turn rate is
bounded at 120 degrees per second, so a 90° or 180° sweep does not require
turning your whole body.

`CAMERA AIM` remains available for standing play: the rear-camera direction
controls the view directly. Recalibration should be done while the phone is
held in the desired neutral position. If motion sensors are unavailable, the
existing drag-to-aim touch fallback remains active.

## Weapon deck and seated controls

The loadout is available before deployment and in the lower HUD during a
mission. The selected weapon is persisted locally on the device; a fresh
install starts with `BURST SMG`.

| Weapon | Magazine | Trigger behavior | Tactical role |
| --- | ---: | --- | --- |
| `SIDEARM` | 8 | Precise single shot | Reliable weak-point damage |
| `BURST SMG` | 24 | Three projectiles per trigger | Stable sustained fire |
| `SCATTER` | 6 | Six-pellet spread | Close-range area coverage |
| `RAIL` | 3 | High damage, pierces up to three targets | Line-up multiple insects |
| `CRYO` | 12 | Damage plus a 2.5-second slow | Control fast approaches |

Tap a loadout chip to switch weapons; each weapon keeps its own magazine. The
large `HOLD` buttons at the left and right edges are an accessibility fallback
for seated play: press and hold to turn continuously, then release to brake.
They work alongside the seated sensor mode and the drag-to-aim fallback. Rail
shots have a bright kinetic burst, while Cryo hits show a freeze burst and
`FROZEN` feedback. All casing, impact, and particle pools remain bounded for
mobile performance.
