/**
 * CREASE CLASH — Canonical Character Orientation & Articulated Animation Controller
 *
 * Implements:
 * 1. Canonical Character Orientation (`-Z_rig` = forward `+Y_cricket` at `rotation.y = 0`).
 * 2. Zero-stacked-yaw Side-On Batting Stances for both Right-Handed (`RHB`) and Left-Handed (`LHB`) batters,
 *    with verified chest, front-shoulder, back-shoulder, and head-tracking vectors.
 * 3. Calculated diagonal facing direction for the Non-Striker toward the active pitch corridor,
 *    plus synchronized backing-up stride at bowler release.
 * 4. Multi-phase articulated animations (Anticipation -> Action -> Follow-Through -> Recovery)
 *    with elbow/forearm, knee/shin, ankle/boot articulation, two-handed bat grip, and kinematic foot planting.
 */

import * as THREE from 'three';
import {
  CricketVec3,
  cricketYawToThreeRotationY,
  getCricketYawBetweenPoints,
  getTransformedRigForwardCricket,
  getTransformedRigShouldersCricket,
  normalizeAngleRadians,
} from '../../shared/coordinates';
import { CORE_ACTOR_POSITIONS, PITCH_CONSTANTS } from '../../shared/constants';
import {
  BatterHandedness,
  FootworkType,
  ResolvedShotSpec,
} from '../../shared/batCollision';

export interface ArticulatedLimbArm {
  shoulderGroup: THREE.Group;
  elbowGroup: THREE.Group;
  wristGroup: THREE.Group;
}

export interface ArticulatedLimbLeg {
  hipGroup: THREE.Group;
  kneeGroup: THREE.Group;
  ankleGroup: THREE.Group;
}

export interface ArticulatedPlayerRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  headGroup: THREE.Group;
  /** Upper arm group at shoulder (backward-compatible alias for leftArmChain.shoulderGroup) */
  leftArm: THREE.Group;
  /** Upper arm group at shoulder (backward-compatible alias for rightArmChain.shoulderGroup) */
  rightArm: THREE.Group;
  /** Forearm group at elbow */
  leftForearm: THREE.Group;
  /** Forearm group at elbow */
  rightForearm: THREE.Group;
  /** Thigh group at hip (backward-compatible alias for leftLegChain.hipGroup) */
  leftLeg: THREE.Group;
  /** Thigh group at hip (backward-compatible alias for rightLegChain.hipGroup) */
  rightLeg: THREE.Group;
  /** Lower leg / shin group at knee */
  leftShin: THREE.Group;
  /** Lower leg / shin group at knee */
  rightShin: THREE.Group;
  /** Boot / ankle group */
  leftAnkle: THREE.Group;
  /** Boot / ankle group */
  rightAnkle: THREE.Group;
  batPivot?: THREE.Group;
  /** Authoritative Cricket World position currently applied to root */
  currentCricketPos: CricketVec3;
  /** Authoritative Cricket World yaw (radians) currently applied to root */
  currentCricketYaw: number;
  setCricketTransform: (pos: CricketVec3, yawRadians: number) => void;
}

export interface StrikerCanonicalOrientation {
  handedness: BatterHandedness;
  stancePosition: CricketVec3;
  /** Canonical Cricket World yaw of the root/chest (zero stacked hip yaw) */
  rootYawCricket: number;
  /** Three.js root.rotation.y */
  rootThreeRotationY: number;
  /** Three.js hips.rotation.y (strictly 0 in ready stance to avoid stacked yaw) */
  hipsThreeRotationY: number;
  /** Three.js torso.rotation.y (strictly 0 in ready stance) */
  torsoThreeRotationY: number;
  /** Three.js headGroup.rotation.y turning the head to face the bowler */
  headLocalThreeRotationY: number;
  /** Cumulative Three.js Y rotation of the head in world space */
  headWorldThreeRotationY: number;
  /** Actual transformed chest forward unit vector in Cricket (X, Y, Z) */
  chestForwardCricket: CricketVec3;
  /** Actual transformed bowler-side (front) shoulder unit vector in Cricket (X, Y, Z) */
  frontShoulderCricket: CricketVec3;
  /** Actual transformed keeper-side (back) shoulder unit vector in Cricket (X, Y, Z) */
  backShoulderCricket: CricketVec3;
  /** Actual transformed head/eyes forward unit vector in Cricket (X, Y, Z) */
  headForwardCricket: CricketVec3;
}

/**
 * Default focus point on the pitch corridor that the Non-Striker watches while backing up
 * at the bowler's end before delivery release.
 */
export const NON_STRIKER_CORRIDOR_FOCUS: CricketVec3 = {
  x: 0.0,
  y: 3.4,
  z: 0.0,
};

/**
 * Computes the canonical side-on Striker orientation for RHB or LHB without stacked root + hip yaw.
 *
 * - RHB stands at X = -0.26m (leg-side of stumps):
 *   - Chest faces +X (Off-Side), slightly open (~6.9 deg / 0.12 rad) toward the bowler (-Y).
 *   - Bowler-side front shoulder points down the pitch toward the bowler (-Y).
 *   - Keeper-side back shoulder points toward the wicketkeeper (+Y).
 *   - Head turns toward the front shoulder to look directly at the bowler release point.
 *
 * - LHB stands at X = +0.26m (leg-side for LHB):
 *   - Chest faces -X (Off-Side for LHB), slightly open toward the bowler (-Y).
 *   - Bowler-side front shoulder points down the pitch toward the bowler (-Y).
 *   - Keeper-side back shoulder points toward the wicketkeeper (+Y).
 *   - Head turns toward the front shoulder to look directly at the bowler release point.
 */
