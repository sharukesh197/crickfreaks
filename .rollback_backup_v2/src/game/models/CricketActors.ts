import * as THREE from 'three';
import {
  CricketVec3,
  cricketToThree,
  cricketYawToThreeRotationY,
  getCricketYawBetweenPoints,
} from '../../shared/coordinates';
import { BALL_CONSTANTS, BallColorVariant } from '../../shared/constants';
import {
  BatterHandedness,
  FootworkType,
  ResolvedShotSpec,
} from '../../shared/batCollision';

export interface ArticulatedPlayerRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  batPivot?: THREE.Group;
  setCricketTransform: (pos: CricketVec3, yawRadians: number) => void;
}

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
  secondaryTrim: 0xfbbf24, // Gold Trim
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
    opacity: 0.42,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.012;
  return mesh;
}

/**
 * Creates a detailed willow cricket bat with sculpted spine, rubber grip rings, splice, and toe guard.
 */
export function createCricketBatGroup(woodTexture: THREE.Texture, castShadow: boolean): THREE.Group {
  const batGroup = new THREE.Group();
  batGroup.name = 'cricket_bat';

  const gripMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.72,
    metalness: 0.05,
  });
  const gripBandMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    roughness: 0.45,
    metalness: 0.12,
  });
  const willowMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: woodTexture,
    roughness: 0.34,
    metalness: 0.06,
  });

  // 1. Cane Handle (length 0.30m)
  const handleGeo = new THREE.CylinderGeometry(0.018, 0.016, 0.3, 14);
  const handleMesh = new THREE.Mesh(handleGeo, gripMat);
  handleMesh.position.y = -0.15;
  handleMesh.castShadow = castShadow;
  batGroup.add(handleMesh);

  // Rubber grip chevrons
  for (const yOff of [-0.08, -0.18, -0.25]) {
    const bandGeo = new THREE.CylinderGeometry(0.0188, 0.0188, 0.025, 14);
    const bandMesh = new THREE.Mesh(bandGeo, gripBandMat);
    bandMesh.position.y = yOff;
    batGroup.add(bandMesh);
  }

  // 2. Willow Blade (length 0.56m, width 0.114m, thickness 0.042m)
  const bladeGeo = new THREE.BoxGeometry(0.114, 0.56, 0.042);
  const bladeMesh = new THREE.Mesh(bladeGeo, willowMat);
  bladeMesh.position.y = -0.57;
  bladeMesh.castShadow = castShadow;
  bladeMesh.receiveShadow = true;
  batGroup.add(bladeMesh);

  // 3. Sculpted back spine swell
  const spineGeo = new THREE.ConeGeometry(0.032, 0.54, 4);
  spineGeo.scale(1.25, 1, 0.9);
  const spineMesh = new THREE.Mesh(spineGeo, willowMat);
  spineMesh.position.set(0, -0.57, -0.024);
  batGroup.add(spineMesh);

  // 4. Brand sticker band & toe guard
  const stickerGeo = new THREE.BoxGeometry(0.116, 0.09, 0.044);
  const stickerMesh = new THREE.Mesh(stickerGeo, gripBandMat);
  stickerMesh.position.y = -0.42;
  batGroup.add(stickerMesh);

  const toeGeo = new THREE.BoxGeometry(0.112, 0.024, 0.042);
  const toeMesh = new THREE.Mesh(toeGeo, gripBandMat);
  toeMesh.position.y = -0.855;
  batGroup.add(toeMesh);

  return batGroup;
}

/**
 * Creates a sculpted, anatomically proportioned Batter character with authentic side-on batting stance,
 * two-handed bat grip, grilled helmet, batting gloves, and 3-roll leg pads.
 */
