import * as THREE from 'three';
import {
  CricketVec3,
  cricketToThree,
  cricketYawToThreeRotationY,
  getCricketYawBetweenPoints,
} from '../../shared/coordinates';
import { BALL_CONSTANTS, BallColorVariant, CORE_ACTOR_POSITIONS } from '../../shared/constants';
import {
  BatterHandedness,
  FootworkType,
  ResolvedShotSpec,
} from '../../shared/batCollision';
import {
  animateBowlerDeliverySequence,
  animateFielderPosture,
  animateNonStrikerSequence,
  animateStrikerShotSequence,
  animateUmpireSequence,
  animateWicketkeeperSequence,
  applyCanonicalStrikerReadyStance,
  ArticulatedPlayerRig,
  computeActorFacingTargetOrientation,
  computeNonStrikerCanonicalOrientation,
  computeStrikerCanonicalOrientation,
  plantRigFeetOnTurf,
} from '../animation/playerAnimator';

export type { ArticulatedPlayerRig };
export {
  animateBowlerDeliverySequence,
  animateFielderPosture,
  animateNonStrikerSequence,
  animateStrikerShotSequence,
  animateUmpireSequence,
  animateWicketkeeperSequence,
  applyCanonicalStrikerReadyStance,
  computeActorFacingTargetOrientation,
  computeNonStrikerCanonicalOrientation,
  computeStrikerCanonicalOrientation,
  plantRigFeetOnTurf,
};

export interface CricketBallVisualHandle {
  root: THREE.Group;
  sphereMesh: THREE.Mesh;
  shadowDisc: THREE.Mesh;
  corridorRing: THREE.Mesh;
  setCricketPosition: (pos: CricketVec3, seamRotationRad?: number) => void;
  setVariant: (variant: BallColorVariant) => void;
}

export interface KitPalette {
  primaryJersey: number;
  secondaryTrim: number;
  trousers: number;
  padsAndHelmet: number;
  skinTone: number;
}

export const BATTING_TEAM_PALETTE: KitPalette = {
  primaryJersey: 0x059669, // Vibrant Championship Emerald
  secondaryTrim: 0xfbbf24, // Championship Gold Trim
  trousers: 0xf8fafc, // Crisp Cricket Cream/White Flannels for high contrast against pitch & grass
  padsAndHelmet: 0x065f46,
  skinTone: 0xc68642,
};

export const BOWLING_TEAM_PALETTE: KitPalette = {
  primaryJersey: 0x1d4ed8, // Royal Broadcast Blue
  secondaryTrim: 0x38bdf8, // Sky Cyan Trim
  trousers: 0x0f172a, // Deep Navy Athletic Trousers
  padsAndHelmet: 0x1e3a8a,
  skinTone: 0xd2996c,
};

function createContactShadowDisc(radius = 0.52): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.012;
  return mesh;
}

/**
 * Creates a detailed willow cricket bat with two-handed cane handle, rubber grip rings,
 * sculpted back spine swell, splice, and toe guard.
 */