export function computeStrikerCanonicalOrientation(
  handedness: BatterHandedness = 'RHB',
  stancePosOverride?: CricketVec3,
  bowlerFocusTarget: CricketVec3 = CORE_ACTOR_POSITIONS.BOWLER_RELEASE_POINT,
): StrikerCanonicalOrientation {
  const handSign = handedness === 'LHB' ? -1 : 1;
  const stancePosition: CricketVec3 = stancePosOverride ?? {
    x: -0.26 * handSign,
    y: CORE_ACTOR_POSITIONS.STRIKER_STANCE.y,
    z: 0,
  };

  // Side-on chest yaw in Cricket World:
  // +pi/2 faces +X (RHB off-side); -pi/2 faces -X (LHB off-side).
  // Adding +0.12 * handSign opens the front shoulder by ~6.9° toward the bowler (-Y).
  const rootYawCricket = handSign * (Math.PI / 2 + 0.12);
  const rootThreeRotationY = cricketYawToThreeRotationY(rootYawCricket);
  const hipsThreeRotationY = 0;
  const torsoThreeRotationY = 0;

  // Target yaw for head/eyes to look directly at the bowler's release point
  const targetHeadYawCricket = getCricketYawBetweenPoints(stancePosition, bowlerFocusTarget);
  const headDeltaYawCricket = normalizeAngleRadians(targetHeadYawCricket - rootYawCricket);
  const headLocalThreeRotationY = cricketYawToThreeRotationY(headDeltaYawCricket);
  const headWorldThreeRotationY =
    rootThreeRotationY + hipsThreeRotationY + torsoThreeRotationY + headLocalThreeRotationY;

  const chestForwardCricket = getTransformedRigForwardCricket(
    rootThreeRotationY + hipsThreeRotationY + torsoThreeRotationY,
  );
  const shoulders = getTransformedRigShouldersCricket(
    rootThreeRotationY + hipsThreeRotationY + torsoThreeRotationY,
  );

  // When facing +X (RHB), +X_rig (rightShoulder) is on the -Y (bowler) side and -X_rig (leftShoulder) is on the +Y (keeper) side.
  // When facing -X (LHB), -X_rig (leftShoulder) is on the -Y (bowler) side and +X_rig (rightShoulder) is on the +Y (keeper) side.
  const frontShoulderCricket =
    handedness === 'RHB' ? shoulders.rightShoulder : shoulders.leftShoulder;
  const backShoulderCricket =
    handedness === 'RHB' ? shoulders.leftShoulder : shoulders.rightShoulder;
  const headForwardCricket = getTransformedRigForwardCricket(headWorldThreeRotationY);

  return {
    handedness,
    stancePosition,
    rootYawCricket,
    rootThreeRotationY,
    hipsThreeRotationY,
    torsoThreeRotationY,
    headLocalThreeRotationY,
    headWorldThreeRotationY,
    chestForwardCricket,
    frontShoulderCricket,
    backShoulderCricket,
    headForwardCricket,
  };
}

/**
 * Computes the Non-Striker's diagonal facing yaw in Cricket World Coordinates from their actual
 * world position toward the intended pitch corridor target (never hardcoded to -Math.PI/2).
 */
export function computeNonStrikerCanonicalOrientation(
  nonStrikerPos: CricketVec3 = CORE_ACTOR_POSITIONS.NON_STRIKER_STANCE,
  focusTarget: CricketVec3 = NON_STRIKER_CORRIDOR_FOCUS,
): {
  yawCricket: number;
  threeRotationY: number;
  forwardCricket: CricketVec3;
} {
  const yawCricket = getCricketYawBetweenPoints(nonStrikerPos, focusTarget);
  const threeRotationY = cricketYawToThreeRotationY(yawCricket);
  const forwardCricket = getTransformedRigForwardCricket(threeRotationY);
  return {
    yawCricket,
    threeRotationY,
    forwardCricket,
  };
}

/**
 * Computes canonical facing orientation for any actor facing a target point in Cricket World Coordinates.
 */
export function computeActorFacingTargetOrientation(
  actorPos: Pick<CricketVec3, 'x' | 'y'>,
  targetPos: Pick<CricketVec3, 'x' | 'y'>,
): {
  yawCricket: number;
  threeRotationY: number;
  forwardCricket: CricketVec3;
} {
  const yawCricket = getCricketYawBetweenPoints(actorPos, targetPos);
  const threeRotationY = cricketYawToThreeRotationY(yawCricket);
  const forwardCricket = getTransformedRigForwardCricket(threeRotationY);
  return {
    yawCricket,
    threeRotationY,
    forwardCricket,
  };
}

/**
 * Kinematic Foot Planting Solver:
 * Computes the vertical drop from the pelvis/hips to the lowest planted boot sole based on
 * the current thigh (`leftLeg`, `rightLeg`) and shin (`leftShin`, `rightShin`) flexion angles,
 * and adjusts `rig.hips.position.y` so the lowest foot rests squarely on the turf (local y = 0)
 * without sinking underground or floating in mid-air.
 */
export function plantRigFeetOnTurf(rig: ArticulatedPlayerRig, extraLiftLocalY = 0): void {
  const thighLen = 0.42;
  const shinLen = 0.42;
  const bootSoleDepth = 0.08;
  const hipJointOffsetY = -0.04;

  const computeLegDrop = (thighRotX: number, thighRotZ: number, shinRotX: number): number => {
    const cosZ = Math.cos(thighRotZ);
    const thighVertical = thighLen * Math.cos(thighRotX) * cosZ;
    const totalKneePitch = thighRotX + shinRotX;
    const shinVertical = shinLen * Math.cos(totalKneePitch) * cosZ;
    return Math.max(0.32, thighVertical + shinVertical + bootSoleDepth - hipJointOffsetY);
  };

  const leftDrop = computeLegDrop(
    rig.leftLeg.rotation.x,
    rig.leftLeg.rotation.z,
    rig.leftShin.rotation.x,
  );
  const rightDrop = computeLegDrop(
    rig.rightLeg.rotation.x,
    rig.rightLeg.rotation.z,
    rig.rightShin.rotation.x,
  );

  // Plant the lower (supporting) foot cleanly on y = 0
  const maxDrop = Math.max(leftDrop, rightDrop);
  rig.hips.position.y = maxDrop + extraLiftLocalY;
}

/**
 * Resets all sub-limb rotations to neutral before applying a specific pose.
 */