export function createBatterModel(
  roleId: 'striker' | 'non_striker',
  palette: KitPalette,
  woodTexture: THREE.Texture,
  castShadow: boolean,
): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig(`batter_${roleId}`, palette, true, castShadow);

  // Sculpted Helmet with peak, ear guards, and titanium face grille
  const helmetMat = new THREE.MeshStandardMaterial({
    color: palette.padsAndHelmet,
    roughness: 0.28,
    metalness: 0.25,
  });
  const grilleMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.2,
    metalness: 0.88,
  });

  const domeGeo = new THREE.SphereGeometry(0.142, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.68);
  const domeMesh = new THREE.Mesh(domeGeo, helmetMat);
  domeMesh.position.y = 0.02;
  rig.headGroup.add(domeMesh);

  const peakGeo = new THREE.CylinderGeometry(0.14, 0.155, 0.016, 16, 1, false, -Math.PI * 0.35, Math.PI * 0.7);
  const peakMesh = new THREE.Mesh(peakGeo, helmetMat);
  peakMesh.position.set(0, 0.025, -0.04);
  peakMesh.rotation.x = 0.22;
  rig.headGroup.add(peakMesh);

  for (const barY of [-0.025, -0.055]) {
    const grilleGeo = new THREE.TorusGeometry(0.125, 0.0065, 6, 16, Math.PI);
    grilleGeo.rotateX(Math.PI / 2);
    const grilleMesh = new THREE.Mesh(grilleGeo, grilleMat);
    grilleMesh.position.set(0, barY, -0.02);
    rig.headGroup.add(grilleMesh);
  }

  // Sculpted 3-section Leg Pads with knee roll and top hat
  const padMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.42,
    metalness: 0.06,
  });
  const padAccentMat = new THREE.MeshStandardMaterial({
    color: palette.primaryJersey,
    roughness: 0.5,
  });

  for (const legGroup of [rig.leftLeg, rig.rightLeg]) {
    // Lower shin guard
    const shinGeo = new THREE.CylinderGeometry(0.078, 0.068, 0.42, 12, 1, false, -Math.PI * 0.55, Math.PI * 1.1);
    shinGeo.rotateY(Math.PI);
    const shinPad = new THREE.Mesh(shinGeo, padMat);
    shinPad.position.set(0, -0.58, -0.02);
    shinPad.castShadow = castShadow;
    legGroup.add(shinPad);

    // Sculpted knee roll bolster
    const kneeGeo = new THREE.CylinderGeometry(0.054, 0.054, 0.16, 12);
    kneeGeo.rotateZ(Math.PI / 2);
    const kneeRoll = new THREE.Mesh(kneeGeo, padMat);
    kneeRoll.position.set(0, -0.35, -0.065);
    legGroup.add(kneeRoll);

    // Top hat flap above knee
    const topFlapGeo = new THREE.BoxGeometry(0.145, 0.14, 0.045);
    const topFlap = new THREE.Mesh(topFlapGeo, padMat);
    topFlap.position.set(0, -0.24, -0.058);
    topFlap.rotation.x = -0.15;
    legGroup.add(topFlap);

    // Trim stripe
    const trimGeo = new THREE.BoxGeometry(0.148, 0.03, 0.05);
    const trim = new THREE.Mesh(trimGeo, padAccentMat);
    trim.position.set(0, -0.44, -0.062);
    legGroup.add(trim);
  }

  // Attach Cricket Bat to right-arm wrist pivot
  const batPivot = new THREE.Group();
  batPivot.position.set(0, -0.56, -0.04);
  const bat = createCricketBatGroup(woodTexture, castShadow);
  batPivot.add(bat);
  rig.rightArm.add(batPivot);
  rig.batPivot = batPivot;

  if (roleId === 'striker') {
    applyStrikerReadyStance(rig, 0, 'RHB');
  } else {
    // Non-striker backing up at bowler's crease
    rig.hips.position.y = 0.94;
    rig.torso.rotation.set(0.12, 0, 0);
    rig.rightArm.rotation.set(-0.28, 0, -0.1);
    batPivot.rotation.set(0.32, 0, 0);
  }

  return rig;
}

/**
 * Sets the Striker into an authentic side-on Right-Handed or Left-Handed Cricket Batting Stance:
 * - RHB: Body turned side-on (left shoulder pointing toward bowler -Y, chest facing +X off-side)
 * - LHB: Mirrored side-on stance (right shoulder pointing toward bowler -Y, chest facing -X off-side)
 * - Head & helmet turned over the front shoulder looking directly down the pitch at the bowler
 */
