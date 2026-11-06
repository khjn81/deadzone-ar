import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const modelUrl = new URL('../public/game/assets/models/infected-swarmer.glb', import.meta.url);
const creditUrl = new URL('../public/game/assets/models/infected-swarmer.CC-BY-4.0.txt', import.meta.url);
const cc0AssetCases = [
  {
    id: 'stinger',
    model: 'infected-stinger.glb',
    credit: 'infected-stinger.CC0-1.0.txt',
    title: 'Armabee Evolved — infected stinger derivative',
    author: 'Quaternius',
    sourceUrl: 'https://poly.pizza/m/GcttdvsqsQ',
    downloadUrl: 'https://static.poly.pizza/fb7d7a9e-5584-4e0b-a1bf-251fc9946696.glb',
    sha256: '61a48cfba610e46abba0c98f5371d331f60ed087a55a335580cbf27ba4b3d190',
    maxTriangles: 3_500,
  },
  {
    id: 'bulwark',
    model: 'infected-bulwark.glb',
    credit: 'infected-bulwark.CC0-1.0.txt',
    title: 'Ladybird — infected bulwark derivative',
    author: 'Exceptional_3D',
    sourceUrl: 'https://poly.pizza/m/3tCnJC9UYA',
    downloadUrl: 'https://static.poly.pizza/8e228e46-8838-4362-80ef-297b8d281966.glb',
    sha256: '718b2be1cd6c1b4361e9e4cb7610459b994575d9e3e7b7818348670f53612166',
    maxTriangles: 9_000,
  },
  {
    id: 'queen',
    model: 'infected-queen.glb',
    credit: 'infected-queen.CC0-1.0.txt',
    title: 'Bee Enemy — infected queen derivative',
    author: 'Quaternius',
    sourceUrl: 'https://poly.pizza/m/6HsU6GQt3a',
    downloadUrl: 'https://static.poly.pizza/19203489-125b-41f5-b9c9-801a522cb775.glb',
    sha256: '29a3ac29e6859208bdab9db3d34387e1d154f14564bd17cdc57eda669cb557cf',
    maxTriangles: 3_500,
  },
];

function assetUrl(fileName) {
  return new URL(`../public/game/assets/models/${fileName}`, import.meta.url);
}

async function recursiveFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directoryUrl);
    return entry.isDirectory() ? recursiveFiles(url) : [url];
  }));
  return nested.flat();
}

async function readFileUtf8(url) {
  return readFile(url, 'utf8');
}

function parseGlb(buffer) {
  assert.ok(buffer.length >= 20, 'GLB is too short for a header and JSON chunk');
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, 'GLB magic must be glTF');
  assert.equal(buffer.readUInt32LE(4), 2, 'GLB version must be 2');
  assert.equal(buffer.readUInt32LE(8), buffer.length, 'GLB header length must match file size');

  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a, 'first GLB chunk must be JSON');
  assert.ok(jsonLength <= buffer.length - 20, 'GLB JSON chunk exceeds file bounds');

  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trim());
  const binaryHeaderOffset = 20 + jsonLength;
  assert.ok(binaryHeaderOffset + 8 <= buffer.length, 'GLB needs a binary chunk header');
  const binaryLength = buffer.readUInt32LE(binaryHeaderOffset);
  assert.equal(buffer.readUInt32LE(binaryHeaderOffset + 4), 0x004e4942, 'second GLB chunk must be BIN');
  const binaryStart = binaryHeaderOffset + 8;
  assert.equal(binaryStart + binaryLength, buffer.length, 'binary chunk must cover the remaining file bytes');

  return { binaryLength, gltf };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countTriangles(gltf) {
  return (gltf.meshes || []).flatMap((mesh) => mesh.primitives || []).reduce((total, primitive) => {
    const accessorIndex = Number.isInteger(primitive.indices)
      ? primitive.indices
      : primitive.attributes?.POSITION;
    const accessor = gltf.accessors?.[accessorIndex];
    return total + (accessor?.count || 0) / 3;
  }, 0);
}

