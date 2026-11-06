# Verification scope

Baseline: complete build plus261 Node tests pass;2of12 fixed browser cases pass. Setup only added pinned browser tooling and a read-only localhost diagnostics view. Padded ammo text was compared numerically before freezing. Round10's native two-contact fixture was corrected after captured CDP events proved the wrong finger was being released; the corrected case was also run on the original setup commit and failed there. Other core cases and thresholds stayed fixed.

The21 recorded loops include actual product changes, fresh-source reproduction and release packaging. Failed candidates and retest decisions are retained locally; public experiments include each adopted change, rubric ratings, source hashes and measured command results. No-op setup or repeated test executions are counted as improvement loops.

Final required checks:263 Node/build tests;21 browser cases on desktop and21 on touch mobile;5 production browser cases across full pinned Chromium, touch Chromium and WebKit; original strict native graphics smoke; fresh lockfile install from source. All browser projects have zero retries. The graphics smoke retains its original average25ms and p9550ms limits and checks real model/shader readiness, bounded pools, native context loss and teardown.

Core and production user journeys use real UI and a naturally completed seeded8second mission. Camera recovery tests use canvas.captureStream and deferred browser promises, without physical camera access. Sensor events and lifecycle notifications are synthetic boundary probes. Maximum-world graphics fixtures deliberately inject stress state and are not presented as natural gameplay. Browser emulation does not replace a physical-device test.

Local final results and the published Actions run are recorded after execution. Images in the README come from the production browser, not a design mockup. An implementation-agent rubric score is not an independent usability, safety or performance certification.

Local result on2026-11-06: all required checks passed.263/263 Node tests;42/42 development browser cases;5/5 production browser cases, no skips/failures/retries. The original strict graphics smoke passed on the full Playwright-pinned Chromium binary. Fresh-source install/build/tests passed in round19. The rubric moved from33/100 to80/100 after21 adopted loops; round10 and round13 each retained an unsuccessful first candidate before a passing correction. Public CI remains the final independent environment check.

The first public CI desktop/mobile jobs passed. Its production setup was cancelled after8minutes because the runner Azure Ubuntu mirror downloaded only a small part of114MB. The CI-only correction switches that job to the upstream Ubuntu archive and bounds installation time; application source, browser assertions and graphics thresholds remain unchanged. This infrastructure correction is not counted as an additional improvement loop.

Round21 isolates the real-app negative pagehide probe from the unrelated maximum-world workload. Its original30second deadline and both expected error assertions are unchanged. Normal graphics smoke still runs every original workload and threshold. The pinned Chromium binary is used consistently. Local263checks and the complete positive graphics smoke passed again; CI package mirror correction now applies to every job.

The first isolated negative fixture was too early: intro had loaded model responses but no rendered3D proof. CI correctly rejected the request-abort classification before reaching the injected errors. Round21 was retested with a loaded and rendered model frame required before teardown. The request-failure classifier and both original error assertions are unchanged.