function resetSubLimbs(rig: ArticulatedPlayerRig): void {
  rig.hips.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.headGroup.rotation.set(0, 0, 0);
  rig.leftForearm.rotation.set(0, 0, 0);
  rig.rightForearm.rotation.set(0, 0, 0);
  rig.leftShin.rotation.set(0, 0, 0);
  rig.rightShin.rotation.set(0, 0, 0);
  rig.leftAnkle.rotation.set(0, 0, 0);
  rig.rightAnkle.rotation.set(0, 0, 0);
}

/**
 * Applies the canonical side-on Right-Handed or Left-Handed Ready Batting Stance
 * with zero stacked hip yaw, flexed knees, head turned toward the bowler, and a genuine
 * two-handed grip on the bat handle.
 */
export function applyCanonicalStrikerReadyStance(
  rig: ArticulatedPlayerRig,
  breathPhase = 0,
  handedness: BatterHandedness = 'RHB',
  stancePosOverride?: CricketVec3,
): StrikerCanonicalOrientation {
  resetSubLimbs(rig);
  const handSign = handedness === 'LHB' ? -1 : 1;
  const orientation = computeStrikerCanonicalOrientation(handedness, stancePosOverride);

  rig.setCricketTransform(orientation.stancePosition, orientation.rootYawCricket);

  // Strictly zero stacked hip/torso yaw in ready stance
  const breathTap = Math.sin(breathPhase) * 0.035;
  rig.hips.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0.22 + breathTap * 0.15, 0, -0.05 * handSign);

  // Head turned over front shoulder to face the bowler squarely
  rig.headGroup.rotation.set(-0.14, orientation.headLocalThreeRotationY, 0);

  // Athletic balanced knee bend in both legs, feet shoulder-width apart parallel to crease
  rig.leftLeg.rotation.set(-0.24, 0, 0.12);
  rig.rightLeg.rotation.set(-0.24, 0, -0.12);
  rig.leftShin.rotation.set(0.42, 0, 0);
  rig.rightShin.rotation.set(0.42, 0, 0);
  rig.leftAnkle.rotation.set(-0.18, 0, 0);
  rig.rightAnkle.rotation.set(-0.18, 0, 0);

  // Two-handed grip bringing both hands together in front of the front thigh on the bat handle
  if (handedness === 'RHB') {
    // Right arm is bowler-side front arm (+X_rig); Left arm is keeper-side back arm (-X_rig)
    rig.rightArm.rotation.set(-0.42, -0.34, -0.28);
    rig.rightForearm.rotation.set(-0.68 + breathTap, -0.15, -0.12);
    rig.leftArm.rotation.set(-0.48, 0.38, 0.32);
    rig.leftForearm.rotation.set(-0.72 + breathTap, 0.18, 0.14);
  } else {
    rig.leftArm.rotation.set(-0.42, 0.34, 0.28);
    rig.leftForearm.rotation.set(-0.68 + breathTap, 0.15, 0.12);
    rig.rightArm.rotation.set(-0.48, -0.38, -0.32);
    rig.rightForearm.rotation.set(-0.72 + breathTap, -0.18, -0.14);
  }

  if (rig.batPivot) {
    // Ready backlift: blade angled back toward wicketkeeper/first slip (-X_rig for RHB, +X_rig for LHB)
    rig.batPivot.rotation.set(
      0.18 + breathTap * 1.1,
      0.12 * handSign,
      (-0.62 - breathTap * 0.6) * handSign,
    );
  }

  plantRigFeetOnTurf(rig);
  return orientation;
}

/**
 * Animates the Striker through:
 * 1. Pre-delivery anticipation / trigger press & backlift coil
 * 2. Footwork stride (Front Foot, Back Foot, Advance, Leave)
 * 3. Active 3D bat swing across all 8 SwingPlaneFamily archetypes
 * 4. Balanced follow-through & recovery with kinematic foot planting
 */