export function applyStrikerReadyStance(
  rig: ArticulatedPlayerRig,
  breathPhase = 0,
  handedness: BatterHandedness = 'RHB',
): void {
  const handSign = handedness === 'LHB' ? -1 : 1;
  const bob = Math.sin(breathPhase) * 0.015;
  rig.hips.position.set(0, 0.89 + bob, 0);
  // Rotate hips and torso side-on (-1.15 * handSign rad around Y)
  rig.hips.rotation.set(0, -1.15 * handSign, 0);
  rig.torso.rotation.set(0.24, -0.12 * handSign, 0.06 * handSign);
  // Counter-rotate head so batter looks squarely down the pitch at the bowler
  rig.headGroup.rotation.set(-0.14, 1.22 * handSign, 0);

  // Flexed athletic stance in legs
  rig.leftLeg.rotation.set(-0.22 * handSign, 0, 0.14);
  rig.rightLeg.rotation.set(0.18 * handSign, 0, -0.14);

  // Both hands brought together holding the bat handle in a ready backlift
  rig.leftArm.rotation.set(-0.68, 0.42, 0.35);
  rig.rightArm.rotation.set(-0.62, -0.35, -0.24);

  if (rig.batPivot) {
    rig.batPivot.rotation.set(
      0.85 + Math.sin(breathPhase) * 0.06,
      0.25 * handSign,
      0.18 * handSign,
    );
  }
}

/**
 * Animates the Striker through Footwork (Front Foot, Back Foot, Advance, Leave)
 * and distinct 3D Bat Swing animations for all 8 SwingPlaneFamily archetypes:
 * - defensive_push
 * - vertical_drive
 * - on_side_flick
 * - horizontal_cut
 * - horizontal_pull
 * - kneeling_sweep
 * - behind_wicket_ramp
 * - leave
 */