function estimatedDecodedTextureBytes(gltf) {
  return (gltf.images || []).reduce((total, image) => {
    const width = Number(image.extras?.width) || 0;
    const height = Number(image.extras?.height) || 0;
    return total + width * height * 4;
  }, 0);
}

test('infected insect asset is portable, licensed, and mobile-sized', async () => {
  const [bytes, credit] = await Promise.all([readFile(modelUrl), readFile(creditUrl, 'utf8')]);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  const { gltf: json } = parseGlb(bytes);
  assert.ok(json.scenes?.length > 0);
  assert.ok(json.meshes?.length > 0);
  assert.equal(json.extensionsRequired?.length || 0, 0);
  assert.ok(json.materials?.some((material) =>
    Number.isInteger(material.pbrMetallicRoughness?.baseColorTexture?.index)
    && Number.isInteger(material.normalTexture?.index)));
  assert.equal(json.images?.length, 2);
  assert.deepEqual(
    json.images.map((image) => image.extras),
    [
      { width: 1024, height: 1024 },
      { width: 1024, height: 1024 },
    ],
    'embedded image metadata should preserve the exact decoded texture dimensions',
  );
  for (const image of json.images) {
    assert.ok(Number.isInteger(image.bufferView));
    assert.equal(image.uri, undefined);
    assert.ok(Number(image.extras?.width) > 0);
    assert.ok(Number(image.extras?.height) > 0);
  }
  for (const buffer of json.buffers || []) {
    assert.equal(buffer.uri, undefined, 'the derived insect must keep binary data embedded in the GLB');
  }

  const primitives = json.meshes.flatMap((mesh) => mesh.primitives ?? []);
  const positionAccessors = primitives.map((primitive) => json.accessors[primitive.attributes.POSITION]);
  assert.equal(positionAccessors.length, 1, 'the derived insect should retain one mesh primitive');

  const position = positionAccessors[0];
  assert.equal(position.type, 'VEC3', 'POSITION bounds should describe 3D vertices');
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(
      Math.abs(position.min[axis] + position.max[axis]) < 1e-7,
      `POSITION bounds should be centered at the origin on axis ${axis}`,
    );
  }

  const spans = position.max.map((maximum, axis) => maximum - position.min[axis]);
  assert.ok(spans[2] > spans[1] && spans[1] > spans[0], "the insect's longest numeric axis should be +Z/-Z");
  assert.equal(json.extras?.forwardAxis, '+Z', 'the derived asset should declare its gameplay forward axis');
  assert.equal(
    json.asset?.extras?.license,
    'CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)',
    'embedded attribution should retain the canonical CC BY 4.0 URI',
  );

  assert.ok(countTriangles(json) <= 18_000);
  assert.ok(estimatedDecodedTextureBytes(json) <= 16 * 1024 * 1024);

  const manifestKeys = credit.trimEnd().split('\n').map((line) => line.slice(0, line.indexOf(':')));
  assert.deepEqual(
    manifestKeys,
    ['Title', 'Author', 'Source URL', 'License', 'Original SHA-256', 'Derived SHA-256', 'Changes'],
    'the attribution manifest should retain the seven required keys in a stable order',
  );
  assert.match(
    credit,
    /^Source URL: https:\/\/sketchfab\.com\/3d-models\/real-time-refraction-demo-mosquito-in-amber-37233d6ed84844fea1ebe88069ea58d1$/m,
  );
  assert.match(credit, /^License: CC BY 4\.0 \(https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\)$/m);
  assert.match(
    credit,
    /https:\/\/github\.com\/KhronosGroup\/glTF-Sample-Assets\/tree\/main\/Models\/MosquitoInAmber/,
  );
  assert.match(
    credit,
    /https:\/\/raw\.githubusercontent\.com\/KhronosGroup\/glTF-Sample-Assets\/main\/Models\/MosquitoInAmber\/glTF-Binary\/MosquitoInAmber\.glb/,
  );
  assert.match(
    credit,
    /^Original SHA-256: 1c0b49000650e8a8c00d69bc8d64e46d33527871a47d74e4f2278887325cc35f$/m,
  );
  assert.match(credit, new RegExp(`^Derived SHA-256: ${sha256(bytes)}$`, 'm'));
});