export function createCricketBatGroup(woodTexture: THREE.Texture, castShadow: boolean): THREE.Group {
  const batGroup = new THREE.Group();
  batGroup.name = 'cricket_bat';

  const gripMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.68,
    metalness: 0.05,
  });
  const gripBandMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    roughness: 0.42,
    metalness: 0.14,
  });
  const willowMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: woodTexture,
    roughness: 0.32,
    metalness: 0.06,
  });

  // 1. Cane Handle (length 0.30m) centered so top & bottom hands grip naturally around y in [-0.26, -0.02]
  const handleGeo = new THREE.CylinderGeometry(0.0185, 0.0165, 0.3, 14);
  const handleMesh = new THREE.Mesh(handleGeo, gripMat);
  handleMesh.position.y = -0.14;
  handleMesh.castShadow = castShadow;
  batGroup.add(handleMesh);

  // Rubber grip chevrons
  for (const yOff of [-0.05, -0.14, -0.23]) {
    const bandGeo = new THREE.CylinderGeometry(0.0195, 0.0195, 0.024, 14);
    const bandMesh = new THREE.Mesh(bandGeo, gripBandMat);
    bandMesh.position.y = yOff;
    batGroup.add(bandMesh);
  }

  // 2. Willow Blade (length 0.56m, width 0.114m, thickness 0.042m)
  const bladeGeo = new THREE.BoxGeometry(0.114, 0.56, 0.042);
  const bladeMesh = new THREE.Mesh(bladeGeo, willowMat);
  bladeMesh.position.y = -0.56;
  bladeMesh.castShadow = castShadow;
  bladeMesh.receiveShadow = true;
  batGroup.add(bladeMesh);

  // 3. Sculpted back spine swell
  const spineGeo = new THREE.ConeGeometry(0.034, 0.54, 4);
  spineGeo.scale(1.25, 1, 0.92);
  const spineMesh = new THREE.Mesh(spineGeo, willowMat);
  spineMesh.position.set(0, -0.56, -0.024);
  batGroup.add(spineMesh);

  // 4. Brand sticker band & toe guard
  const stickerGeo = new THREE.BoxGeometry(0.116, 0.095, 0.044);
  const stickerMesh = new THREE.Mesh(stickerGeo, gripBandMat);
  stickerMesh.position.y = -0.41;
  batGroup.add(stickerMesh);

  const toeGeo = new THREE.BoxGeometry(0.112, 0.026, 0.042);
  const toeMesh = new THREE.Mesh(toeGeo, gripBandMat);
  toeMesh.position.y = -0.845;
  batGroup.add(toeMesh);

  return batGroup;
}

/**
 * Creates a sculpted, anatomically proportioned Batter character with authentic side-on batting stance,
 * two-handed bat grip, grilled helmet, articulated batting gloves, and 3-roll leg pads.
 */
export function createBatterModel(
  roleId: 'striker' | 'non_striker',
  palette: KitPalette,
  woodTexture: THREE.Texture,
  castShadow: boolean,
): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig(`batter_${roleId}`, palette, 'batting_gloves', castShadow);

  // Sculpted Helmet with peak, ear guards, and titanium face grille along -Z_rig forward
  const helmetMat = new THREE.MeshStandardMaterial({
    color: palette.padsAndHelmet,
    roughness: 0.26,
    metalness: 0.25,
  });
  const grilleMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.18,
    metalness: 0.88,
  });

  const domeGeo = new THREE.SphereGeometry(0.144, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.72);
  const domeMesh = new THREE.Mesh(domeGeo, helmetMat);
  domeMesh.position.y = 0.02;
  rig.headGroup.add(domeMesh);

  // Rear neck protector shell on +Z_rig (back of helmet)
  const neckGuardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.06), helmetMat);
  neckGuardMesh.position.set(0, -0.025, 0.095);
  rig.headGroup.add(neckGuardMesh);

  const peakGeo = new THREE.CylinderGeometry(
    0.142,
    0.158,
    0.016,
    16,
    1,
    false,
    Math.PI * 0.65,
    Math.PI * 0.7,
  );
  const peakMesh = new THREE.Mesh(peakGeo, helmetMat);
  peakMesh.position.set(0, 0.028, -0.042);
  peakMesh.rotation.x = 0.22;
  rig.headGroup.add(peakMesh);

  // Titanium face grille rotated by -Math.PI / 2 so the arc sits strictly on the -Z_rig FRONT of the face
  for (const barY of [-0.024, -0.056]) {
    const grilleGeo = new THREE.TorusGeometry(0.126, 0.0065, 6, 16, Math.PI);
    grilleGeo.rotateX(-Math.PI / 2);
    const grilleMesh = new THREE.Mesh(grilleGeo, grilleMat);
    grilleMesh.position.set(0, barY, -0.022);
    rig.headGroup.add(grilleMesh);
  }

  // Sculpted 3-section Leg Pads attached to shin & thigh so they articulate cleanly with knee flexion
  const padMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.38,
    metalness: 0.06,
  });
  const padAccentMat = new THREE.MeshStandardMaterial({
    color: palette.primaryJersey,
    roughness: 0.45,
  });

  for (const [thighGroup, shinGroup] of [
    [rig.leftLeg, rig.leftShin],
    [rig.rightLeg, rig.rightShin],
  ] as const) {
    // Lower shin guard covering the front (-Z_rig) of the shin
    const shinGeo = new THREE.CylinderGeometry(
      0.076,
      0.066,
      0.39,
      12,
      1,
      false,
      -Math.PI * 0.4,
      Math.PI * 0.8,
    );
    shinGeo.rotateY(Math.PI);
    const shinPad = new THREE.Mesh(shinGeo, padMat);
    shinPad.position.set(0, -0.19, -0.018);
    shinPad.castShadow = castShadow;
    shinGroup.add(shinPad);

    // Sculpted knee roll bolster on front (-Z_rig) of knee
    const kneeGeo = new THREE.BoxGeometry(0.132, 0.075, 0.048);
    const kneeRoll = new THREE.Mesh(kneeGeo, padMat);
    kneeRoll.position.set(0, 0.01, -0.062);
    shinGroup.add(kneeRoll);

    // Top hat flap attached to lower front thigh
    const topFlapGeo = new THREE.BoxGeometry(0.13, 0.135, 0.042);
    const topFlap = new THREE.Mesh(topFlapGeo, padMat);
    topFlap.position.set(0, -0.32, -0.056);
    topFlap.rotation.x = -0.12;
    thighGroup.add(topFlap);

    // Trim stripe on front of shin pad
    const trimGeo = new THREE.BoxGeometry(0.134, 0.028, 0.048);
    const trim = new THREE.Mesh(trimGeo, padAccentMat);
    trim.position.set(0, -0.06, -0.062);
    shinGroup.add(trim);
  }

  // Attach Cricket Bat to rightForearm wrist pivot so both hands converge onto the handle
  const batPivot = new THREE.Group();
  batPivot.position.set(-0.03, -0.27, -0.03);
  const bat = createCricketBatGroup(woodTexture, castShadow);
  batPivot.add(bat);
  rig.rightForearm.add(batPivot);
  rig.batPivot = batPivot;

  if (roleId === 'striker') {
    applyCanonicalStrikerReadyStance(rig, 0, 'RHB');
  } else {
    animateNonStrikerSequence(rig, 'SETUP', 0);
  }

  return rig;
}

