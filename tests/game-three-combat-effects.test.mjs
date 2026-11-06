import assert from 'node:assert/strict';
import test from 'node:test';

import { createThreeCombatEffects } from '../public/game/src/three-combat-effects.mjs';
import { THREE as bundledThree } from '../public/game/src/vendor/three-runtime.mjs';

function instrumentedRuntime({ throwMaterialCloneAt = 0, throwMeshAt = 0 } = {}) {
  const created = { geometries: [], materials: [], meshes: [], textures: [] };
  let materialCloneAttempts = 0;
  let meshAttempts = 0;

  function resource(Base, key) {
    return class extends Base {
      constructor(...args) {
        super(...args);
        this.disposeCalls = 0;
        created[key].push(this);
      }

      dispose(...args) {
        this.disposeCalls += 1;
        return super.dispose(...args);
      }

      clone(...args) {
        if (key === 'materials') {
          materialCloneAttempts += 1;
          if (materialCloneAttempts === throwMaterialCloneAt) {
            throw new Error('fixture pooled material clone failure');
          }
        }
        return super.clone(...args);
      }
    };
  }

  class Mesh extends bundledThree.Mesh {
    constructor(...args) {
      super(...args);
      meshAttempts += 1;
      if (meshAttempts === throwMeshAt) throw new Error('fixture pooled mesh failure');
      created.meshes.push(this);
    }
  }

  class InstancedMesh extends bundledThree.InstancedMesh {
    constructor(...args) {
      meshAttempts += 1;
      if (meshAttempts === throwMeshAt) throw new Error('fixture pooled mesh failure');
      super(...args);
      this.disposeCalls = 0;
      created.meshes.push(this);
    }
    dispose(...args) { this.disposeCalls += 1; return super.dispose(...args); }
  }

  return {
    created,
    runtime: {
      ...bundledThree,
      BoxGeometry: resource(bundledThree.BoxGeometry, 'geometries'),
      CylinderGeometry: resource(bundledThree.CylinderGeometry, 'geometries'),
      DataTexture: resource(bundledThree.DataTexture, 'textures'),
      Mesh,
      InstancedMesh,
      MeshBasicMaterial: resource(bundledThree.MeshBasicMaterial, 'materials'),
      MeshStandardMaterial: resource(bundledThree.MeshStandardMaterial, 'materials'),
      PlaneGeometry: resource(bundledThree.PlaneGeometry, 'geometries')
    }
  };
}

function impactRoots(scene) {
  return scene.children.filter((mesh) => mesh.userData.effectPool === 'impact');
}

function impactFrame(firstOpacity, secondOpacity, firstFlash, secondFlash) {
  return {
    casings: [],
    fragments: [],
    fluids: [],
    impacts: [
      { id: 1, x: 100, y: 200, visible: true, opacity: firstOpacity, flashOpacity: firstFlash },
      { id: 2, x: 300, y: 600, visible: true, opacity: secondOpacity, flashOpacity: secondFlash }
    ]
  };
}

test('impact slots own independent render-state materials without frame or reset allocations', () => {
  const { created, runtime } = instrumentedRuntime();
  const scene = new bundledThree.Scene();
  const effects = createThreeCombatEffects(scene, runtime);
  const impacts = impactRoots(scene);
  const flashes = impacts.map((impact) => impact.children[0]);

  assert.equal(impacts.length, 8);
  assert.equal(new Set(impacts.map(({ material }) => material)).size, 8);
  assert.equal(new Set(flashes.map(({ material }) => material)).size, 8);
  assert.equal(new Set(impacts.map(({ geometry }) => geometry)).size, 1);
  assert.equal(new Set(flashes.map(({ geometry }) => geometry)).size, 1);
  assert.equal(new Set([...impacts, ...flashes].map(({ material }) => material.alphaMap)).size, 1);
  assert.deepEqual(
    { geometries: created.geometries.length, materials: created.materials.length, meshes: created.meshes.length, textures: created.textures.length },
    { geometries: 3, materials: 20, meshes: 18, textures: 1 }
  );

  const allocations = {
    geometries: created.geometries.length,
    materials: created.materials.length,
    meshes: created.meshes.length,
    textures: created.textures.length
  };
  effects.render(impactFrame(0.21, 0.73, 0.12, 0.68), { width: 400, height: 800 });
  assert.deepEqual(impacts.slice(0, 2).map(({ material }) => material.opacity), [0.21, 0.73]);
  assert.deepEqual(flashes.slice(0, 2).map(({ material }) => material.opacity), [0.12, 0.68]);

  effects.resetMission();
  assert.ok(impacts.every((impact) => impact.visible === false && impact.material.opacity === 0));
  assert.ok(flashes.every((flash) => flash.visible === false && flash.material.opacity === 0));
  effects.render(impactFrame(0.64, 0.31, 0.8, 0.24), { width: 400, height: 800 });
  assert.deepEqual(impacts.slice(0, 2).map(({ material }) => material.opacity), [0.64, 0.31]);
  assert.deepEqual(flashes.slice(0, 2).map(({ material }) => material.opacity), [0.8, 0.24]);
  assert.deepEqual({
    geometries: created.geometries.length,
    materials: created.materials.length,
    meshes: created.meshes.length,
    textures: created.textures.length
  }, allocations);

  effects.destroy();
  effects.destroy();
  assert.ok([...created.geometries, ...created.materials, ...created.textures]
    .every(({ disposeCalls }) => disposeCalls === 1));
  assert.ok(created.meshes.filter(mesh => mesh.isInstancedMesh).every(mesh => mesh.disposeCalls === 1));
  assert.equal(scene.children.length, 0);
});

test('partial impact construction disposes base and created slot resources exactly once', () => {
  const { created, runtime } = instrumentedRuntime({ throwMeshAt: 3 });
  const scene = new bundledThree.Scene();

  assert.throws(
    () => createThreeCombatEffects(scene, runtime),
    /fixture pooled mesh failure/
  );
  assert.deepEqual(
    { geometries: created.geometries.length, materials: created.materials.length, textures: created.textures.length },
    { geometries: 3, materials: 6, textures: 1 }
  );
  assert.ok([...created.geometries, ...created.materials, ...created.textures]
    .every(({ disposeCalls }) => disposeCalls === 1));
  assert.ok(created.meshes.filter(mesh => mesh.isInstancedMesh).every(mesh => mesh.disposeCalls === 1));
  assert.equal(scene.children.length, 0);
});

test('a failure between paired slot clones rolls back the first clone', () => {
  const { created, runtime } = instrumentedRuntime({ throwMaterialCloneAt: 2 });
  const scene = new bundledThree.Scene();

  assert.throws(
    () => createThreeCombatEffects(scene, runtime),
    /fixture pooled material clone failure/
  );
  assert.deepEqual(
    { geometries: created.geometries.length, materials: created.materials.length, textures: created.textures.length },
    { geometries: 3, materials: 5, textures: 1 }
  );
  assert.ok([...created.geometries, ...created.materials, ...created.textures]
    .every(({ disposeCalls }) => disposeCalls === 1));
  assert.ok(created.meshes.filter(mesh => mesh.isInstancedMesh).every(mesh => mesh.disposeCalls === 1));
  assert.equal(scene.children.length, 0);
});