export function animateStrikerShotSequence(
  rig: ArticulatedPlayerRig,
  baseStancePos: CricketVec3,
  footwork: FootworkType,
  shotSpec: ResolvedShotSpec,
  handedness: BatterHandedness,
  swingProgress: number,
  isSwinging: boolean,
  preReleaseCoilProgress = 0,
): void {
  const handSign = handedness === 'LHB' ? -1 : 1;
  const stanceBaseX = -0.26 * handSign;
  const stepFactor = isSwinging
    ? Math.min(1, swingProgress * 2.6)
    : Math.min(0.45, preReleaseCoilProgress * 0.45);

  // 1. Footwork displacement in Cricket (X, Y, Z)
  let footOffsetY = 0;
  let footOffsetX = 0;
  const lateralBias = Math.max(-1, Math.min(1, shotSpec.relativeAngleDeg / 75)) * handSign;

  if (footwork === 'advance') {
    footOffsetY = -1.78 * stepFactor;
    footOffsetX = 0.18 * lateralBias * stepFactor;
  } else if (footwork === 'front_foot') {
    footOffsetY = -0.62 * stepFactor;
    footOffsetX = 0.15 * lateralBias * stepFactor;
  } else if (footwork === 'back_foot') {
    footOffsetY = 0.44 * stepFactor;
    footOffsetX = 0.14 * lateralBias * stepFactor;
  }

  const currentStancePos: CricketVec3 = {
    x: stanceBaseX + footOffsetX,
    y: baseStancePos.y + footOffsetY,
    z: 0,
  };

  const baseOrientation = applyCanonicalStrikerReadyStance(
    rig,
    performance.now() * 0.0035,
    handedness,
    currentStancePos,
  );

  // 2. Leave animation: withdraw bat high above shoulder while watching ball into keeper's gloves
  if (footwork === 'leave' || shotSpec.swingFamily === 'leave') {
    rig.torso.rotation.set(0.08, 0, 0.14 * handSign);
    rig.headGroup.rotation.set(-0.1, baseOrientation.headLocalThreeRotationY, 0);
    rig.leftArm.rotation.set(-1.65, 0.25, 0.28);
    rig.rightArm.rotation.set(-1.65, -0.25, -0.28);
    rig.leftForearm.rotation.set(-0.65, 0, 0);
    rig.rightForearm.rotation.set(-0.65, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(-0.45, 0.15 * handSign, -0.25 * handSign);
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  // 3. Pre-swing anticipation & high backlift coil during bowler run-up / early flight
  if (!isSwinging && swingProgress <= 0.01) {
    const coil = Math.max(0, Math.min(1, preReleaseCoilProgress));
    if (footwork === 'advance') {
      rig.leftLeg.rotation.set(-0.45, 0, 0.28 * handSign);
      rig.rightLeg.rotation.set(-0.35, 0, -0.28 * handSign);
      rig.leftShin.rotation.set(0.55, 0, 0);
      rig.rightShin.rotation.set(0.48, 0, 0);
    } else if (footwork === 'front_foot') {
      rig.leftLeg.rotation.set(-0.32, 0, 0.22 * handSign);
      rig.rightLeg.rotation.set(-0.22, 0, -0.22 * handSign);
      rig.leftShin.rotation.set(0.48, 0, 0);
      rig.rightShin.rotation.set(0.36, 0, 0);
    } else if (footwork === 'back_foot') {
      rig.leftLeg.rotation.set(-0.18, 0, 0.16 * handSign);
      rig.rightLeg.rotation.set(-0.34, 0, -0.2 * handSign);
      rig.leftShin.rotation.set(0.32, 0, 0);
      rig.rightShin.rotation.set(0.52, 0, 0);
    }

    // Backlift rises smoothly as bowler approaches release
    if (coil > 0.05 && rig.batPivot) {
      rig.rightForearm.rotation.x -= coil * 0.32;
      rig.leftForearm.rotation.x -= coil * 0.32;
      rig.batPivot.rotation.x += coil * 0.38;
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  // 4. Active Downswing, Impact & Balanced Follow-Through (u in [0, 1])
  const u = Math.max(0, Math.min(1, swingProgress));
  // Smooth S-curve acceleration through impact (u ~ 0.5) and deceleration into follow-through (u -> 1)
  const easeU = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  const swingArc = Math.sin(easeU * Math.PI * 0.9);
  const isLoft = shotSpec.shotIntent === 'loft';
  const family = shotSpec.swingFamily;
  const dirYaw = Math.max(-1.05, Math.min(1.05, (shotSpec.relativeAngleDeg / 75) * 0.6)) * handSign;

  // Front leg vs back leg split along pitch axis (for RHB facing +X, bowler -Y is along +X_rig)
  const strideSplitZ = 0.44 * handSign;

  if (family === 'defensive_push') {
    const isBack = footwork === 'back_foot';
    rig.leftLeg.rotation.set(-0.28, 0, isBack ? 0.12 : -strideSplitZ * 0.7);
    rig.rightLeg.rotation.set(-0.34, 0, isBack ? -0.18 : strideSplitZ * 0.85);
    rig.leftShin.rotation.set(isBack ? 0.38 : 0.25, 0, 0);
    rig.rightShin.rotation.set(isBack ? 0.46 : 0.62, 0, 0);

    // Subtle shoulder turn into defensive press, keeping head right over the ball
    const rootTurnYaw = baseOrientation.rootYawCricket + easeU * 0.18 * handSign;
    rig.setCricketTransform(currentStancePos, rootTurnYaw);
    rig.torso.rotation.set(0.32, 0.12 * handSign, -0.14 * handSign);
    rig.headGroup.rotation.set(-0.26, baseOrientation.headLocalThreeRotationY - easeU * 0.14 * handSign, 0);

    const pressAngle = -0.62 - Math.min(0.45, easeU * 0.55);
    rig.rightArm.rotation.set(pressAngle, -0.28, -0.38 * handSign);
    rig.leftArm.rotation.set(pressAngle, 0.28, -0.32 * handSign);
    rig.rightForearm.rotation.set(-0.55, 0, 0);
    rig.leftForearm.rotation.set(-0.55, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.35, dirYaw * 0.3, -0.18 * handSign);
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  if (family === 'kneeling_sweep') {
    const isReverse = shotSpec.shotId === 'reverse_sweep';
    const sweepDir = (isReverse ? -1 : 1) * handSign;

    // Deep kneeling lunge on back knee, front leg extended toward pitch of ball
    rig.leftLeg.rotation.set(-0.55, 0, -strideSplitZ * 0.9);
    rig.rightLeg.rotation.set(-0.65, 0, strideSplitZ * 0.95);
    rig.leftShin.rotation.set(1.15, 0, 0);
    rig.rightShin.rotation.set(0.42, 0, 0);

    const sweepRootYaw = baseOrientation.rootYawCricket + easeU * 0.85 * sweepDir;
    rig.setCricketTransform(currentStancePos, sweepRootYaw);
    rig.torso.rotation.set(0.48, easeU * 0.45 * sweepDir, -0.18 * sweepDir);
    rig.headGroup.rotation.set(-0.28, baseOrientation.headLocalThreeRotationY * 0.6, 0);

    const armSweepYaw = (-0.75 + easeU * 1.85) * sweepDir;
    rig.rightArm.rotation.set(-0.88, armSweepYaw - 0.2, -0.42);
    rig.leftArm.rotation.set(-0.88, armSweepYaw + 0.2, 0.42);
    rig.rightForearm.rotation.set(-0.48, 0, 0);
    rig.leftForearm.rotation.set(-0.48, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.24, armSweepYaw * 0.65, 1.18 * sweepDir);
    }
    plantRigFeetOnTurf(rig, -0.08);
    return;
  }

  if (family === 'behind_wicket_ramp') {
    const isUppercut = shotSpec.shotId === 'uppercut';
    rig.leftLeg.rotation.set(-0.48, 0, 0.22);
    rig.rightLeg.rotation.set(-0.48, 0, -0.22);
    rig.leftShin.rotation.set(isUppercut ? 0.35 : 0.82, 0, 0);
    rig.rightShin.rotation.set(isUppercut ? 0.35 : 0.82, 0, 0);

    const rampRootYaw = baseOrientation.rootYawCricket + easeU * 0.35 * handSign;
    rig.setCricketTransform(currentStancePos, rampRootYaw);
    rig.torso.rotation.set(isUppercut ? -0.16 : 0.35 - easeU * 0.42, dirYaw * 0.3, -0.12 * handSign);
    rig.headGroup.rotation.set(-0.32, baseOrientation.headLocalThreeRotationY * 0.5, 0);

    const scoopPitch = isUppercut ? -1.18 - easeU * 0.88 : -0.52 - easeU * 1.45;
    rig.rightArm.rotation.set(scoopPitch, -0.22 + dirYaw * 0.25, -0.32);
    rig.leftArm.rotation.set(scoopPitch, 0.22 + dirYaw * 0.25, 0.32);
    rig.rightForearm.rotation.set(-0.65, 0, 0);
    rig.leftForearm.rotation.set(-0.65, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(1.22 - easeU * 2.25, dirYaw * 0.55, 0.48 * handSign);
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  if (family === 'horizontal_cut') {
    // Back-foot pivot across toward off-stump, slashing horizontal arc from high-to-point/third-man
    rig.leftLeg.rotation.set(-0.22, 0, 0.24 * handSign);
    rig.rightLeg.rotation.set(-0.32, 0, -0.28 * handSign);
    rig.leftShin.rotation.set(0.45, 0, 0);
    rig.rightShin.rotation.set(0.32, 0, 0);

    const cutRootYaw = baseOrientation.rootYawCricket - easeU * 0.45 * handSign;
    rig.setCricketTransform(currentStancePos, cutRootYaw);
    rig.torso.rotation.set(0.14, (-0.35 + easeU * 0.78) * handSign, -0.1 * handSign);
    rig.headGroup.rotation.set(-0.12, baseOrientation.headLocalThreeRotationY * 0.65, 0);

    const cutYaw = (0.68 - easeU * 1.75) * handSign;
    const cutPitch = isLoft ? -1.08 - easeU * 0.48 : -0.98 + Math.sin(easeU * Math.PI) * 0.14;
    rig.rightArm.rotation.set(cutPitch, cutYaw - 0.18, -0.52);
    rig.leftArm.rotation.set(cutPitch, cutYaw + 0.26, 0.48);
    rig.rightForearm.rotation.set(-0.52, 0, 0);
    rig.leftForearm.rotation.set(-0.52, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.18, cutYaw * 0.6, -1.18 * handSign);
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  if (family === 'horizontal_pull') {
    // Back-foot step & chest rotation opening toward Bowler / Midwicket / Square Leg
    rig.leftLeg.rotation.set(-0.28, 0, 0.2);
    rig.rightLeg.rotation.set(-0.32, 0, -0.2);
    rig.leftShin.rotation.set(0.48, 0, 0);
    rig.rightShin.rotation.set(0.38, 0, 0);

    const pullRootYaw = baseOrientation.rootYawCricket + easeU * 1.15 * handSign;
    rig.setCricketTransform(currentStancePos, pullRootYaw);
    rig.torso.rotation.set(0.08 - easeU * 0.16, easeU * 0.55 * handSign, 0.14 * handSign);
    rig.headGroup.rotation.set(-0.1, baseOrientation.headLocalThreeRotationY * (1 - easeU * 0.65), 0);

    const pullYaw = (-0.52 + easeU * 1.75) * handSign;
    const pullPitch = isLoft ? -1.08 - easeU * 0.52 : -0.96 - easeU * 0.22;
    rig.rightArm.rotation.set(pullPitch, pullYaw - 0.24, -0.45);
    rig.leftArm.rotation.set(pullPitch, pullYaw + 0.24, 0.48);
    rig.rightForearm.rotation.set(-0.58, 0, 0);
    rig.leftForearm.rotation.set(-0.58, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(0.22, pullYaw * 0.68, 1.2 * handSign);
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  // Classical vertical_drive & on_side_flick (flowing vertical pendulum arc with high elbow)
  if (footwork === 'front_foot' || footwork === 'advance') {
    rig.leftLeg.rotation.set(-0.32, 0, -strideSplitZ * 0.78);
    rig.rightLeg.rotation.set(-0.42, 0, strideSplitZ * 0.92);
    rig.leftShin.rotation.set(0.32, 0, 0);
    rig.rightShin.rotation.set(0.68, 0, 0);
  } else {
    rig.leftLeg.rotation.set(-0.26, 0, 0.16);
    rig.rightLeg.rotation.set(-0.28, 0, -0.16);
    rig.leftShin.rotation.set(0.46, 0, 0);
    rig.rightShin.rotation.set(0.38, 0, 0);
  }

  const driveRootYaw = baseOrientation.rootYawCricket + easeU * 0.52 * handSign + dirYaw * 0.35;
  rig.setCricketTransform(currentStancePos, driveRootYaw);
  rig.torso.rotation.set(
    0.26 - swingArc * (isLoft ? 0.32 : 0.2),
    dirYaw * 0.38,
    -0.08 * handSign,
  );
  rig.headGroup.rotation.set(
    -0.18,
    baseOrientation.headLocalThreeRotationY * (1 - easeU * 0.45),
    0,
  );

  const followThroughBoost = isLoft ? 1.95 : 1.68;
  const armPitch = -0.38 - easeU * followThroughBoost;
  rig.rightArm.rotation.set(armPitch, -0.22 + dirYaw * 0.4, -0.24 * handSign);
  rig.leftArm.rotation.set(armPitch, 0.28 + dirYaw * 0.4, -0.22 * handSign);
  rig.rightForearm.rotation.set(-0.62 + swingArc * 0.25, 0, 0);
  rig.leftForearm.rotation.set(-0.68 + swingArc * 0.28, 0, 0);

  if (rig.batPivot) {
    const wristSnap = 0.95 - easeU * (isLoft ? 2.45 : 2.15);
    const flickRoll =
      family === 'on_side_flick' ? 0.38 * handSign * easeU : -0.22 * handSign * (1 - easeU);
    rig.batPivot.rotation.set(wristSnap, dirYaw * 0.6, flickRoll);
  }

  plantRigFeetOnTurf(rig);
}

/**
 * Animates the Bowler through:
 * - `idle`: Poised top-of-mark ready stance facing +Y toward the striker's wicket
 * - `runup`: Rhythmic accelerating strides -> pre-delivery gather leap -> front-foot block & high-arm release
 * - `follow_through`: Deceleration strides down the pitch beside the danger area & recovery balance
 */
export function animateBowlerDeliverySequence(
  rig: ArticulatedPlayerRig,
  phase: 'idle' | 'runup' | 'follow_through',
  progress: number,
  releaseX = -0.36,
  breathPhase = 0,
): void {
  resetSubLimbs(rig);

  if (phase === 'idle') {
    const startPos: CricketVec3 = { x: releaseX - 0.16, y: -2.4, z: 0 };
    const facing = computeActorFacingTargetOrientation(startPos, {
      x: 0,
      y: PITCH_CONSTANTS.STRIKER_STUMPS_Y,
    });
    rig.setCricketTransform(startPos, facing.yawCricket);

    const breathe = Math.sin(breathPhase) * 0.025;
    rig.torso.rotation.set(0.18 + breathe, 0, 0);
    rig.headGroup.rotation.set(-0.08, 0, 0);

    // Hands cupped together at chest/chin holding the new ball at top of mark
    rig.leftArm.rotation.set(-0.52, 0.28, 0.18);
    rig.rightArm.rotation.set(-0.58, -0.28, -0.18);
    rig.leftForearm.rotation.set(-0.85, 0, 0);
    rig.rightForearm.rotation.set(-0.92, 0, 0);

    rig.leftLeg.rotation.set(-0.18, 0, 0.06);
    rig.rightLeg.rotation.set(0.12, 0, -0.06);
    rig.leftShin.rotation.set(0.32, 0, 0);
    rig.rightShin.rotation.set(0.24, 0, 0);

    plantRigFeetOnTurf(rig);
    return;
  }

  if (phase === 'runup') {
    const u = Math.max(0, Math.min(1, progress));
    const curY = -2.4 + u * (1.15 - -2.4);
    const curX = releaseX - (1 - u) * 0.16;

    // Gather bound leap between u = 0.70 and u = 0.92
    let jumpZ = 0;
    if (u > 0.7 && u < 0.94) {
      jumpZ = Math.sin(((u - 0.7) / 0.24) * Math.PI) * 0.22;
    }

    const curPos: CricketVec3 = { x: curX, y: curY, z: jumpZ };
    const facing = computeActorFacingTargetOrientation(curPos, {
      x: 0,
      y: PITCH_CONSTANTS.STRIKER_STUMPS_Y,
    });
    rig.setCricketTransform(curPos, facing.yawCricket);

    const strideCycle = u * Math.PI * 6;
    const leftSwing = Math.sin(strideCycle);
    const rightSwing = -leftSwing;

    rig.leftLeg.rotation.set(leftSwing * 0.62 - 0.12, 0, 0.05);
    rig.rightLeg.rotation.set(rightSwing * 0.62 - 0.12, 0, -0.05);
    rig.leftShin.rotation.set(Math.max(0.18, -leftSwing * 0.72 + 0.35), 0, 0);
    rig.rightShin.rotation.set(Math.max(0.18, -rightSwing * 0.72 + 0.35), 0, 0);

    if (u < 0.72) {
      // Rhythmic athletic sprint with bent elbows and counter-rotating shoulders
      rig.torso.rotation.set(0.26, Math.cos(strideCycle) * 0.18, 0);
      rig.headGroup.rotation.set(-0.14, -Math.cos(strideCycle) * 0.12, 0);
      rig.leftArm.rotation.set(-leftSwing * 0.62 - 0.25, 0, 0.14);
      rig.rightArm.rotation.set(-rightSwing * 0.62 - 0.25, 0, -0.14);
      rig.leftForearm.rotation.set(-1.05, 0, 0);
      rig.rightForearm.rotation.set(-1.05, 0, 0);
    } else {
      // Pre-delivery side-on gather coil -> front-arm pull -> high-arm over-the-top release
      const coilU = (u - 0.72) / 0.28; // 0 -> 1 at exact ball release
      rig.torso.rotation.set(0.14 + coilU * 0.38, -0.62 + coilU * 0.92, -0.12 * coilU);
      rig.headGroup.rotation.set(-0.12 - coilU * 0.15, 0.45 * (1 - coilU), 0);

      // Front arm (leftArm) reaches skyward then pulls down sharply into ribs
      rig.leftArm.rotation.set(-2.65 + coilU * 2.25, 0.15, 0.22);
      rig.leftForearm.rotation.set(-0.35 - coilU * 0.65, 0, 0);

      // Bowling arm (rightArm) stays straight at apex release
      rig.rightArm.rotation.set(1.15 - coilU * 4.25, 0, -0.1);
      rig.rightForearm.rotation.set(-0.08 * (1 - coilU), 0, 0);

      // Braced front left leg plant at release (coilU -> 1)
      if (coilU > 0.65) {
        rig.leftLeg.rotation.set(-0.48, 0, 0.06);
        rig.leftShin.rotation.set(0.12, 0, 0);
        rig.rightLeg.rotation.set(0.42, 0, -0.08);
        rig.rightShin.rotation.set(0.65, 0, 0);
      }
    }

    plantRigFeetOnTurf(rig);
    return;
  }

  // Follow-through deceleration & recovery walk from Y = 1.15m to Y = 2.65m
  const f = Math.max(0, Math.min(1, progress));
  const decelU = 1 - Math.pow(1 - f, 2.2);
  const curY = 1.15 + decelU * 1.5;
  const curX = releaseX - decelU * 0.24;
  const curPos: CricketVec3 = { x: curX, y: curY, z: 0 };
  const facing = computeActorFacingTargetOrientation(curPos, {
    x: 0,
    y: PITCH_CONSTANTS.STRIKER_STUMPS_Y,
  });
  rig.setCricketTransform(curPos, facing.yawCricket);

  const strideCycle = f * Math.PI * 3;
  rig.torso.rotation.set(0.44 * (1 - f * 0.55), 0.32 * (1 - f), 0);
  rig.headGroup.rotation.set(-0.22 * (1 - f * 0.5), 0, 0);
  rig.rightArm.rotation.set(-3.05 + f * 2.55, 0.22 * (1 - f), -0.14);
  rig.rightForearm.rotation.set(-0.45 * f, 0, 0);
  rig.leftArm.rotation.set(-0.42 + Math.sin(strideCycle) * 0.32, 0, 0.18);
  rig.leftForearm.rotation.set(-0.75, 0, 0);

  const legCycle = Math.sin(strideCycle) * (1 - f * 0.45);
  rig.leftLeg.rotation.set(legCycle * 0.46 - 0.12, 0, 0.06);
  rig.rightLeg.rotation.set(-legCycle * 0.46 - 0.12, 0, -0.06);
  rig.leftShin.rotation.set(Math.max(0.2, -legCycle * 0.45 + 0.35), 0, 0);
  rig.rightShin.rotation.set(Math.max(0.2, legCycle * 0.45 + 0.35), 0, 0);

  plantRigFeetOnTurf(rig);
}

/**
 * Animates the Non-Striker at the bowler's end:
 * - Stands at `(-1.42, 1.12, 0)` facing diagonally inward toward the pitch corridor (never outward).
 * - Grounds the bat behind the popping crease (`Y = 1.22m`) during run-up, then takes a realistic
 *   backing-up stride down the pitch after the bowler releases the ball.
 */
export function animateNonStrikerSequence(
  rig: ArticulatedPlayerRig,
  playPhase: 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME',
  phaseProgress: number,
  ballPos?: CricketVec3,
): void {
  resetSubLimbs(rig);
  const basePos = CORE_ACTOR_POSITIONS.NON_STRIKER_STANCE;

  let curY = basePos.y;
  let focusTarget: CricketVec3 = NON_STRIKER_CORRIDOR_FOCUS;

  if (playPhase === 'RUNUP') {
    // Lean ready at popping crease, bat grounded behind Y = 1.22m
    curY = basePos.y + Math.max(0, phaseProgress - 0.75) * 0.35;
    focusTarget = NON_STRIKER_CORRIDOR_FOCUS;
  } else if (playPhase === 'LIVE_BALL' || playPhase === 'OUTCOME') {
    // Backing up 1.1m down the track watching the striker / live ball
    const backUpU = Math.min(1, phaseProgress * 1.8);
    curY = basePos.y + 0.08 + backUpU * 1.05;
    focusTarget = ballPos && ballPos.y > 4 ? ballPos : { x: 0, y: 16.5, z: 0 };
  }

  const curPos: CricketVec3 = { x: basePos.x, y: curY, z: 0 };
  const orientation = computeNonStrikerCanonicalOrientation(curPos, focusTarget);
  rig.setCricketTransform(curPos, orientation.yawCricket);

  // Alert athletic crouch with bat held in right hand grounded behind crease
  rig.torso.rotation.set(0.22, 0, 0);
  rig.headGroup.rotation.set(-0.12, 0, 0);
  rig.leftLeg.rotation.set(-0.24, 0, 0.12);
  rig.rightLeg.rotation.set(0.14, 0, -0.12);
  rig.leftShin.rotation.set(0.42, 0, 0);
  rig.rightShin.rotation.set(0.32, 0, 0);

  rig.leftArm.rotation.set(-0.42, 0.22, 0.24);
  rig.leftForearm.rotation.set(-0.72, 0, 0);
  rig.rightArm.rotation.set(0.28, 0.16, -0.28);
  rig.rightForearm.rotation.set(-0.18, 0, 0);

  if (rig.batPivot) {
    rig.batPivot.rotation.set(-0.22, 0.28, -0.36);
  }

  plantRigFeetOnTurf(rig);
}

/**
 * Animates the Wicketkeeper crouched behind the striker's stumps:
 * - Deep athletic squat during setup & run-up facing the striker's wicket (`-Y`).
 * - Rises with the ball's bounce and shuffles laterally to glove the ball if missed/left.
 */
export function animateWicketkeeperSequence(
  rig: ArticulatedPlayerRig,
  playPhase: 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME',
  ballPos?: CricketVec3,
  targetLineX = 0.06,
): void {
  resetSubLimbs(rig);
  const basePos = CORE_ACTOR_POSITIONS.WICKETKEEPER_NORMAL;

  let curX = basePos.x;
  let riseFactor = 0;

  if (playPhase === 'LIVE_BALL' && ballPos && ballPos.y > 10 && ballPos.y < 24) {
    // Shuffle laterally toward the post-bounce line of the delivery & rise with bounce height
    const trackWeight = Math.max(0, Math.min(1, (ballPos.y - 10) / 11));
    curX = basePos.x * (1 - trackWeight) + Math.max(-1.4, Math.min(1.4, ballPos.x)) * trackWeight;
    riseFactor = Math.max(0, Math.min(1, ballPos.z / 1.15)) * trackWeight;
  } else if (playPhase === 'SETUP' || playPhase === 'RUNUP') {
    curX = basePos.x + targetLineX * 0.35;
  }

  const curPos: CricketVec3 = { x: curX, y: basePos.y, z: 0 };
  const focusPoint: CricketVec3 =
    ballPos && playPhase === 'LIVE_BALL'
      ? { x: ballPos.x, y: Math.min(20.12, ballPos.y), z: 0 }
      : { x: 0, y: PITCH_CONSTANTS.STRIKER_STUMPS_Y, z: 0 };
  const facing = computeActorFacingTargetOrientation(curPos, focusPoint);
  rig.setCricketTransform(curPos, facing.yawCricket);

  // Deep keeping squat that rises smoothly as ball bounces toward waist/chest height
  const kneeBend = 0.96 - riseFactor * 0.52;
  rig.torso.rotation.set(0.46 - riseFactor * 0.24, 0, 0);
  rig.headGroup.rotation.set(-0.34 + riseFactor * 0.18, 0, 0);

  rig.leftLeg.rotation.set(-kneeBend * 0.58, 0, 0.24);
  rig.rightLeg.rotation.set(-kneeBend * 0.58, 0, -0.24);
  rig.leftShin.rotation.set(kneeBend, 0, 0);
  rig.rightShin.rotation.set(kneeBend, 0, 0);

  // Webbed keeping gloves presented side-by-side in front of shins/waist
  const glovePitch = -0.82 - riseFactor * 0.45;
  rig.leftArm.rotation.set(glovePitch, 0.24, 0.22);
  rig.rightArm.rotation.set(glovePitch, -0.24, -0.22);
  rig.leftForearm.rotation.set(-0.48, 0.15, 0);
  rig.rightForearm.rotation.set(-0.48, -0.15, 0);

  plantRigFeetOnTurf(rig);
}

/**
 * Animates the Pitch Umpire at the bowler's end (`Y = -1.35m`), facing `+Y` down the pitch,
 * including official match signals (`OUT` raised index finger, `FOUR` horizontal wave, `SIX` both hands high)
 * during the `OUTCOME` phase.
 */
export function animateUmpireSequence(
  rig: ArticulatedPlayerRig,
  playPhase: 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME',
  outcomeSignal: 'none' | 'out' | 'four' | 'six' = 'none',
  signalTimeSec = 0,
): void {
  resetSubLimbs(rig);
  const pos = CORE_ACTOR_POSITIONS.UMPIRE_STANDING;
  const facing = computeActorFacingTargetOrientation(pos, {
    x: 0,
    y: PITCH_CONSTANTS.STRIKER_STUMPS_Y,
  });
  rig.setCricketTransform(pos, facing.yawCricket);

  rig.leftLeg.rotation.set(-0.06, 0, 0.06);
  rig.rightLeg.rotation.set(-0.06, 0, -0.06);
  rig.leftShin.rotation.set(0.12, 0, 0);
  rig.rightShin.rotation.set(0.12, 0, 0);

  if (playPhase === 'OUTCOME' && outcomeSignal === 'out') {
    // Classic Umpire OUT signal: right arm raised straight above shoulder
    rig.torso.rotation.set(0.04, 0, 0);
    rig.rightArm.rotation.set(-2.85, 0, -0.08);
    rig.rightForearm.rotation.set(-0.18, 0, 0);
    rig.leftArm.rotation.set(0.12, 0, 0.12);
    rig.leftForearm.rotation.set(-0.35, 0, 0);
  } else if (playPhase === 'OUTCOME' && outcomeSignal === 'six') {
    // SIX signal: both arms raised triumphantly above head
    rig.torso.rotation.set(-0.04, 0, 0);
    rig.leftArm.rotation.set(-2.78, 0, 0.22);
    rig.rightArm.rotation.set(-2.78, 0, -0.22);
    rig.leftForearm.rotation.set(-0.15, 0, 0);
    rig.rightForearm.rotation.set(-0.15, 0, 0);
  } else if (playPhase === 'OUTCOME' && outcomeSignal === 'four') {
    // FOUR signal: right arm waving horizontally across chest
    const wave = Math.sin(signalTimeSec * 5.5) * 0.65;
    rig.rightArm.rotation.set(-1.35, wave, -0.45);
    rig.rightForearm.rotation.set(-0.35, 0, 0);
    rig.leftArm.rotation.set(0.12, 0, 0.12);
  } else {
    // Alert official posture watching crease and line
    const lean = playPhase === 'LIVE_BALL' ? 0.16 : 0.08;
    rig.torso.rotation.set(lean, 0, 0);
    rig.headGroup.rotation.set(-lean * 0.6, 0, 0);
    rig.leftArm.rotation.set(0.14, 0.18, 0.12);
    rig.rightArm.rotation.set(0.14, -0.18, -0.12);
    rig.leftForearm.rotation.set(-0.45, 0.35, 0);
    rig.rightForearm.rotation.set(-0.45, -0.35, 0);
  }

  plantRigFeetOnTurf(rig);
}

/**
 * Animates an on-field AI Fielder:
 * - Pre-contact: Faces the Striker (`STRIKER_STANCE`), performing an athletic split-step crouch as the bowler delivers.
 * - Post-contact: Rotates smoothly to face and track the live ball position.
 */
export function animateFielderPosture(
  rig: ArticulatedPlayerRig,
  currentPos: CricketVec3,
  playPhase: 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME',
  runupProgress: number,
  ballPos?: CricketVec3,
  hasBatContactOccurred = false,
): void {
  resetSubLimbs(rig);

  const focusTarget: CricketVec3 =
    hasBatContactOccurred && ballPos
      ? ballPos
      : CORE_ACTOR_POSITIONS.STRIKER_STANCE;

  const facing = computeActorFacingTargetOrientation(currentPos, focusTarget);
  rig.setCricketTransform(currentPos, facing.yawCricket);

  // Split-step anticipation crouch peaks as bowler releases the ball
  const splitCrouch =
    playPhase === 'RUNUP'
      ? Math.sin(Math.min(1, runupProgress) * Math.PI) * 0.22
      : playPhase === 'LIVE_BALL'
        ? 0.2
        : 0.08;

  rig.torso.rotation.set(0.24 + splitCrouch * 0.45, 0, 0);
  rig.headGroup.rotation.set(-0.18 - splitCrouch * 0.3, 0, 0);

  const kneeFlex = 0.36 + splitCrouch * 0.85;
  rig.leftLeg.rotation.set(-kneeFlex * 0.55, 0, 0.16);
  rig.rightLeg.rotation.set(-kneeFlex * 0.55, 0, -0.16);
  rig.leftShin.rotation.set(kneeFlex, 0, 0);
  rig.rightShin.rotation.set(kneeFlex, 0, 0);

  rig.leftArm.rotation.set(-0.38 - splitCrouch * 0.5, 0.15, 0.22);
  rig.rightArm.rotation.set(-0.38 - splitCrouch * 0.5, -0.15, -0.22);
  rig.leftForearm.rotation.set(-0.55, 0, 0);
  rig.rightForearm.rotation.set(-0.55, 0, 0);

  plantRigFeetOnTurf(rig);
}