/**
 * Backward-compatible wrapper delegating to `applyCanonicalStrikerReadyStance`.
 */
export function applyStrikerReadyStance(
  rig: ArticulatedPlayerRig,
  breathPhase = 0,
  handedness: BatterHandedness = 'RHB',
): void {
  applyCanonicalStrikerReadyStance(rig, breathPhase, handedness);
}

/**
 * Backward-compatible wrapper delegating to `animateStrikerShotSequence`.
 */
export function applyStrikerShotAnimation(
  rig: ArticulatedPlayerRig,
  baseStancePos: CricketVec3,
  footwork: FootworkType,
  shotSpec: ResolvedShotSpec,
  handedness: BatterHandedness,
  swingProgress: number,
  isSwinging: boolean,
  preReleaseCoilProgress = 0,
): void {
  animateStrikerShotSequence(
    rig,
    baseStancePos,
    footwork,
    shotSpec,
    handedness,
    swingProgress,
    isSwinging,
    preReleaseCoilProgress,
  );
}

/**
 * Backward-compatible wrapper delegating to `animateBowlerDeliverySequence`.
 */
export function applyBowlerDeliveryAnimation(
  rig: ArticulatedPlayerRig,
  phase: 'idle' | 'runup' | 'follow_through',
  progress: number,
  releaseX = -0.36,
  breathPhase = 0,
): void {
  animateBowlerDeliverySequence(rig, phase, progress, releaseX, breathPhase);
}

export function createBowlerModel(palette: KitPalette, castShadow: boolean): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig('bowler', palette, 'bare_hands', castShadow);

  const hairMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72 });
  const hairGeo = new THREE.SphereGeometry(0.125, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.68);
  const hairMesh = new THREE.Mesh(hairGeo, hairMat);
  hairMesh.position.y = 0.022;
  rig.headGroup.add(hairMesh);

  // Rear hair nape coverage on +Z_rig so the back of the head never looks like a bare face
  const napeHair = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.11, 0.085), hairMat);
  napeHair.position.set(0, -0.025, 0.075);
  rig.headGroup.add(napeHair);

  // Athletic headband
  const bandMat = new THREE.MeshStandardMaterial({ color: palette.secondaryTrim, roughness: 0.4 });
  const headband = new THREE.Mesh(new THREE.CylinderGeometry(0.121, 0.121, 0.022, 16), bandMat);
  headband.position.y = 0.035;
  rig.headGroup.add(headband);

  animateBowlerDeliverySequence(rig, 'idle', 0);
  return rig;
}