export function applyStrikerShotAnimation(
  rig: ArticulatedPlayerRig,
  baseStancePos: CricketVec3,
  footwork: FootworkType,
  shotSpec: ResolvedShotSpec,
  handedness: BatterHandedness,
  swingProgress: number,
  isSwinging: boolean,
): void {
  const handSign = handedness === 'LHB' ? -1 : 1;
  const stanceBaseX = -0.28 * handSign;
  const stepFactor = isSwinging ? Math.min(1, swingProgress * 2.8) : 0.38;

  // 1. Footwork displacement in Cricket (X, Y, Z)
  let footOffsetY = 0;
  let footOffsetX = 0;

  // Off-side vs Leg-side lateral stride bias
  const lateralBias = Math.max(-1, Math.min(1, shotSpec.relativeAngleDeg / 75)) * handSign;

  if (footwork === 'advance') {
    footOffsetY = -1.78 * stepFactor; // Charge down the track toward the pitch of the ball!
    footOffsetX = 0.18 * lateralBias * stepFactor;
  } else if (footwork === 'front_foot') {
    footOffsetY = -0.62 * stepFactor; // Stride forward toward bowler (-Y)
    footOffsetX = 0.15 * lateralBias * stepFactor;
  } else if (footwork === 'back_foot') {
    footOffsetY = 0.44 * stepFactor; // Step deeper into crease (+Y)
    footOffsetX = 0.14 * lateralBias * stepFactor;
  }

  rig.setCricketTransform(
    {
      x: stanceBaseX + footOffsetX,
      y: baseStancePos.y + footOffsetY,
      z: 0,
    },
    Math.PI,
  );

  // 2. Leave animation: withdraw bat high above shoulder
  if (footwork === 'leave' || shotSpec.swingFamily === 'leave') {
    rig.hips.position.set(0, 0.94, 0);
    rig.hips.rotation.set(0, -1.05 * handSign, 0);
    rig.torso.rotation.set(0.08, 0, -0.12 * handSign);
    rig.headGroup.rotation.set(-0.08, 1.05 * handSign, 0);
    rig.leftArm.rotation.set(-1.88, 0.2, 0.25);
    rig.rightArm.rotation.set(-1.98, -0.2, -0.25);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(-0.48, 0.2 * handSign, 0.3 * handSign);
    }
    return;
  }

  // Ready stance with subtle pre-delivery footwork coil before swing triggers
  if (!isSwinging && swingProgress <= 0.01) {
    applyStrikerReadyStance(rig, performance.now() * 0.0035, handedness);
    if (footwork === 'advance') {
      rig.hips.position.y = 0.85;
      rig.leftLeg.rotation.set(-0.48 * handSign, 0, 0.2);
      rig.rightLeg.rotation.set(0.42 * handSign, 0, -0.18);
    } else if (footwork === 'front_foot') {
      rig.leftLeg.rotation.set(-0.36 * handSign, 0, 0.18);
      rig.rightLeg.rotation.set(0.28 * handSign, 0, -0.15);
    } else if (footwork === 'back_foot') {
      rig.hips.position.y = 0.93;
      rig.leftLeg.rotation.set(0.14 * handSign, 0, 0.1);
      rig.rightLeg.rotation.set(-0.3 * handSign, 0, -0.12);
    }
    return;
  }

  // 3. Active Downswing & Follow-Through Animation (swingProgress in [0, 1])
  const u = Math.max(0, Math.min(1, swingProgress));
  const swingArc = Math.sin(u * Math.PI * 0.88);
  const isLoft = shotSpec.shotIntent === 'loft';
  const family = shotSpec.swingFamily;
  const dirYaw = -Math.max(-1.1, Math.min(1.1, (shotSpec.relativeAngleDeg / 75) * 0.65)) * handSign;

  if (family === 'defensive_push') {
    // Compact soft-hands block/push presenting vertical blade right in front of the pad
    rig.hips.position.set(0, footwork === 'back_foot' ? 0.92 : 0.84, 0);
    rig.leftLeg.rotation.set((footwork === 'back_foot' ? 0.12 : -0.52) * handSign, 0, 0.18);
    rig.rightLeg.rotation.set((footwork === 'back_foot' ? -0.28 : 0.38) * handSign, 0, -0.16);

    rig.hips.rotation.set(0, -1.12 * handSign + u * 0.32 * handSign + dirYaw * 0.35, 0);
    rig.torso.rotation.set(0.28, dirYaw * 0.25, 0.06 * handSign);
    rig.headGroup.rotation.set(-0.22, 1.05 * handSign, 0);

    const blockPitch = -0.45 - Math.min(0.68, u * 1.15) * 0.58;
    rig.leftArm.rotation.set(blockPitch, 0.38 + dirYaw * 0.2, 0.25);
    rig.rightArm.rotation.set(blockPitch, -0.32 + dirYaw * 0.2, -0.22);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.46, dirYaw * 0.4, 0.06 * handSign);
    }
    return;
  }

  if (family === 'kneeling_sweep') {
    // Low kneeling posture on back knee, horizontal sweeping arc across the turf
    const isReverse = shotSpec.shotId === 'reverse_sweep';
    const sweepDir = (isReverse ? -1 : 1) * handSign;
    rig.hips.position.set(0, 0.58, 0); // Drop low onto knee!
    rig.leftLeg.rotation.set(-0.92 * handSign, 0, 0.25);
    rig.rightLeg.rotation.set(0.95 * handSign, 0, -0.22);

    rig.hips.rotation.set(0, (-0.95 + u * 1.55 * sweepDir) * handSign, 0);
    rig.torso.rotation.set(0.52, u * 0.65 * sweepDir, 0.14 * sweepDir);
    rig.headGroup.rotation.set(-0.28, 0.65 * handSign, 0);

    const armSweepYaw = (-0.85 + u * 1.95) * sweepDir;
    rig.leftArm.rotation.set(-0.95, armSweepYaw + 0.25, 0.45);
    rig.rightArm.rotation.set(-0.92, armSweepYaw - 0.25, -0.45);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.25, armSweepYaw * 0.7, 1.28 * sweepDir);
    }
    return;
  }

  if (family === 'behind_wicket_ramp') {
    // Low crouched base, dipping wrists under the ball to scoop/ramp over keeper/fine leg/third man
    const isUppercut = shotSpec.shotId === 'uppercut';
    rig.hips.position.set(0, isUppercut ? 0.88 : 0.66, 0);
    rig.leftLeg.rotation.set(-0.68 * handSign, 0, 0.24);
    rig.rightLeg.rotation.set(0.62 * handSign, 0, -0.22);

    rig.hips.rotation.set(0, -0.65 * handSign + dirYaw * 0.4, 0);
    rig.torso.rotation.set(isUppercut ? -0.18 : 0.38 - u * 0.45, dirYaw * 0.35, -0.15 * handSign);
    rig.headGroup.rotation.set(-0.32, 0.55 * handSign, 0);

    const scoopPitch = isUppercut ? -1.25 - u * 0.95 : -0.45 - u * 1.65;
    rig.leftArm.rotation.set(scoopPitch, 0.25 + dirYaw * 0.3, 0.35);
    rig.rightArm.rotation.set(scoopPitch, -0.25 + dirYaw * 0.3, -0.35);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(1.35 - u * 2.45, dirYaw * 0.6, 0.55 * handSign);
    }
    return;
  }

  if (family === 'horizontal_cut') {
    // Back-foot pivot toward off-stump, high horizontal slashing arc from leg-to-off
    rig.hips.position.set(0, 0.88, 0);
    rig.leftLeg.rotation.set(0.24 * handSign, 0, 0.16);
    rig.rightLeg.rotation.set(-0.42 * handSign, 0, -0.18);

    rig.hips.rotation.set(0, (-1.28 + u * 0.95) * handSign, 0);
    rig.torso.rotation.set(0.14, (-0.45 + u * 0.85) * handSign, -0.12 * handSign);
    rig.headGroup.rotation.set(-0.12, (1.15 - u * 0.65) * handSign, 0);

    const cutYaw = (0.75 - u * 1.85) * handSign;
    const cutPitch = isLoft ? -1.15 - u * 0.55 : -1.05 + Math.sin(u * Math.PI) * 0.15;
    rig.leftArm.rotation.set(cutPitch, cutYaw + 0.3, 0.52);
    rig.rightArm.rotation.set(cutPitch, cutYaw - 0.2, -0.58);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.18, cutYaw * 0.65, -1.22 * handSign);
    }
    return;
  }

  if (family === 'horizontal_pull') {
    // Back-foot step across, chest rotating open toward Square Leg/Midwicket, horizontal cross-bat swivel pull/hook
    rig.hips.position.set(0, 0.89, 0);
    rig.leftLeg.rotation.set(-0.28 * handSign, 0, 0.22);
    rig.rightLeg.rotation.set(-0.35 * handSign, 0, -0.22);

    // Open chest squarely toward bowler and around to leg side
    rig.hips.rotation.set(0, (-0.95 + u * 1.75) * handSign, 0);
    rig.torso.rotation.set(0.08 - u * 0.18, (0.15 + u * 0.95) * handSign, 0.16 * handSign);
    rig.headGroup.rotation.set(-0.1, (0.85 - u * 0.95) * handSign, 0);

    const pullYaw = (-0.55 + u * 1.85) * handSign;
    const pullPitch = isLoft ? -1.12 - u * 0.55 : -1.02 - u * 0.25;
    rig.leftArm.rotation.set(pullPitch, pullYaw + 0.28, 0.55);
    rig.rightArm.rotation.set(pullPitch, pullYaw - 0.28, -0.48);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.22, pullYaw * 0.7, 1.25 * handSign);
    }
    return;
  }

  // Default: vertical_drive & on_side_flick (Flowing vertical pendulum arc oriented toward 360° aim direction)
  if (footwork === 'front_foot' || footwork === 'advance') {
    rig.hips.position.set(0, 0.81, 0);
    rig.leftLeg.rotation.set(-0.64 * handSign, 0, 0.22);
    rig.rightLeg.rotation.set(0.5 * handSign, 0, -0.18);
  } else {
    rig.hips.position.set(0, 0.91, 0);
    rig.leftLeg.rotation.set(0.18 * handSign, 0, 0.14);
    rig.rightLeg.rotation.set(-0.34 * handSign, 0, -0.14);
  }

  rig.hips.rotation.set(0, -1.15 * handSign + u * 0.88 * handSign + dirYaw * 0.5, 0);
  rig.torso.rotation.set(0.28 - swingArc * (isLoft ? 0.34 : 0.22), dirYaw * 0.45, 0.08 * handSign);
  rig.headGroup.rotation.set(-0.18, (1.15 - u * 0.55) * handSign, 0);

  const followThroughBoost = isLoft ? 2.15 : 1.85;
  const armPitch = -0.35 - u * followThroughBoost;
  rig.leftArm.rotation.set(armPitch, 0.35 + dirYaw * 0.45, 0.28);
  rig.rightArm.rotation.set(armPitch, -0.25 + dirYaw * 0.45, -0.18);
  if (rig.batPivot) {
    const wristSnap = 1.15 - u * (isLoft ? 2.65 : 2.35);
    const flickRoll = family === 'on_side_flick' ? 0.38 * handSign * u : 0.12 * handSign;
    rig.batPivot.rotation.set(wristSnap, dirYaw * 0.65, flickRoll);
  }
}

