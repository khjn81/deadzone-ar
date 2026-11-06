# Third-party notices

The root MIT license covers authored application code. It does not relicense third-party models or dependencies.

- Three.js0.185.1: MIT, bundled notice at [THREE-LICENSE.txt](public/game/src/vendor/THREE-LICENSE.txt). The committed bundle reproduces byte-for-byte from pinned npm dependencies; `npm run assets:check` verifies this. The official npm tarball integrity and1195 installed files were compared on2026-11-06.
- Swarmer mosquito: Loïc Norgeot (model), Geoffrey Marchal (scan), and Sketchfab. [Khronos source and authorship](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MosquitoInAmber), [CC BY4.0](https://creativecommons.org/licenses/by/4.0/). The mosquito was extracted from the amber sample, optimized, texture-resized, recentered and axis-normalized. [Full transformation/source/hash notice](public/game/assets/models/infected-swarmer.CC-BY-4.0.txt) must accompany redistribution. This transformed derivative is not claimed byte-identical to the original source.
- Stinger: [Armabee Evolved](https://poly.pizza/m/GcttdvsqsQ), Quaternius; CC0. [Notice](public/game/assets/models/infected-stinger.CC0-1.0.txt).
- Bulwark: [Ladybird](https://poly.pizza/m/3tCnJC9UYA), Exceptional_3D; CC0. [Notice](public/game/assets/models/infected-bulwark.CC0-1.0.txt).
- Queen: [Bee Enemy](https://poly.pizza/m/6HsU6GQt3a), Quaternius; CC0. [Notice](public/game/assets/models/infected-queen.CC0-1.0.txt).

The three CC0 GLBs were downloaded again from their recorded original URLs and matched the committed bytes on2026-11-06. Infection materials, scale, animation and weak-point overlays are applied at runtime. Model author/license links also remain visible in pause and result screens. Keep all adjacent license files when redistributing the assets.

[Asset hashes](quality/assets.json) and [upstream verification](quality/upstream-verification.json) record scope and evidence. Other npm package licenses remain with their distributions; package-lock.json pins versions and integrity values.