test('approved CC0 species assets are local, pinned, and mobile-sized', async () => {
  for (const asset of cc0AssetCases) {
    const [bytes, credit] = await Promise.all([
      readFile(assetUrl(asset.model)),
      readFile(assetUrl(asset.credit), 'utf8'),
    ]);
    const { gltf } = parseGlb(bytes);

    assert.equal(sha256(bytes), asset.sha256, `${asset.id} GLB must stay pinned to its reviewed bytes`);
    assert.ok(gltf.scenes?.length > 0, `${asset.id} GLB needs a scene`);
    assert.ok(gltf.meshes?.length > 0, `${asset.id} GLB needs at least one mesh`);
    assert.equal(gltf.extensionsRequired?.length || 0, 0, `${asset.id} must not require optional runtime extensions`);
    assert.ok(bytes.length <= 1_000_000, `${asset.id} must stay below the one-megabyte mobile asset budget`);
    assert.ok(countTriangles(gltf) <= asset.maxTriangles, `${asset.id} exceeds its reviewed triangle budget`);
    assert.ok(
      estimatedDecodedTextureBytes(gltf) <= 16 * 1024 * 1024,
      `${asset.id} exceeds the decoded texture memory budget`,
    );
    for (const buffer of gltf.buffers || []) {
      assert.equal(buffer.uri, undefined, `${asset.id} must keep binary data embedded in the GLB`);
    }
    for (const image of gltf.images || []) {
      assert.equal(image.uri, undefined, `${asset.id} must keep textures embedded in the GLB`);
      assert.ok(Number.isInteger(image.bufferView), `${asset.id} image must reference an embedded buffer view`);
    }

    const manifestKeys = credit.trimEnd().split('\n').map((line) => line.slice(0, line.indexOf(':')));
    assert.deepEqual(
      manifestKeys,
      ['Title', 'Author', 'Source URL', 'License', 'Original SHA-256', 'Derived SHA-256', 'Changes'],
      `${asset.id} attribution manifest should retain the stable seven-key format`,
    );
    assert.match(credit, new RegExp(`^Title: ${escapeRegExp(asset.title)}$`, 'm'));
    assert.match(credit, new RegExp(`^Author: ${escapeRegExp(asset.author)}$`, 'm'));
    assert.match(credit, new RegExp(`^Source URL: ${escapeRegExp(asset.sourceUrl)}$`, 'm'));
    assert.match(credit, /^License: CC0 1\.0 Universal \(https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/\)$/m);
    assert.match(credit, /^Original SHA-256: [a-f0-9]{64}$/m);
    assert.match(credit, new RegExp(`^Derived SHA-256: ${asset.sha256}$`, 'm'));
    assert.match(credit, new RegExp(`^Changes: .*${escapeRegExp(asset.downloadUrl)}`, 'm'));
  }
});

test('deployable game contains no zombie runtime or model assets', async () => {
  const files = await recursiveFiles(new URL('../public/game/', import.meta.url));
  assert.deepEqual(files.filter((file) => /zombie|undead/i.test(file.pathname)), []);
  const sources = await Promise.all(files
    .filter((file) => /\.(?:mjs|html|css|md)$/.test(file.pathname))
    .map(readFileUtf8));
  assert.doesNotMatch(
    sources.join('\n'),
    /three-enemy-layer|enemy-visuals|zombie-realism|fuse-female|possessed-undead/i,
  );
});