/**
 * Animates the Bowler through Run-Up, Gather, Delivery Stride, High-Arm Release, and Follow-Through.
 * `runupProgress` in [0, 1] before release; `followThroughProgress` in [0, 1] after release.
 */
export function applyBowlerDeliveryAnimation(
  rig: ArticulatedPlayerRig,
  phase: 'idle' | 'runup' | 'follow_through',
  progress: number,
  releaseX = -0.36,
): void {
  if (phase === 'idle') {
    rig.setCricketTransform({ x: releaseX - 0.18, y: -2.4, z: 0 }, 0);
    rig.hips.position.set(0, 0.94, 0);
    rig.hips.rotation.set(0, 0, 0);
    rig.torso.rotation.set(0.18, 0, 0);
    rig.leftArm.rotation.set(-0.45, 0, 0.15);
    rig.rightArm.rotation.set(-0.55, 0, -0.15);
    rig.leftLeg.rotation.set(0.14, 0, 0);
    rig.rightLeg.rotation.set(-0.14, 0, 0);
    return;
  }

  if (phase === 'runup') {
    // Sprint from Y = -2.4m to Y = 1.15m
    const u = Math.max(0, Math.min(1, progress));
    const curY = -2.4 + u * (1.15 - -2.4);
    const curX = releaseX - (1 - u) * 0.18;

    // Gather jump between u = 0.72 and u = 0.92
    let jumpZ = 0;
    if (u > 0.7 && u < 0.94) {
      jumpZ = Math.sin(((u - 0.7) / 0.24) * Math.PI) * 0.24;
    }

    rig.setCricketTransform({ x: curX, y: curY, z: jumpZ }, 0);

    const strideCycle = u * Math.PI * 6;
    rig.hips.position.y = 0.92 + Math.abs(Math.sin(strideCycle)) * 0.05;
    rig.leftLeg.rotation.x = Math.sin(strideCycle) * 0.68;
    rig.rightLeg.rotation.x = -Math.sin(strideCycle) * 0.68;

    if (u < 0.72) {
      // Rhythmic run-up arm pumping
      rig.torso.rotation.set(0.24, 0, 0);
      rig.leftArm.rotation.set(-Math.sin(strideCycle) * 0.65 - 0.3, 0, 0.14);
      rig.rightArm.rotation.set(Math.sin(strideCycle) * 0.65 - 0.3, 0, -0.14);
    } else {
      // Gather & 360-degree high-arm bowling windmill
      const coilU = (u - 0.72) / 0.28; // 0 -> 1 at ball release
      rig.torso.rotation.set(0.15 + coilU * 0.35, -0.55 + coilU * 0.85, 0);
      rig.leftArm.rotation.set(-2.6 + coilU * 2.2, 0, 0.2);
      rig.rightArm.rotation.set(1.2 - coilU * 4.3, 0, -0.12);
    }
    return;
  }

  // Follow-through deceleration from Y = 1.15m to Y = 2.65m
  const f = Math.max(0, Math.min(1, progress));
  const decelU = 1 - Math.pow(1 - f, 2.2);
  const curY = 1.15 + decelU * 1.55;
  const curX = releaseX - decelU * 0.22;
  rig.setCricketTransform({ x: curX, y: curY, z: 0 }, 0);

  const strideCycle = f * Math.PI * 3;
  rig.hips.position.y = 0.9;
  rig.torso.rotation.set(0.45 * (1 - f * 0.5), 0.35 * (1 - f), 0);
  rig.rightArm.rotation.set(-3.1 + f * 2.6, 0.25, -0.15);
  rig.leftArm.rotation.set(-0.4 + Math.sin(strideCycle) * 0.35, 0, 0.18);
  rig.leftLeg.rotation.x = Math.sin(strideCycle) * 0.45;
  rig.rightLeg.rotation.x = -Math.sin(strideCycle) * 0.45;
}