export function createWicketkeeperModel(palette: KitPalette, castShadow: boolean): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig('wicketkeeper', palette, 'keeping_gloves', castShadow);

  const helmetMat = new THREE.MeshStandardMaterial({ color: palette.padsAndHelmet, roughness: 0.32 });
  const capMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.136, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.68),
    helmetMat,
  );
  capMesh.position.y = 0.022;
  rig.headGroup.add(capMesh);

  const grilleMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.2,
    metalness: 0.85,
  });
  const grilleGeo = new THREE.TorusGeometry(0.122, 0.006, 6, 16, Math.PI);
  grilleGeo.rotateX(-Math.PI / 2);
  const grilleMesh = new THREE.Mesh(grilleGeo, grilleMat);
  grilleMesh.position.set(0, -0.032, -0.02);
  rig.headGroup.add(grilleMesh);

  // Compact wicketkeeping shin pads attached to leftShin & rightShin
  const padMat = new THREE.MeshStandardMaterial({ color: palette.padsAndHelmet, roughness: 0.42 });
  const padTrimMat = new THREE.MeshStandardMaterial({ color: palette.secondaryTrim, roughness: 0.38 });
  for (const shinGroup of [rig.leftShin, rig.rightShin]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.142, 0.38, 0.075), padMat);
    pad.position.set(0, -0.18, -0.048);
    pad.castShadow = castShadow;
    shinGroup.add(pad);

    const topRoll = new THREE.Mesh(new THREE.BoxGeometry(0.146, 0.045, 0.08), padTrimMat);
    topRoll.position.set(0, 0.0, -0.05);
    shinGroup.add(topRoll);
  }

  animateWicketkeeperSequence(rig, 'SETUP');
  return rig;
}

export function createUmpireModel(castShadow: boolean): ArticulatedPlayerRig {
  const umpirePalette: KitPalette = {
    primaryJersey: 0xdc2626, // Elite ICC Match Official Crimson Polo
    secondaryTrim: 0x1e293b,
    trousers: 0x0f172a,
    padsAndHelmet: 0xf8fafc,
    skinTone: 0xc68642,
  };
  const rig = createBaseHumanoidRig('umpire', umpirePalette, 'bare_hands', castShadow);

  const hairMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const napeHair = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), hairMat);
  napeHair.position.set(0, -0.02, 0.072);
  rig.headGroup.add(napeHair);

  const hatMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.58 });
  const hatBandMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45 });
  const brimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.015, 22), hatMat);
  brimMesh.position.y = 0.075;
  rig.headGroup.add(brimMesh);

  const crownMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.095, 16), hatMat);
  crownMesh.position.y = 0.115;
  rig.headGroup.add(crownMesh);

  const bandMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.126, 0.126, 0.022, 16), hatBandMat);
  bandMesh.position.y = 0.085;
  rig.headGroup.add(bandMesh);

  animateUmpireSequence(rig, 'SETUP', 'none', 0);
  return rig;
}

export function createFielderModel(
  fielderId: string,
  palette: KitPalette,
  castShadow: boolean,
): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig(`fielder_${fielderId}`, palette, 'bare_hands', castShadow);

  const hairMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72 });
  const napeHair = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.08), hairMat);
  napeHair.position.set(0, -0.025, 0.072);
  rig.headGroup.add(napeHair);

  const capMat = new THREE.MeshStandardMaterial({ color: palette.primaryJersey, roughness: 0.48 });
  const capDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    capMat,
  );
  capDome.position.y = 0.022;
  rig.headGroup.add(capDome);

  // Cap visor pointing along canonical -Z_rig forward
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.014, 0.1), capMat);
  brim.position.set(0, 0.028, -0.115);
  brim.rotation.x = 0.12;
  rig.headGroup.add(brim);

  return rig;
}

