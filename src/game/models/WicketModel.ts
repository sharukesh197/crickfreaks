import * as THREE from 'three';
import { WICKET_CONSTANTS, StumpSpec, BailSpec } from '../../shared/constants';
import { cricketToThree, CricketVec3 } from '../../shared/coordinates';

export interface WicketHandle {
  group: THREE.Group;
  endName: 'bowler' | 'striker';
  baseY: number;
  stumpMeshes: Record<'leg' | 'middle' | 'off', THREE.Group>;
  bailMeshes: Record<'leg_middle' | 'middle_off', THREE.Group>;
  /** Updates stump tilt angles and bail displacements in Cricket World space */
  resetWicket: () => void;
  setBailDislodged: (bailId: 'leg_middle' | 'middle_off', offsetCricket: CricketVec3, rotEuler: THREE.Euler) => void;
}

/**
 * Builds an accurate regulation cricket wicket (3 individual wooden stumps + 2 separate bails)
 * positioned at (X = 0, Y = baseY, Z = 0) in Cricket World Coordinates.
 *
 * Regulation Geometry:
 * - Stump height = 0.711m (28 in)
 * - Total wicket width = 0.2286m (9 in)
 * - Selected maximum stump diameter = 0.0381m (1.5 in)
 * - Two separate bails resting in the stump grooves at Z = 0.711m
 */
export function createRegulationWicket(
  endName: 'bowler' | 'striker',
  baseY: number,
  woodTexture: THREE.Texture,
  castShadow: boolean,
): WicketHandle {
  const rootGroup = new THREE.Group();
  rootGroup.name = `wicket_${endName}`;

  const rootThreePos = cricketToThree({ x: 0, y: baseY, z: 0.03 });
  rootGroup.position.set(rootThreePos.x, rootThreePos.y, rootThreePos.z);

  const stumpMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a3412,
    roughness: 0.32,
    metalness: 0.08,
    emissive: 0x431407,
    emissiveIntensity: 0.22,
  });

  const ferruleMaterial = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    roughness: 0.35,
    metalness: 0.15,
    emissive: 0xfacc15,
    emissiveIntensity: 0.18,
  });

  const bailMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.25,
    metalness: 0.05,
    emissive: 0xfef9c3,
    emissiveIntensity: 0.35,
  });

  // Subtle dark base shadow strip under the 3 stumps to anchor them onto the crease line
  const baseShadowGeo = new THREE.BoxGeometry(0.28, 0.004, 0.06);
  const baseShadowMat = new THREE.MeshBasicMaterial({
    color: 0x292524,
    transparent: true,
    opacity: 0.55,
  });
  const baseShadow = new THREE.Mesh(baseShadowGeo, baseShadowMat);
  baseShadow.position.set(0, 0.002, 0);
  rootGroup.add(baseShadow);

  const stumpMeshes = {} as Record<'leg' | 'middle' | 'off', THREE.Group>;
  const bailMeshes = {} as Record<'leg_middle' | 'middle_off', THREE.Group>;

  // Build each of the 3 stumps (leg, middle, off) pivoted at ground level (Z = 0)
  for (const spec of WICKET_CONSTANTS.STUMPS) {
    const stumpGroup = buildSingleStump(spec, stumpMaterial, ferruleMaterial, castShadow);
    const localThree = cricketToThree({ x: spec.centerX, y: 0, z: 0 });
    stumpGroup.position.set(localThree.x, localThree.y, localThree.z);
    rootGroup.add(stumpGroup);
    stumpMeshes[spec.id] = stumpGroup;
  }

  // Build each of the 2 bails modeled separately above Z = 0.711m
  for (const spec of WICKET_CONSTANTS.BAILS) {
    const bailGroup = buildSingleBail(spec, bailMaterial, castShadow);
    const localThree = cricketToThree({ x: spec.centerX, y: 0, z: spec.restingBaseZ });
    bailGroup.position.set(localThree.x, localThree.y, localThree.z);
    rootGroup.add(bailGroup);
    bailMeshes[spec.id] = bailGroup;
  }

  const resetWicket = () => {
    for (const spec of WICKET_CONSTANTS.STUMPS) {
      const sg = stumpMeshes[spec.id];
      const localThree = cricketToThree({ x: spec.centerX, y: 0, z: 0 });
      sg.position.set(localThree.x, localThree.y, localThree.z);
      sg.rotation.set(0, 0, 0);
    }
    for (const spec of WICKET_CONSTANTS.BAILS) {
      const bg = bailMeshes[spec.id];
      const localThree = cricketToThree({ x: spec.centerX, y: 0, z: spec.restingBaseZ });
      bg.position.set(localThree.x, localThree.y, localThree.z);
      bg.rotation.set(0, 0, 0);
    }
  };

  const setBailDislodged = (
    bailId: 'leg_middle' | 'middle_off',
    offsetCricket: CricketVec3,
    rotEuler: THREE.Euler,
  ) => {
    const spec = WICKET_CONSTANTS.BAILS.find((b) => b.id === bailId)!;
    const bg = bailMeshes[bailId];
    const localThree = cricketToThree({
      x: spec.centerX + offsetCricket.x,
      y: offsetCricket.y,
      z: spec.restingBaseZ + offsetCricket.z,
    });
    bg.position.set(localThree.x, localThree.y, localThree.z);
    bg.rotation.copy(rotEuler);
  };

  return {
    group: rootGroup,
    endName,
    baseY,
    stumpMeshes,
    bailMeshes,
    resetWicket,
    setBailDislodged,
  };
}

