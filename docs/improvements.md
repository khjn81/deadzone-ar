# Improvement record

Setup is excluded. Scores are implementation-agent rubric judgments out of100. Baseline:33;20 adopted loops:80. Failed attempts are retained in local raw evidence; rounds10and13 required a correction before adoption.

| Round | Adopted change | Score |
| --- | --- | ---: |
| 1 | Catch blocked reads and normalize finite nonnegative scores. | 36 |
| 2 | Guard camera/sensor continuations with generations; separate cancellable access cleanup from terminal destroy. | 38 |
| 3 | Cancel access on training selection and ignore stale launch/retry continuations and destroyed app callbacks. | 39 |
| 4 | Start audio from the user gesture without waiting for its optional asynchronous completion. | 41 |
| 5 | Observe track termination, stop and detach the owned stream, remove listeners on cancellation, and publish the camera state. | 44 |
| 6 | Invalidate pending launches, clear calibration timers and return to intro when preparation becomes hidden. | 46 |
| 7 | Focus resume on pause, isolate the HUD and drag controls, trap Tab in the dialog and return focus when resuming. | 49 |
| 8 | Handle native button clicks with the same7degree turn and require a live mission. | 50 |
| 9 | Make the canvas focusable; add Escape pause/resume and Space/R combat actions with repeat, modifier and editable/native-control guards. | 52 |
| 10 | Track button/pointer ownership, ignore unowned releases and release captures without cancelling newer input. | 55 |
| 11 | Distinguish persisted pagehide from permanent departure, cancel pending preparation and preserve a paused application. | 58 |
| 12 | Consume visible frame gaps in at-most1/60s simulation steps; explicitly pause stalls longer than2s. | 61 |
| 13 | Finish at most one final pause frame to preserve threat-audio cleanup, then stop recurrent RAF; redraw inactive views only on visible resize or camera-status changes. | 63 |
| 14 | Gate registered orientation events by active lifecycle and monotonic sample order; retain direct smoothing semantics and reset timing on resume. | 65 |
| 15 | Cancel owned pointer gestures and turn velocity when leaving play; pause on blur or blocked landscape and require explicit valid-viewport resume. | 66 |
| 16 | Cancel pending and active access on hide, skip hidden drawing, and preserve paused training plus explicit camera retry. | 66 |
| 17 | Raise compact weapon/pause target minimums, increase weapon text and remove the zoom prohibition. | 68 |
| 18 | Add deterministic shell hashing and a prebuild consistency gate; replace the old literal-version assertion with an exact content-derived assertion. | 69 |
| 19 | Add14 asset checks, byte-identical Three.js regeneration and an isolated lockfile install/build/full-test verification; independently verify original model downloads and1195 npm package files. | 71 |
| 20 | Add honest setup/controls/limits, MIT and third-party notices, pinned CI,42 development E2E cases,5 production holdouts and the original strict native graphics smoke. | 80 |

The round10 touch fixture was corrected and re-run against the original source; the original source still failed. Round13 preserved the existing final pause-frame audio contract before stopping continuous rendering. No browser retry or performance threshold was relaxed.