/**
 * Shared sculpted humanoid rig with 2-segment articulated arms (shoulder + elbow + wrist)
 * and 2-segment articulated legs (hip + knee + ankle), directional facial visor/eyes on `-Z_rig`,
 * and athletic cricket kit detailing.
 */
function createBaseHumanoidRig(
  name: string,
  palette: KitPalette,
  handStyle: 'bare_hands' | 'batting_gloves' | 'keeping_gloves',
  castShadow: boolean,
): ArticulatedPlayerRig {
  const root = new THREE.Group();
  root.name = name;
  // Subtle 1.08x broadcast silhouette scale for clear readability at both ends of the 20.12m pitch
  root.scale.setScalar(1.08);

  root.add(createContactShadowDisc(0.48));

  const jerseyMat = new THREE.MeshStandardMaterial({
    color: palette.primaryJersey,
    roughness: 0.5,
    metalness: 0.06,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: palette.secondaryTrim,
    roughness: 0.36,
    metalness: 0.16,
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    color: palette.trousers,
    roughness: 0.6,
    metalness: 0.04,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: palette.skinTone,
    roughness: 0.55,
    metalness: 0.04,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.38,
    metalness: 0.12,
  });
  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.32,
    metalness: 0.1,
  });
  const darkVisorMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.22,
    metalness: 0.65,
  });

  // Hips / Pelvis
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const pelvisGeo = new THREE.CylinderGeometry(0.168, 0.156, 0.18, 16);
  pelvisGeo.scale(1.06, 1, 0.72);
  const pelvisMesh = new THREE.Mesh(pelvisGeo, trouserMat);
  pelvisMesh.castShadow = castShadow;
  hips.add(pelvisMesh);

  // Athletic Belt
  const beltGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.036, 16);
  beltGeo.scale(1.07, 1, 0.73);
  const beltMesh = new THREE.Mesh(beltGeo, darkVisorMat);
  beltMesh.position.y = 0.075;
  hips.add(beltMesh);

  // Sculpted Athletic Torso (V-taper chest + chest stripe + collar)
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  hips.add(torso);

  const chestGeo = new THREE.CylinderGeometry(0.21, 0.164, 0.5, 18);
  chestGeo.scale(1.08, 1, 0.68);
  const chestMesh = new THREE.Mesh(chestGeo, jerseyMat);
  chestMesh.position.y = 0.25;
  chestMesh.castShadow = castShadow;
  chestMesh.receiveShadow = true;
  torso.add(chestMesh);

  // Championship chest band & front V-emblem on -Z_rig (clearly marks front of chest!)
  const stripeGeo = new THREE.CylinderGeometry(0.206, 0.198, 0.075, 18);
  stripeGeo.scale(1.09, 1, 0.7);
  const stripeMesh = new THREE.Mesh(stripeGeo, trimMat);
  stripeMesh.position.y = 0.34;
  torso.add(stripeMesh);

  const chestBadge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.02), trimMat);
  chestBadge.position.set(0, 0.34, -0.142);
  torso.add(chestBadge);

  const collarGeo = new THREE.TorusGeometry(0.086, 0.018, 8, 16);
  collarGeo.rotateX(Math.PI / 2);
  const collarMesh = new THREE.Mesh(collarGeo, trimMat);
  collarMesh.position.y = 0.5;
  torso.add(collarMesh);

  // Head, Neck & Directional Facial Visor on -Z_rig
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.63;
  torso.add(headGroup);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.1, 12), skinMat);
  neckMesh.position.y = -0.08;
  headGroup.add(neckMesh);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 16), skinMat);
  headMesh.scale.set(0.95, 1.06, 0.98);
  headMesh.castShadow = castShadow;
  headGroup.add(headMesh);

  // Sport sunglasses / eye visor strip on the -Z_rig face so head direction is unmistakable
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.032, 0.03), darkVisorMat);
  visorMesh.position.set(0, 0.012, -0.105);
  headGroup.add(visorMesh);

  // 2-Segment Articulated Arms: Shoulder -> Upper Arm -> Elbow -> Forearm -> Hand/Glove
  const buildArm = (side: -1 | 1): { upperArm: THREE.Group; forearm: THREE.Group } => {
    const upperArm = new THREE.Group();
    upperArm.position.set(side * 0.248, 0.45, 0);

    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), jerseyMat);
    upperArm.add(shoulderCap);

    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.056, 0.24, 12), jerseyMat);
    sleeve.position.y = -0.12;
    sleeve.castShadow = castShadow;
    upperArm.add(sleeve);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.059, 0.058, 0.024, 12), trimMat);
    cuff.position.y = -0.23;
    upperArm.add(cuff);

    const elbowSphere = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 10), skinMat);
    elbowSphere.position.y = -0.245;
    upperArm.add(elbowSphere);

    const forearm = new THREE.Group();
    forearm.position.set(0, -0.245, 0);
    upperArm.add(forearm);

    const forearmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.25, 12), skinMat);
    forearmMesh.position.y = -0.125;
    forearmMesh.castShadow = castShadow;
    forearm.add(forearmMesh);

    const wristband = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.045, 0.035, 12), gloveMat);
    wristband.position.y = -0.235;
    forearm.add(wristband);

    if (handStyle === 'keeping_gloves') {
      // Large webbed wicketkeeping gloves with gauntlet cuffs and bright palm grip
      const keepingGlove = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.165, 0.095), gloveMat);
      keepingGlove.position.set(0, -0.295, -0.015);
      forearm.add(keepingGlove);

      const webbing = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.13, 0.025), trimMat);
      webbing.position.set(0, -0.3, -0.055);
      forearm.add(webbing);
    } else if (handStyle === 'batting_gloves') {
      // Padded batting gloves with finger rolls
      const batGlove = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.13, 0.082), gloveMat);
      batGlove.position.set(0, -0.285, -0.01);
      forearm.add(batGlove);

      const cuffTrim = new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.032, 0.086), trimMat);
      cuffTrim.position.set(0, -0.235, -0.01);
      forearm.add(cuffTrim);
    } else {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 12), skinMat);
      hand.position.set(0, -0.275, 0);
      forearm.add(hand);
    }

    return { upperArm, forearm };
  };

  const leftArmBuilt = buildArm(-1);
  const rightArmBuilt = buildArm(1);
  torso.add(leftArmBuilt.upperArm);
  torso.add(rightArmBuilt.upperArm);

  // 2-Segment Articulated Legs: Hip -> Thigh -> Knee -> Shin -> Ankle/Boot
  const buildLeg = (
    side: -1 | 1,
  ): { thighGroup: THREE.Group; shinGroup: THREE.Group; ankleGroup: THREE.Group } => {
    const thighGroup = new THREE.Group();
    thighGroup.position.set(side * 0.115, -0.04, 0);

    const thighMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.072, 0.42, 14),
      trouserMat,
    );
    thighMesh.position.y = -0.21;
    thighMesh.castShadow = castShadow;
    thighGroup.add(thighMesh);

    const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(0.071, 12, 10), trouserMat);
    kneeJoint.position.y = -0.42;
    thighGroup.add(kneeJoint);

    const shinGroup = new THREE.Group();
    shinGroup.position.set(0, -0.42, 0);
    thighGroup.add(shinGroup);

    const calfMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.052, 0.42, 14),
      trouserMat,
    );
    calfMesh.position.y = -0.21;
    calfMesh.castShadow = castShadow;
    shinGroup.add(calfMesh);

    const ankleGroup = new THREE.Group();
    ankleGroup.position.set(0, -0.42, 0);
    shinGroup.add(ankleGroup);

    // Boot oriented with toe along -Z_rig (canonical forward)
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.08, 0.255), shoeMat);
    boot.position.set(0, -0.04, -0.048);
    boot.castShadow = castShadow;
    ankleGroup.add(boot);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.118, 0.022, 0.26), trimMat);
    sole.position.set(0, -0.072, -0.048);
    ankleGroup.add(sole);

    return { thighGroup, shinGroup, ankleGroup };
  };

  const leftLegBuilt = buildLeg(-1);
  const rightLegBuilt = buildLeg(1);
  hips.add(leftLegBuilt.thighGroup);
  hips.add(rightLegBuilt.thighGroup);

  const currentCricketPos: CricketVec3 = { x: 0, y: 0, z: 0 };
  let currentCricketYaw = 0;

  const rig: ArticulatedPlayerRig = {
    root,
    hips,
    torso,
    headGroup,
    leftArm: leftArmBuilt.upperArm,
    rightArm: rightArmBuilt.upperArm,
    leftForearm: leftArmBuilt.forearm,
    rightForearm: rightArmBuilt.forearm,
    leftLeg: leftLegBuilt.thighGroup,
    rightLeg: rightLegBuilt.thighGroup,
    leftShin: leftLegBuilt.shinGroup,
    rightShin: rightLegBuilt.shinGroup,
    leftAnkle: leftLegBuilt.ankleGroup,
    rightAnkle: rightLegBuilt.ankleGroup,
    currentCricketPos,
    currentCricketYaw,
    setCricketTransform: (pos: CricketVec3, yawRadians: number) => {
      rig.currentCricketPos = { ...pos };
      rig.currentCricketYaw = yawRadians;
      const threePos = cricketToThree(pos);
      root.position.set(threePos.x, threePos.y, threePos.z);
      root.rotation.y = cricketYawToThreeRotationY(yawRadians);
    },
  };

  return rig;
}