export function createBowlerModel(palette: KitPalette, castShadow: boolean): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig('bowler', palette, false, castShadow);

  const hairMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75 });
  const hairGeo = new THREE.SphereGeometry(0.124, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const hairMesh = new THREE.Mesh(hairGeo, hairMat);
  hairMesh.position.y = 0.025;
  rig.headGroup.add(hairMesh);

  applyBowlerDeliveryAnimation(rig, 'idle', 0);
  return rig;
}

export function createWicketkeeperModel(palette: KitPalette, castShadow: boolean): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig('wicketkeeper', palette, true, castShadow);

  const helmetMat = new THREE.MeshStandardMaterial({ color: palette.padsAndHelmet, roughness: 0.35 });
  const capMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.132, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
    helmetMat,
  );
  capMesh.position.y = 0.02;
  rig.headGroup.add(capMesh);

  const padMat = new THREE.MeshStandardMaterial({ color: palette.padsAndHelmet, roughness: 0.45 });
  for (const leg of [rig.leftLeg, rig.rightLeg]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.085), padMat);
    pad.position.set(0, -0.58, -0.045);
    leg.add(pad);
  }

  rig.hips.position.y = 0.74;
  rig.torso.rotation.x = 0.44;
  rig.leftLeg.rotation.set(-0.38, 0, 0.2);
  rig.rightLeg.rotation.set(-0.38, 0, -0.2);
  rig.leftArm.rotation.set(-0.78, 0, 0.26);
  rig.rightArm.rotation.set(-0.78, 0, -0.26);

  return rig;
}

