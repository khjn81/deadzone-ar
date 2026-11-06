const MODEL_ROOT = new URL('../assets/models/', import.meta.url);

function modelUrl(fileName) {
  return new URL(fileName, MODEL_ROOT).href;
}

const PROFILES = {
  swarmer: {
    displayName: '감염 각다귀',
    modelKind: 'swarmer',
    modelUrl: modelUrl('infected-swarmer.glb'),
    widthScale: 0.78,
    bodyScale: 0.74,
    silhouette: {
      bodyWidth: 0.76,
      bodyHeight: 1.2,
      headScale: 0.72,
      abdomenScale: 1.24,
      wingSpan: 1.2,
      wingDepth: 0.86,
      weakPointScale: 1
    },
    wingRate: 1.55,
    wingStyle: 'mosquito',
    weakPointStyle: 'abdomen',
    deathStyle: 'twitch',
    weakPointColor: 0xd7ef42,
    baseColor: 0x25271d,
    fluidColor: 0x718414,
    wingTint: 0xb9c7aa,
    roughness: 0.76,
    metalness: 0.04,
    canvasPalette: {
      body: '#25271d',
      edge: '#718414',
      eye: '#d7ef42',
      wing: 'rgba(185, 199, 170, .42)'
    }
  },
  stinger: {
    displayName: '감염 말벌',
    modelKind: 'stinger',
    modelUrl: modelUrl('infected-stinger.glb'),
    widthScale: 1,
    bodyScale: 1,
    silhouette: {
      bodyWidth: 0.94,
      bodyHeight: 1.08,
      headScale: 0.84,
      abdomenScale: 1.08,
      wingSpan: 1.02,
      wingDepth: 0.92,
      weakPointScale: 0.84
    },
    wingRate: 1.2,
    wingStyle: 'wasp',
    weakPointStyle: 'abdomen',
    deathStyle: 'curl',
    weakPointColor: 0xd7ef42,
    baseColor: 0x302a19,
    fluidColor: 0x8c9a1b,
    wingTint: 0xc8d2bc,
    roughness: 0.7,
    metalness: 0.07,
    canvasPalette: {
      body: '#302a19',
      edge: '#8c9a1b',
      eye: '#d7ef42',
      wing: 'rgba(200, 210, 188, .42)'
    }
  },
  bulwark: {
    displayName: '감염 딱정벌레',
    modelKind: 'bulwark',
    modelUrl: modelUrl('infected-bulwark.glb'),
    widthScale: 0.72,
    bodyScale: 1.18,
    silhouette: {
      bodyWidth: 1.28,
      bodyHeight: 0.82,
      headScale: 0.98,
      abdomenScale: 0.84,
      wingSpan: 0.68,
      wingDepth: 0.72,
      weakPointScale: 0.76
    },
    wingRate: 0.72,
    wingStyle: 'shell',
    weakPointStyle: 'side-plate',
    deathStyle: 'shell-roll',
    weakPointColor: 0xff3b21,
    baseColor: 0x181914,
    fluidColor: 0x66710f,
    wingTint: 0xabb8a6,
    roughness: 0.62,
    metalness: 0.14,
    canvasPalette: {
      body: '#181914',
      edge: '#66710f',
      eye: '#ff3b21',
      wing: 'rgba(171, 184, 166, .38)'
    }
  },
  queen: {
    displayName: '감염 여왕',
    modelKind: 'queen',
    modelUrl: modelUrl('infected-queen.glb'),
    widthScale: 1.18,
    bodyScale: 1.28,
    silhouette: {
      bodyWidth: 1.16,
      bodyHeight: 1.18,
      headScale: 0.9,
      abdomenScale: 1.34,
      wingSpan: 0.82,
      wingDepth: 1.16,
      weakPointScale: 1.08
    },
    wingRate: 0.88,
    wingStyle: 'queen',
    weakPointStyle: 'thorax-core',
    deathStyle: 'queen-collapse',
    weakPointColor: 0xff7a32,
    baseColor: 0x241a14,
    fluidColor: 0xd46b1f,
    wingTint: 0xc8b7a2,
    roughness: 0.58,
    metalness: 0.18,
    canvasPalette: {
      body: '#241a14',
      edge: '#d46b1f',
      eye: '#ff7a32',
      wing: 'rgba(200, 183, 162, .48)'
    }
  }
};

for (const profile of Object.values(PROFILES)) {
  Object.freeze(profile.canvasPalette);
  Object.freeze(profile.silhouette);
  Object.freeze(profile);
}

export const SPECIES_PROFILES = Object.freeze(PROFILES);

function ownSpecies(value) {
  try {
    return typeof value === 'string' && Object.hasOwn(SPECIES_PROFILES, value) ? value : null;
  } catch {
    return null;
  }
}

export function speciesForEnemy(type = 'stinger', elite = false) {
  if (elite === true) return 'queen';
  return ownSpecies(type) || 'stinger';
}

export function speciesProfile(species = 'stinger') {
  return SPECIES_PROFILES[ownSpecies(species) || 'stinger'];
}