/**
 * Creates the high-visibility 3D Leather Cricket Ball with raised stitched seam,
 * glowing outer visibility ring, and ground shadow projection disc.
 */
export function createCricketBallModel(
  ballTextures: Record<BallColorVariant, THREE.CanvasTexture>,
  initialVariant: BallColorVariant = 'red',
): CricketBallVisualHandle {
  const root = new THREE.Group();
  root.name = 'cricket_ball_assembly';

  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: ballTextures[initialVariant],
    roughness: 0.24,
    metalness: 0.1,
    emissive: 0x450a0a,
    emissiveIntensity: 0.22,
  });

  const visualBaseRadius = BALL_CONSTANTS.RADIUS_METERS * 1.48;
  const sphereGeo = new THREE.SphereGeometry(visualBaseRadius, 24, 20);
  const sphereMesh = new THREE.Mesh(sphereGeo, ballMat);
  sphereMesh.castShadow = true;
  root.add(sphereMesh);

  const ringGeo = new THREE.RingGeometry(visualBaseRadius * 1.12, visualBaseRadius * 1.42, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const corridorRing = new THREE.Mesh(ringGeo, ringMat);
  root.add(corridorRing);

  const shadowGeo = new THREE.CircleGeometry(visualBaseRadius * 1.85, 20);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  root.add(shadowDisc);

  const setCricketPosition = (pos: CricketVec3, seamRotationRad = 0) => {
    const threeBallPos = cricketToThree(pos);
    sphereMesh.position.set(threeBallPos.x, threeBallPos.y, threeBallPos.z);

    const depthFactor = Math.max(0, Math.min(1, (pos.y + 4) / 26));
    const visualScale = 1 + depthFactor * 0.42;
    sphereMesh.scale.setScalar(visualScale);
    sphereMesh.rotation.x = seamRotationRad;
    sphereMesh.rotation.z = 0.18;

    corridorRing.position.copy(sphereMesh.position);
    corridorRing.scale.setScalar(visualScale);

    const threeShadowPos = cricketToThree({ x: pos.x, y: pos.y, z: 0.015 });
    shadowDisc.position.set(threeShadowPos.x, threeShadowPos.y, threeShadowPos.z);
    const heightAttenuation = Math.max(0.28, 1 - pos.z * 0.2);
    shadowMat.opacity = 0.65 * heightAttenuation;
    shadowDisc.scale.setScalar(visualScale * (1 + pos.z * 0.15));
  };

  const setVariant = (variant: BallColorVariant) => {
    ballMat.map = ballTextures[variant];
    ballMat.emissive.setHex(
      variant === 'white' ? 0x1e293b : variant === 'pink' ? 0x500724 : 0x450a0a,
    );
    ballMat.needsUpdate = true;
    ringMat.color.setHex(variant === 'white' ? 0x38bdf8 : 0xfef08a);
  };

  return {
    root,
    sphereMesh,
    shadowDisc,
    corridorRing,
    setCricketPosition,
    setVariant,
  };
}

export function getYawTowardStrikerCrease(pos: CricketVec3): number {
  return getCricketYawBetweenPoints(pos, CORE_ACTOR_POSITIONS.STRIKER_STANCE);
}