export function createUmpireModel(castShadow: boolean): ArticulatedPlayerRig {
  const umpirePalette: KitPalette = {
    primaryJersey: 0xdc2626, // Elite ICC-style Crimson Match Official Polo
    secondaryTrim: 0x1e293b,
    trousers: 0x0f172a,
    padsAndHelmet: 0xf8fafc,
    skinTone: 0xc68642,
  };
  const rig = createBaseHumanoidRig('umpire', umpirePalette, false, castShadow);

  const hatMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
  const brimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.015, 20), hatMat);
  brimMesh.position.y = 0.075;
  rig.headGroup.add(brimMesh);

  const crownMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.095, 16), hatMat);
  crownMesh.position.y = 0.115;
  rig.headGroup.add(crownMesh);

  rig.leftArm.rotation.z = 0.09;
  rig.rightArm.rotation.z = -0.09;

  return rig;
}

export function createFielderModel(
  fielderId: string,
  palette: KitPalette,
  castShadow: boolean,
): ArticulatedPlayerRig {
  const rig = createBaseHumanoidRig(`fielder_${fielderId}`, palette, false, castShadow);

  const capMat = new THREE.MeshStandardMaterial({ color: palette.primaryJersey, roughness: 0.5 });
  const capDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.124, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    capMat,
  );
  capDome.position.y = 0.02;
  rig.headGroup.add(capDome);

  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.014, 0.095), capMat);
  brim.position.set(0, 0.03, -0.11);
  rig.headGroup.add(brim);

  rig.hips.position.y = 0.86;
  rig.torso.rotation.x = 0.24;
  rig.leftLeg.rotation.z = 0.14;
  rig.rightLeg.rotation.z = -0.14;
  rig.leftArm.rotation.set(-0.36, 0, 0.22);
  rig.rightArm.rotation.set(-0.36, 0, -0.22);

  return rig;
}

/**
 * Shared sculpted humanoid rig with rounded athletic geometry, shoulder/knee joints, and team trim.
 */