function buildSingleStump(
  spec: StumpSpec,
  woodMat: THREE.Material,
  bandMat: THREE.Material,
  castShadow: boolean,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `stump_${spec.id}`;

  const shaftHeight = spec.heightZ - 0.018; // Top 1.8cm is the carved bail groove neck + dome
  const shaftGeo = new THREE.CylinderGeometry(spec.radius, spec.radius, shaftHeight, 16);
  const shaftMesh = new THREE.Mesh(shaftGeo, woodMat);
  shaftMesh.position.y = shaftHeight / 2;
  shaftMesh.castShadow = castShadow;
  shaftMesh.receiveShadow = true;
  group.add(shaftMesh);

  // Subtle dark championship band near upper third for broadcast camera readability
  const ringGeo = new THREE.CylinderGeometry(spec.radius * 1.015, spec.radius * 1.015, 0.022, 16);
  const ringMesh = new THREE.Mesh(ringGeo, bandMat);
  ringMesh.position.y = spec.heightZ * 0.78;
  group.add(ringMesh);

  // Top bail groove neck
  const neckGeo = new THREE.CylinderGeometry(spec.radius * 0.72, spec.radius * 0.85, 0.012, 14);
  const neckMesh = new THREE.Mesh(neckGeo, woodMat);
  neckMesh.position.y = shaftHeight + 0.006;
  group.add(neckMesh);

  // Domed top cap reaching exactly Z = 0.711m
  const capGeo = new THREE.CylinderGeometry(spec.radius * 0.82, spec.radius * 0.92, 0.006, 14);
  const capMesh = new THREE.Mesh(capGeo, woodMat);
  capMesh.position.y = spec.heightZ - 0.003;
  group.add(capMesh);

  return group;
}

function buildSingleBail(spec: BailSpec, bailMat: THREE.Material, castShadow: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = `bail_${spec.id}`;

  // In Three.js, X is across the wicket. CylinderGeometry is aligned along Y by default, so rotateZ(pi/2).
  // 1. Central barrel (0.054m)
  const barrelGeo = new THREE.CylinderGeometry(spec.barrelRadius, spec.barrelRadius, spec.barrelLength, 12);
  barrelGeo.rotateZ(Math.PI / 2);
  const barrelMesh = new THREE.Mesh(barrelGeo, bailMat);
  barrelMesh.position.y = spec.spigotRadius;
  barrelMesh.castShadow = castShadow;
  group.add(barrelMesh);

  // 2. Left spigot (long spigot 0.0349m)
  const longSpigotGeo = new THREE.CylinderGeometry(
    spec.spigotRadius,
    spec.spigotRadius,
    spec.longSpigotLength,
    10,
  );
  longSpigotGeo.rotateZ(Math.PI / 2);
  const leftSpigot = new THREE.Mesh(longSpigotGeo, bailMat);
  leftSpigot.position.set(-(spec.barrelLength / 2 + spec.longSpigotLength / 2), spec.spigotRadius, 0);
  group.add(leftSpigot);

  // 3. Right spigot (short spigot 0.0206m)
  const shortSpigotGeo = new THREE.CylinderGeometry(
    spec.spigotRadius,
    spec.spigotRadius,
    spec.shortSpigotLength,
    10,
  );
  shortSpigotGeo.rotateZ(Math.PI / 2);
  const rightSpigot = new THREE.Mesh(shortSpigotGeo, bailMat);
  rightSpigot.position.set(spec.barrelLength / 2 + spec.shortSpigotLength / 2, spec.spigotRadius, 0);
  group.add(rightSpigot);

  return group;
}
