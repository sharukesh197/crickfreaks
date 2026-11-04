import * as THREE from 'three';
import { BallColorVariant } from '../../shared/constants';

export interface ProceduralTextureBundle {
  outfieldMap: THREE.CanvasTexture;
  outfieldRoughnessMap: THREE.CanvasTexture;
  pitchMap: THREE.CanvasTexture;
  pitchBumpMap: THREE.CanvasTexture;
  willowWoodMap: THREE.CanvasTexture;
  ballMaps: Record<BallColorVariant, THREE.CanvasTexture>;
  dispose: () => void;
}

/**
 * Generates zero-404 procedural CanvasTextures for the cricket ground, pitch, wood, and stitched balls.
 */
export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureBundle {
  const outfieldMap = createOutfieldGrassTexture(maxAnisotropy);
  const outfieldRoughnessMap = createOutfieldRoughnessTexture(maxAnisotropy);
  const pitchMap = createPitchClayTexture(maxAnisotropy);
  const pitchBumpMap = createPitchBumpTexture(maxAnisotropy);
  const willowWoodMap = createWillowWoodTexture(maxAnisotropy);
  const ballMaps: Record<BallColorVariant, THREE.CanvasTexture> = {
    red: createCricketBallTexture('red', maxAnisotropy),
    white: createCricketBallTexture('white', maxAnisotropy),
    pink: createCricketBallTexture('pink', maxAnisotropy),
  };

  return {
    outfieldMap,
    outfieldRoughnessMap,
    pitchMap,
    pitchBumpMap,
    willowWoodMap,
    ballMaps,
    dispose: () => {
      outfieldMap.dispose();
      outfieldRoughnessMap.dispose();
      pitchMap.dispose();
      pitchBumpMap.dispose();
      willowWoodMap.dispose();
      ballMaps.red.dispose();
      ballMaps.white.dispose();
      ballMaps.pink.dispose();
    },
  };
}

function createOutfieldGrassTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base rich turf green
  ctx.fillStyle = '#245c2a';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle mowing stripes (8 bands)
  const bands = 8;
  const bandWidth = 512 / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(62, 138, 58, 0.22)' : 'rgba(18, 52, 22, 0.18)';
    ctx.fillRect(i * bandWidth, 0, bandWidth, 512);
  }

  // Fine grass blade stippling (deterministic PRNG)
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 9000; i++) {
    const x = nextRand() * 512;
    const y = nextRand() * 512;
    const shade = nextRand();
    ctx.fillStyle =
      shade > 0.6
        ? 'rgba(84, 158, 72, 0.18)'
        : shade > 0.3
          ? 'rgba(42, 98, 44, 0.2)'
          : 'rgba(20, 56, 24, 0.18)';
    ctx.fillRect(x, y, 2, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.anisotropy = anisotropy;
  return tex;
}

function createOutfieldRoughnessTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d4d4d4';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#c2c2c2' : '#dedede';
    ctx.fillRect(i * 32, 0, 32, 256);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.anisotropy = anisotropy;
  return tex;
}

function createPitchClayTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Base rolled clay soil color
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#9c7c58');
  grad.addColorStop(0.18, '#b5946d');
  grad.addColorStop(0.5, '#bfa07a');
  grad.addColorStop(0.82, '#b5946d');
  grad.addColorStop(1, '#9c7c58');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);

  // Subtle central dry strip and good-length / crease wear patches
  let seed = 4201;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Bowler & batter footmark wear zones near both ends (top and bottom of texture)
  const wearZones = [
    { x: 256, y: 110, rx: 95, ry: 75, alpha: 0.22 },
    { x: 256, y: 914, rx: 95, ry: 75, alpha: 0.22 },
    { x: 185, y: 165, rx: 48, ry: 85, alpha: 0.26 }, // Bowler follow-through rough
    { x: 325, y: 855, rx: 48, ry: 85, alpha: 0.26 }, // Opposite rough
    { x: 256, y: 680, rx: 75, ry: 130, alpha: 0.14 }, // Good-length bounce zone
  ];

  for (const z of wearZones) {
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.scale(1, z.ry / z.rx);
    const rg = ctx.createRadialGradient(0, 0, 4, 0, 0, z.rx);
    rg.addColorStop(0, `rgba(110, 84, 54, ${z.alpha})`);
    rg.addColorStop(0.6, `rgba(138, 108, 72, ${z.alpha * 0.5})`);
    rg.addColorStop(1, 'rgba(138, 108, 72, 0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, z.rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Fine soil grain and light grass straw flecks
  for (let i = 0; i < 14000; i++) {
    const x = nextRand() * 512;
    const y = nextRand() * 1024;
    const r = nextRand();
    ctx.fillStyle =
      r > 0.65
        ? 'rgba(218, 194, 156, 0.16)'
        : r > 0.3
          ? 'rgba(130, 100, 68, 0.16)'
          : 'rgba(92, 68, 44, 0.14)';
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function createPitchBumpTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 512);

  let seed = 9001;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 6000; i++) {
    const x = nextRand() * 256;
    const y = nextRand() * 512;
    const v = Math.floor(110 + nextRand() * 36);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function createWillowWoodTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#d8b480');
  grad.addColorStop(0.5, '#e6c998');
  grad.addColorStop(1, '#cfa870');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 512);

  // Straight willow grain lines
  ctx.strokeStyle = 'rgba(138, 96, 48, 0.22)';
  ctx.lineWidth = 1.5;
  for (let x = 8; x < 256; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + Math.sin(x) * 3, 512);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function createCricketBallTexture(variant: BallColorVariant, anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const palette = {
    red: { leather: '#b81422', highlight: '#dc2638', seamBg: '#8e0c18', stitch: '#f8fafc' },
    white: { leather: '#f1f5f9', highlight: '#ffffff', seamBg: '#cbd5e1', stitch: '#1e293b' },
    pink: { leather: '#ec4899', highlight: '#f472b6', seamBg: '#be185d', stitch: '#ffffff' },
  }[variant];

  ctx.fillStyle = palette.leather;
  ctx.fillRect(0, 0, 512, 256);

  // Subtle quarter leather sheen
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, palette.leather);
  g.addColorStop(0.45, palette.highlight);
  g.addColorStop(0.55, palette.highlight);
  g.addColorStop(1, palette.leather);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);

  // Equator primary seam band (around y = 128)
  ctx.fillStyle = palette.seamBg;
  ctx.fillRect(0, 114, 512, 28);

  // Double-row raised stitched seam
  ctx.fillStyle = palette.stitch;
  for (let x = 0; x < 512; x += 10) {
    ctx.save();
    ctx.translate(x + 4, 121);
    ctx.rotate(0.25);
    ctx.fillRect(-3, -2, 6, 3);
    ctx.restore();

    ctx.save();
    ctx.translate(x + 4, 135);
    ctx.rotate(-0.25);
    ctx.fillRect(-3, -2, 6, 3);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}