function createBaseHumanoidRig(
  name: string,
  palette: KitPalette,
  hasGloves: boolean,
  castShadow: boolean,
): ArticulatedPlayerRig {
  const root = new THREE.Group();
  root.name = name;
  // Slightly boost character visual scale (1.08x) for crisp silhouette readability on mobile & desktop
  root.scale.setScalar(1.08);

  root.add(createContactShadowDisc(0.48));

  const jerseyMat = new THREE.MeshStandardMaterial({
    color: palette.primaryJersey,
    roughness: 0.52,
    metalness: 0.06,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: palette.secondaryTrim,
    roughness: 0.38,
    metalness: 0.16,
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    color: palette.trousers,
    roughness: 0.62,
    metalness: 0.04,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: palette.skinTone,
    roughness: 0.58,
    metalness: 0.04,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.4,
    metalness: 0.12,
  });
  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.35,
    metalness: 0.1,
  });

  // Hips / Pelvis
  const hips = new THREE.Group();
  hips.position.y = 0.94;
  root.add(hips);

  const pelvisGeo = new THREE.CylinderGeometry(0.165, 0.155, 0.18, 16);
  pelvisGeo.scale(1.05, 1, 0.72);
  const pelvisMesh = new THREE.Mesh(pelvisGeo, trouserMat);
  pelvisMesh.castShadow = castShadow;
  hips.add(pelvisMesh);

  // Sculpted Athletic Torso (tapered V-taper chest + collar + shoulder caps)
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  hips.add(torso);

  const chestGeo = new THREE.CylinderGeometry(0.205, 0.162, 0.5, 18);
  chestGeo.scale(1.08, 1, 0.68);
  const chestMesh = new THREE.Mesh(chestGeo, jerseyMat);
  chestMesh.position.y = 0.25;
  chestMesh.castShadow = castShadow;
  chestMesh.receiveShadow = true;
  torso.add(chestMesh);

  // Championship chest band & collar
  const stripeGeo = new THREE.CylinderGeometry(0.202, 0.194, 0.075, 18);
  stripeGeo.scale(1.09, 1, 0.7);
  const stripeMesh = new THREE.Mesh(stripeGeo, trimMat);
  stripeMesh.position.y = 0.34;
  torso.add(stripeMesh);

  const collarGeo = new THREE.TorusGeometry(0.085, 0.018, 8, 16);
  collarGeo.rotateX(Math.PI / 2);
  const collarMesh = new THREE.Mesh(collarGeo, trimMat);
  collarMesh.position.y = 0.5;
  torso.add(collarMesh);

  // Head & Neck
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

  // Left & Right Articulated Arms
  const buildArm = (side: -1 | 1): THREE.Group => {
    const armGroup = new THREE.Group();
    armGroup.position.set(side * 0.245, 0.45, 0);

    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 12), jerseyMat);
    armGroup.add(shoulderCap);

    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.056, 0.24, 12), jerseyMat);
    sleeve.position.y = -0.12;
    sleeve.castShadow = castShadow;
    armGroup.add(sleeve);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.057, 0.024, 12), trimMat);
    cuff.position.y = -0.23;
    armGroup.add(cuff);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.27, 12), skinMat);
    forearm.position.y = -0.37;
    forearm.castShadow = castShadow;
    armGroup.add(forearm);

    const handGeo = hasGloves
      ? new THREE.BoxGeometry(0.095, 0.125, 0.075)
      : new THREE.SphereGeometry(0.048, 12, 12);
    const hand = new THREE.Mesh(handGeo, hasGloves ? gloveMat : skinMat);
    hand.position.y = -0.53;
    armGroup.add(hand);

    return armGroup;
  };

  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);
  torso.add(leftArm);
  torso.add(rightArm);

  // Left & Right Articulated Legs
  const buildLeg = (side: -1 | 1): THREE.Group => {
    const legGroup = new THREE.Group();
    legGroup.position.set(side * 0.115, -0.04, 0);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.072, 0.43, 14), trouserMat);
    thigh.position.y = -0.21;
    thigh.castShadow = castShadow;
    legGroup.add(thigh);

    const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), trouserMat);
    kneeJoint.position.y = -0.42;
    legGroup.add(kneeJoint);

    const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.052, 0.43, 14), trouserMat);
    calf.position.y = -0.62;
    calf.castShadow = castShadow;
    legGroup.add(calf);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.08, 0.25), shoeMat);
    boot.position.set(0, -0.86, -0.045);
    boot.castShadow = castShadow;
    legGroup.add(boot);

    return legGroup;
  };

  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);
  hips.add(leftLeg);
  hips.add(rightLeg);

  const setCricketTransform = (pos: CricketVec3, yawRadians: number) => {
    const threePos = cricketToThree(pos);
    root.position.set(threePos.x, threePos.y, threePos.z);
    root.rotation.y = cricketYawToThreeRotationY(yawRadians);
  };

  return {
    root,
    hips,
    torso,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    setCricketTransform,
  };
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

  // Base visual radius boosted slightly (1.48x of 0.036m) so the ball is crisp and unmistakable in broadcast view
  const visualBaseRadius = BALL_CONSTANTS.RADIUS_METERS * 1.48;
  const sphereGeo = new THREE.SphereGeometry(visualBaseRadius, 24, 20);
  const sphereMesh = new THREE.Mesh(sphereGeo, ballMat);
  sphereMesh.castShadow = true;
  root.add(sphereMesh);

  // Subtle high-contrast visibility halo ring around ball
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

  // Ground shadow cue directly at Z = 0.015m underneath ball's (X, Y) coordinate
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

    // Distance-aware scale boost so ball stays clearly readable at Striker's end (Y = 20m)
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
    ballMat.emissive.setHex(variant === 'white' ? 0x1e293b : variant === 'pink' ? 0x500724 : 0x450a0a);
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
  return getCricketYawBetweenPoints(pos, { x: 0, y: 18.9 });
}
