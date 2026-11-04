/**
 * CREASE CLASH — Canonical Character Orientation & Full Articulated Cricket Animation Controller
 *
 * Implements:
 * 1. Canonical Character Orientation (`-Z_rig` = forward `+Y_cricket` at `rotation.y = 0`).
 * 2. Zero-stacked-yaw Side-On Batting Stances for both Right-Handed (`RHB`) and Left-Handed (`LHB`) batters,
 *    with verified chest, front-shoulder, back-shoulder, and head-tracking vectors.
 * 3. Calculated diagonal facing direction for the Non-Striker toward the active pitch corridor,
 *    plus synchronized backing-up stride at bowler release.
 * 4. Complete recognizable cricket animations:
 *    - Batting: Stance, Trigger Press, High Backlift Coil, Drives, Cuts, Pulls/Hooks, Flicks/Glances,
 *      Sweeps/Reverse Sweeps, Ramps/Scoops, Defensive Blocks, Leaves.
 *    - Running Between Wickets: Sprint, Crease Turn, Bat Grounding Slide, Full-Length Dive.
 *    - Bowling: Top-of-mark Idle, Accelerating Run-Up, Gather Bound Leap, Braced Front-Leg Release, Follow-Through.
 *    - Wicketkeeping: Squat Setup, Rise with Bounce, Lateral Dive, Stumping Whip.
 *    - Fielding: Split-Step Ready, Pursuit Sprint, High/Chest/Low/Slip/Running/Diving/One-Hand Catches,
 *      Sliding Boundary Stop, Ground Pickup, Overarm & Underarm Throws, Celebration.
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

export type FielderActionAnimState =
  | 'ready'
  | 'sprinting'
  | 'catch_high'
  | 'catch_chest'
  | 'catch_low'
  | 'catch_slip'
  | 'catch_running'
  | 'catch_dive'
  | 'catch_one_hand'
  | 'pickup_ground'
  | 'slide_stop'
  | 'throw_overarm'
  | 'throw_underarm'
  | 'celebrate';

export type BatterRunningAnimState =
  | 'stance'
  | 'backing_up'
  | 'sprinting'
  | 'turning'
  | 'sliding_bat'
  | 'diving_bat';

export type WicketkeeperActionAnimState =
  | 'crouch'
  | 'rising_take'
  | 'dive_left'
  | 'dive_right'
  | 'stumping_whip';

export interface ArticulatedPlayerRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  headGroup: THREE.Group;
  /** Upper arm group at shoulder */
  leftArm: THREE.Group;
  /** Upper arm group at shoulder */
  rightArm: THREE.Group;
  /** Forearm group at elbow */
  leftForearm: THREE.Group;
  /** Forearm group at elbow */
  rightForearm: THREE.Group;
  /** Thigh group at hip */
  leftLeg: THREE.Group;
  /** Thigh group at hip */
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
 * and adjusts `rig.hips.position.y` so the lowest foot rests squarely on the turf (local y = 0).
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
    return Math.max(0.26, thighVertical + shinVertical + bootSoleDepth - hipJointOffsetY);
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

  const maxDrop = Math.max(leftDrop, rightDrop);
  rig.hips.position.y = maxDrop + extraLiftLocalY;
}

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

  const breathTap = Math.sin(breathPhase) * 0.035;
  rig.hips.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0.24 + breathTap * 0.15, 0, -0.05 * handSign);

  // Head turned over front shoulder to face the bowler squarely
  rig.headGroup.rotation.set(-0.15, orientation.headLocalThreeRotationY, 0);

  // Athletic balanced knee bend in both legs, feet shoulder-width apart parallel to crease
  rig.leftLeg.rotation.set(-0.26, 0, 0.13);
  rig.rightLeg.rotation.set(-0.26, 0, -0.13);
  rig.leftShin.rotation.set(0.45, 0, 0);
  rig.rightShin.rotation.set(0.45, 0, 0);
  rig.leftAnkle.rotation.set(-0.19, 0, 0);
  rig.rightAnkle.rotation.set(-0.19, 0, 0);

  // Two-handed grip bringing both hands together in front of the front thigh on the bat handle
  if (handedness === 'RHB') {
    rig.rightArm.rotation.set(-0.44, -0.35, -0.28);
    rig.rightForearm.rotation.set(-0.7 + breathTap, -0.15, -0.12);
    rig.leftArm.rotation.set(-0.5, 0.39, 0.32);
    rig.leftForearm.rotation.set(-0.74 + breathTap, 0.18, 0.14);
  } else {
    rig.leftArm.rotation.set(-0.44, 0.35, 0.28);
    rig.leftForearm.rotation.set(-0.7 + breathTap, 0.15, 0.12);
    rig.rightArm.rotation.set(-0.5, -0.39, -0.32);
    rig.rightForearm.rotation.set(-0.74 + breathTap, -0.18, -0.14);
  }

  if (rig.batPivot) {
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
 * Animates a Batter (Striker or Non-Striker) during active running between wickets:
 * - `sprinting`: High-tempo athletic sprint down the pitch carrying the bat across the body.
 * - `turning`: Sharp low-center-of-gravity pivot at the crease for a 2nd/3rd run.
 * - `sliding_bat`: Extended lunge reaching the bat handle and blade flat across the popping crease.
 * - `diving_bat`: Full-length airborne/sliding dive stretching the bat forward into safe ground.
 */
export function animateBatterRunningSequence(
  rig: ArticulatedPlayerRig,
  position: CricketVec3,
  targetCreasePos: CricketVec3,
  animState: BatterRunningAnimState,
  stridePhaseRad: number,
  handedness: BatterHandedness = 'RHB',
): void {
  resetSubLimbs(rig);
  const handSign = handedness === 'LHB' ? -1 : 1;
  const facing = computeActorFacingTargetOrientation(position, targetCreasePos);
  rig.setCricketTransform(position, facing.yawCricket);

  if (animState === 'diving_bat') {
    // Full-length desperate dive parallel to the turf with bat stretched straight ahead (-Z_rig)
    rig.torso.rotation.set(1.28, 0, 0);
    rig.headGroup.rotation.set(-0.55, 0, 0);
    rig.leftLeg.rotation.set(0.55, 0, 0.08);
    rig.rightLeg.rotation.set(0.42, 0, -0.08);
    rig.leftShin.rotation.set(0.22, 0, 0);
    rig.rightShin.rotation.set(0.35, 0, 0);

    // Reaching arm stretches bat far forward along -Z_rig
    rig.rightArm.rotation.set(-2.55, 0, -0.08);
    rig.rightForearm.rotation.set(-0.12, 0, 0);
    rig.leftArm.rotation.set(-1.15, 0.3, 0.25);
    rig.leftForearm.rotation.set(-0.65, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(-1.35, 0, 0);
    }
    rig.hips.position.y = 0.34;
    return;
  }

  if (animState === 'sliding_bat') {
    // Deep lunging stride sliding the bat blade across the turf past the popping crease
    rig.torso.rotation.set(0.68, -0.18 * handSign, 0);
    rig.headGroup.rotation.set(-0.35, 0, 0);
    rig.leftLeg.rotation.set(-0.82, 0, 0.08);
    rig.leftShin.rotation.set(0.95, 0, 0);
    rig.rightLeg.rotation.set(0.58, 0, -0.08);
    rig.rightShin.rotation.set(0.32, 0, 0);

    rig.rightArm.rotation.set(-1.42, -0.1, -0.12);
    rig.rightForearm.rotation.set(-0.18, 0, 0);
    rig.leftArm.rotation.set(0.35, 0.2, 0.22);
    rig.leftForearm.rotation.set(-0.75, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(-0.88, 0, -0.15 * handSign);
    }
    plantRigFeetOnTurf(rig, -0.06);
    return;
  }

  if (animState === 'turning') {
    // Low squat deceleration & sharp turn at crease
    rig.torso.rotation.set(0.46, 0.35 * handSign, -0.15 * handSign);
    rig.headGroup.rotation.set(-0.25, 0.4 * handSign, 0);
    rig.leftLeg.rotation.set(-0.62, 0, 0.22);
    rig.rightLeg.rotation.set(-0.52, 0, -0.22);
    rig.leftShin.rotation.set(0.95, 0, 0);
    rig.rightShin.rotation.set(0.85, 0, 0);
    rig.rightArm.rotation.set(-0.65, -0.2, -0.25);
    rig.rightForearm.rotation.set(-0.55, 0, 0);
    rig.leftArm.rotation.set(-0.45, 0.25, 0.25);
    rig.leftForearm.rotation.set(-0.65, 0, 0);
    if (rig.batPivot) {
      rig.batPivot.rotation.set(-0.45, 0.2, -0.35);
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  // Full sprint between wickets with pumping arms and knees
  const s = Math.sin(stridePhaseRad);
  const c = Math.cos(stridePhaseRad);
  rig.torso.rotation.set(0.34, c * 0.22, 0);
  rig.headGroup.rotation.set(-0.22, -c * 0.14, 0);

  rig.leftLeg.rotation.set(s * 0.78 - 0.14, 0, 0.05);
  rig.rightLeg.rotation.set(-s * 0.78 - 0.14, 0, -0.05);
  rig.leftShin.rotation.set(Math.max(0.18, -s * 0.85 + 0.48), 0, 0);
  rig.rightShin.rotation.set(Math.max(0.18, s * 0.85 + 0.48), 0, 0);

  rig.leftArm.rotation.set(-s * 0.68 - 0.28, 0.18, 0.16);
  rig.leftForearm.rotation.set(-1.05, 0, 0);
  rig.rightArm.rotation.set(s * 0.58 - 0.35, -0.18, -0.18);
  rig.rightForearm.rotation.set(-0.88, 0, 0);

  if (rig.batPivot) {
    rig.batPivot.rotation.set(0.35 + s * 0.22, 0.18, -0.45);
  }

  plantRigFeetOnTurf(rig, Math.abs(s) * 0.04);
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

  // Leave animation: withdraw bat high above shoulder while watching ball into keeper's gloves
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

  // Pre-swing anticipation & high backlift coil during bowler run-up / early flight
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

    if (coil > 0.05 && rig.batPivot) {
      rig.rightForearm.rotation.x -= coil * 0.35;
      rig.leftForearm.rotation.x -= coil * 0.35;
      rig.batPivot.rotation.x += coil * 0.42;
    }
    plantRigFeetOnTurf(rig);
    return;
  }

  // Active Downswing, Impact & Balanced Follow-Through (u in [0, 1])
  const u = Math.max(0, Math.min(1, swingProgress));
  const easeU = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  const swingArc = Math.sin(easeU * Math.PI * 0.9);
  const isLoft = shotSpec.shotIntent === 'loft';
  const family = shotSpec.swingFamily;
  const dirYaw = Math.max(-1.05, Math.min(1.05, (shotSpec.relativeAngleDeg / 75) * 0.6)) * handSign;

  const strideSplitZ = 0.44 * handSign;

  if (family === 'defensive_push') {
    const isBack = footwork === 'back_foot';
    rig.leftLeg.rotation.set(-0.28, 0, isBack ? 0.12 : -strideSplitZ * 0.7);
    rig.rightLeg.rotation.set(-0.34, 0, isBack ? -0.18 : strideSplitZ * 0.85);
    rig.leftShin.rotation.set(isBack ? 0.38 : 0.25, 0, 0);
    rig.rightShin.rotation.set(isBack ? 0.46 : 0.62, 0, 0);

    const rootTurnYaw = baseOrientation.rootYawCricket + easeU * 0.18 * handSign;
    rig.setCricketTransform(currentStancePos, rootTurnYaw);
    rig.torso.rotation.set(0.32, 0.12 * handSign, -0.14 * handSign);
    rig.headGroup.rotation.set(
      -0.26,
      baseOrientation.headLocalThreeRotationY - easeU * 0.14 * handSign,
      0,
    );

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
    rig.torso.rotation.set(
      isUppercut ? -0.16 : 0.35 - easeU * 0.42,
      dirYaw * 0.3,
      -0.12 * handSign,
    );
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
    rig.leftLeg.rotation.set(-0.28, 0, 0.2);
    rig.rightLeg.rotation.set(-0.32, 0, -0.2);
    rig.leftShin.rotation.set(0.48, 0, 0);
    rig.rightShin.rotation.set(0.38, 0, 0);

    const pullRootYaw = baseOrientation.rootYawCricket + easeU * 1.15 * handSign;
    rig.setCricketTransform(currentStancePos, pullRootYaw);
    rig.torso.rotation.set(0.08 - easeU * 0.16, easeU * 0.55 * handSign, 0.14 * handSign);
    rig.headGroup.rotation.set(
      -0.1,
      baseOrientation.headLocalThreeRotationY * (1 - easeU * 0.65),
      0,
    );

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

  // Classical vertical_drive & on_side_flick
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
      rig.torso.rotation.set(0.26, Math.cos(strideCycle) * 0.18, 0);
      rig.headGroup.rotation.set(-0.14, -Math.cos(strideCycle) * 0.12, 0);
      rig.leftArm.rotation.set(-leftSwing * 0.62 - 0.25, 0, 0.14);
      rig.rightArm.rotation.set(-rightSwing * 0.62 - 0.25, 0, -0.14);
      rig.leftForearm.rotation.set(-1.05, 0, 0);
      rig.rightForearm.rotation.set(-1.05, 0, 0);
    } else {
      const coilU = (u - 0.72) / 0.28;
      rig.torso.rotation.set(0.14 + coilU * 0.38, -0.62 + coilU * 0.92, -0.12 * coilU);
      rig.headGroup.rotation.set(-0.12 - coilU * 0.15, 0.45 * (1 - coilU), 0);

      rig.leftArm.rotation.set(-2.65 + coilU * 2.25, 0.15, 0.22);
      rig.leftForearm.rotation.set(-0.35 - coilU * 0.65, 0, 0);

      rig.rightArm.rotation.set(1.15 - coilU * 4.25, 0, -0.1);
      rig.rightForearm.rotation.set(-0.08 * (1 - coilU), 0, 0);

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
 * Animates the Non-Striker at the bowler's end, or delegates to `animateBatterRunningSequence`
 * when active running between wickets is in progress.
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
    curY = basePos.y + Math.max(0, phaseProgress - 0.75) * 0.35;
    focusTarget = NON_STRIKER_CORRIDOR_FOCUS;
  } else if (playPhase === 'LIVE_BALL' || playPhase === 'OUTCOME') {
    const backUpU = Math.min(1, phaseProgress * 1.8);
    curY = basePos.y + 0.08 + backUpU * 1.05;
    focusTarget = ballPos && ballPos.y > 4 ? ballPos : { x: 0, y: 16.5, z: 0 };
  }

  const curPos: CricketVec3 = { x: basePos.x, y: curY, z: 0 };
  const orientation = computeNonStrikerCanonicalOrientation(curPos, focusTarget);
  rig.setCricketTransform(curPos, orientation.yawCricket);

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
 * Animates the Wicketkeeper crouched behind the striker's stumps, including lateral dives,
 * rising takes, and rapid stumping bails-whip actions.
 */
export function animateWicketkeeperSequence(
  rig: ArticulatedPlayerRig,
  playPhase: 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME',
  ballPos?: CricketVec3,
  targetLineX = 0.06,
  actionOverride?: WicketkeeperActionAnimState,
  overridePos?: CricketVec3,
): void {
  resetSubLimbs(rig);
  const basePos = overridePos ?? CORE_ACTOR_POSITIONS.WICKETKEEPER_NORMAL;

  let curX = basePos.x;
  let curY = basePos.y;
  let riseFactor = 0;

  if (actionOverride === 'stumping_whip') {
    curX = 0.18;
    curY = PITCH_CONSTANTS.STRIKER_STUMPS_Y + 0.42;
    const facing = computeActorFacingTargetOrientation(
      { x: curX, y: curY },
      { x: 0, y: PITCH_CONSTANTS.STRIKER_STUMPS_Y },
    );
    rig.setCricketTransform({ x: curX, y: curY, z: 0 }, facing.yawCricket);
    rig.torso.rotation.set(0.55, 0.28, 0);
    rig.leftLeg.rotation.set(-0.55, 0, 0.2);
    rig.rightLeg.rotation.set(-0.45, 0, -0.2);
    rig.leftShin.rotation.set(0.75, 0, 0);
    rig.rightShin.rotation.set(0.65, 0, 0);
    // Extending both keeping gloves forward into the bails
    rig.leftArm.rotation.set(-1.45, 0.15, 0.12);
    rig.rightArm.rotation.set(-1.45, -0.15, -0.12);
    rig.leftForearm.rotation.set(-0.2, 0, 0);
    rig.rightForearm.rotation.set(-0.2, 0, 0);
    plantRigFeetOnTurf(rig);
    return;
  }

  if (actionOverride === 'dive_left' || actionOverride === 'dive_right') {
    const dir = actionOverride === 'dive_right' ? 1 : -1;
    const facing = computeActorFacingTargetOrientation(
      { x: curX, y: curY },
      { x: 0, y: PITCH_CONSTANTS.STRIKER_STUMPS_Y },
    );
    rig.setCricketTransform({ x: curX, y: curY, z: 0.15 }, facing.yawCricket);
    rig.hips.rotation.z = -0.95 * dir;
    rig.torso.rotation.set(0.25, 0.25 * dir, -0.25 * dir);
    rig.leftArm.rotation.set(-2.35, 0.25, 0.25);
    rig.rightArm.rotation.set(-2.35, -0.25, -0.25);
    rig.hips.position.y = 0.42;
    return;
  }

  if (playPhase === 'LIVE_BALL' && ballPos && ballPos.y > 10 && ballPos.y < 24) {
    const trackWeight = Math.max(0, Math.min(1, (ballPos.y - 10) / 11));
    curX = basePos.x * (1 - trackWeight) + Math.max(-1.6, Math.min(1.6, ballPos.x)) * trackWeight;
    riseFactor = Math.max(0, Math.min(1, ballPos.z / 1.15)) * trackWeight;
  } else if (playPhase === 'SETUP' || playPhase === 'RUNUP') {
    curX = basePos.x + targetLineX * 0.35;
  }

  const curPos: CricketVec3 = { x: curX, y: curY, z: 0 };
  const focusPoint: CricketVec3 =
    ballPos && playPhase === 'LIVE_BALL'
      ? { x: ballPos.x, y: Math.min(20.12, ballPos.y), z: 0 }
      : { x: 0, y: PITCH_CONSTANTS.STRIKER_STUMPS_Y, z: 0 };
  const facing = computeActorFacingTargetOrientation(curPos, focusPoint);
  rig.setCricketTransform(curPos, facing.yawCricket);

  const kneeBend = 0.96 - riseFactor * 0.52;
  rig.torso.rotation.set(0.46 - riseFactor * 0.24, 0, 0);
  rig.headGroup.rotation.set(-0.34 + riseFactor * 0.18, 0, 0);

  rig.leftLeg.rotation.set(-kneeBend * 0.58, 0, 0.24);
  rig.rightLeg.rotation.set(-kneeBend * 0.58, 0, -0.24);
  rig.leftShin.rotation.set(kneeBend, 0, 0);
  rig.rightShin.rotation.set(kneeBend, 0, 0);

  const glovePitch = -0.82 - riseFactor * 0.45;
  rig.leftArm.rotation.set(glovePitch, 0.24, 0.22);
  rig.rightArm.rotation.set(glovePitch, -0.24, -0.22);
  rig.leftForearm.rotation.set(-0.48, 0.15, 0);
  rig.rightForearm.rotation.set(-0.48, -0.15, 0);

  plantRigFeetOnTurf(rig);
}

/**
 * Animates the Pitch Umpire at the bowler's end (`Y = -1.35m`), facing `+Y` down the pitch,
 * including official match signals (`OUT`, `FOUR`, `SIX`, `WIDE`, `NO_BALL`).
 */
export function animateUmpireSequence(
  rig: ArticulatedPlayerRig,
  playPhase: 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME',
  outcomeSignal: 'none' | 'out' | 'four' | 'six' | 'wide' | 'no_ball' = 'none',
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
    rig.torso.rotation.set(0.04, 0, 0);
    rig.rightArm.rotation.set(-2.85, 0, -0.08);
    rig.rightForearm.rotation.set(-0.18, 0, 0);
    rig.leftArm.rotation.set(0.12, 0, 0.12);
    rig.leftForearm.rotation.set(-0.35, 0, 0);
  } else if (playPhase === 'OUTCOME' && outcomeSignal === 'six') {
    rig.torso.rotation.set(-0.04, 0, 0);
    rig.leftArm.rotation.set(-2.78, 0, 0.22);
    rig.rightArm.rotation.set(-2.78, 0, -0.22);
    rig.leftForearm.rotation.set(-0.15, 0, 0);
    rig.rightForearm.rotation.set(-0.15, 0, 0);
  } else if (playPhase === 'OUTCOME' && outcomeSignal === 'four') {
    const wave = Math.sin(signalTimeSec * 5.5) * 0.65;
    rig.rightArm.rotation.set(-1.35, wave, -0.45);
    rig.rightForearm.rotation.set(-0.35, 0, 0);
    rig.leftArm.rotation.set(0.12, 0, 0.12);
  } else if (playPhase === 'OUTCOME' && outcomeSignal === 'wide') {
    // Both arms extended horizontally out to the sides
    rig.leftArm.rotation.set(0, 0, 1.52);
    rig.rightArm.rotation.set(0, 0, -1.52);
  } else if (playPhase === 'OUTCOME' && outcomeSignal === 'no_ball') {
    // Right arm extended horizontally at shoulder height
    rig.rightArm.rotation.set(0, 0, -1.52);
    rig.leftArm.rotation.set(0.12, 0, 0.12);
  } else {
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
 * Animates an on-field AI Fielder across all fielding, catching, diving, sliding, and throwing actions:
 * - Pre-contact: Faces the Striker (`STRIKER_STANCE`), performing an athletic split-step crouch.
 * - Post-contact: Sprints toward intercept, executes distinct 3D catch/stop/pickup/throw postures.
 */
export function animateFielderPosture(
  rig: ArticulatedPlayerRig,
  currentPos: CricketVec3,
  playPhase: 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME',
  runupProgress: number,
  ballPos?: CricketVec3,
  hasBatContactOccurred = false,
  actionState: FielderActionAnimState = 'ready',
  actionProgress = 0,
  throwTargetPos?: CricketVec3,
): void {
  resetSubLimbs(rig);

  const focusTarget: CricketVec3 =
    (actionState === 'throw_overarm' || actionState === 'throw_underarm') && throwTargetPos
      ? throwTargetPos
      : hasBatContactOccurred && ballPos
        ? ballPos
        : CORE_ACTOR_POSITIONS.STRIKER_STANCE;

  const facing = computeActorFacingTargetOrientation(currentPos, focusTarget);
  rig.setCricketTransform(currentPos, facing.yawCricket);

  if (actionState === 'sprinting') {
    const stride = actionProgress * Math.PI * 8;
    const s = Math.sin(stride);
    rig.torso.rotation.set(0.36, Math.cos(stride) * 0.22, 0);
    rig.headGroup.rotation.set(-0.22, 0, 0);
    rig.leftLeg.rotation.set(s * 0.72 - 0.12, 0, 0.05);
    rig.rightLeg.rotation.set(-s * 0.72 - 0.12, 0, -0.05);
    rig.leftShin.rotation.set(Math.max(0.18, -s * 0.8 + 0.45), 0, 0);
    rig.rightShin.rotation.set(Math.max(0.18, s * 0.8 + 0.45), 0, 0);
    rig.leftArm.rotation.set(-s * 0.65 - 0.25, 0, 0.15);
    rig.rightArm.rotation.set(s * 0.65 - 0.25, 0, -0.15);
    rig.leftForearm.rotation.set(-0.98, 0, 0);
    rig.rightForearm.rotation.set(-0.98, 0, 0);
    plantRigFeetOnTurf(rig, Math.abs(s) * 0.03);
    return;
  }

  if (actionState === 'catch_high' || actionState === 'catch_running') {
    // Reverse-cup high catch above forehead
    rig.torso.rotation.set(-0.14, 0, 0);
    rig.headGroup.rotation.set(0.38, 0, 0);
    rig.leftLeg.rotation.set(-0.25, 0, 0.14);
    rig.rightLeg.rotation.set(-0.25, 0, -0.14);
    rig.leftShin.rotation.set(0.45, 0, 0);
    rig.rightShin.rotation.set(0.45, 0, 0);
    rig.leftArm.rotation.set(-2.35, 0.22, 0.15);
    rig.rightArm.rotation.set(-2.35, -0.22, -0.15);
    rig.leftForearm.rotation.set(-0.42, 0.2, 0);
    rig.rightForearm.rotation.set(-0.42, -0.2, 0);
    plantRigFeetOnTurf(rig, 0.06);
    return;
  }

  if (actionState === 'catch_chest') {
    // Orthodox Australian/English cup at chest height
    rig.torso.rotation.set(0.16, 0, 0);
    rig.leftLeg.rotation.set(-0.32, 0, 0.16);
    rig.rightLeg.rotation.set(-0.32, 0, -0.16);
    rig.leftShin.rotation.set(0.55, 0, 0);
    rig.rightShin.rotation.set(0.55, 0, 0);
    rig.leftArm.rotation.set(-1.15, 0.28, 0.18);
    rig.rightArm.rotation.set(-1.15, -0.28, -0.18);
    rig.leftForearm.rotation.set(-0.78, 0.25, 0);
    rig.rightForearm.rotation.set(-0.78, -0.25, 0);
    plantRigFeetOnTurf(rig);
    return;
  }

  if (actionState === 'catch_low' || actionState === 'catch_slip' || actionState === 'pickup_ground') {
    // Deep lunge scooping fingers right above the grass blades
    rig.torso.rotation.set(0.68, 0, 0);
    rig.headGroup.rotation.set(-0.42, 0, 0);
    rig.leftLeg.rotation.set(-0.78, 0, 0.2);
    rig.rightLeg.rotation.set(-0.58, 0, -0.2);
    rig.leftShin.rotation.set(1.12, 0, 0);
    rig.rightShin.rotation.set(0.85, 0, 0);
    rig.leftArm.rotation.set(-0.92, 0.22, 0.14);
    rig.rightArm.rotation.set(-0.92, -0.22, -0.14);
    rig.leftForearm.rotation.set(-0.22, 0.18, 0);
    rig.rightForearm.rotation.set(-0.22, -0.18, 0);
    plantRigFeetOnTurf(rig, -0.06);
    return;
  }

  if (actionState === 'catch_dive' || actionState === 'slide_stop') {
    // Full-stretch lateral airborne dive / sliding boundary stop
    rig.hips.rotation.z = -1.08;
    rig.torso.rotation.set(0.18, 0.25, -0.22);
    rig.leftLeg.rotation.set(0.32, 0, 0.12);
    rig.rightLeg.rotation.set(-0.45, 0, -0.18);
    rig.leftShin.rotation.set(0.28, 0, 0);
    rig.rightShin.rotation.set(0.65, 0, 0);
    rig.rightArm.rotation.set(-2.55, -0.15, -0.2);
    rig.leftArm.rotation.set(-2.15, 0.25, 0.25);
    rig.hips.position.y = 0.36;
    return;
  }

  if (actionState === 'catch_one_hand') {
    // Leaping one-handed pluck high to the right
    rig.torso.rotation.set(-0.12, -0.25, -0.28);
    rig.rightArm.rotation.set(-2.78, -0.15, -0.35);
    rig.rightForearm.rotation.set(-0.1, 0, 0);
    rig.leftArm.rotation.set(-0.55, 0.25, 0.45);
    rig.leftLeg.rotation.set(-0.35, 0, 0.15);
    rig.rightLeg.rotation.set(0.25, 0, -0.15);
    rig.leftShin.rotation.set(0.55, 0, 0);
    rig.rightShin.rotation.set(0.35, 0, 0);
    plantRigFeetOnTurf(rig, 0.18);
    return;
  }

  if (actionState === 'throw_overarm') {
    const u = Math.max(0, Math.min(1, actionProgress));
    rig.torso.rotation.set(0.15 + u * 0.35, -0.65 + u * 1.15, 0);
    rig.leftLeg.rotation.set(-0.42, 0, 0.12);
    rig.rightLeg.rotation.set(0.35, 0, -0.12);
    rig.leftShin.rotation.set(0.28, 0, 0);
    rig.rightShin.rotation.set(0.52, 0, 0);
    rig.leftArm.rotation.set(-1.35 + u * 0.95, 0.2, 0.25);
    rig.rightArm.rotation.set(-2.45 + (u - 0.5) * 2.2, 0, -0.22);
    rig.rightForearm.rotation.set(-0.45 * (1 - u), 0, 0);
    plantRigFeetOnTurf(rig);
    return;
  }

  if (actionState === 'throw_underarm') {
    const u = Math.max(0, Math.min(1, actionProgress));
    rig.torso.rotation.set(0.52, -0.35 + u * 0.75, 0);
    rig.leftLeg.rotation.set(-0.55, 0, 0.18);
    rig.rightLeg.rotation.set(0.28, 0, -0.18);
    rig.leftShin.rotation.set(0.68, 0, 0);
    rig.rightShin.rotation.set(0.45, 0, 0);
    rig.rightArm.rotation.set(0.65 - u * 1.85, 0, -0.18);
    rig.rightForearm.rotation.set(-0.25, 0, 0);
    plantRigFeetOnTurf(rig);
    return;
  }

  if (actionState === 'celebrate') {
    // Both arms raised high in wicket celebration
    rig.torso.rotation.set(-0.1, 0, 0);
    rig.leftArm.rotation.set(-2.65, 0.18, 0.32);
    rig.rightArm.rotation.set(-2.65, -0.18, -0.32);
    rig.leftForearm.rotation.set(-0.25, 0, 0);
    rig.rightForearm.rotation.set(-0.25, 0, 0);
    rig.leftLeg.rotation.set(-0.18, 0, 0.12);
    rig.rightLeg.rotation.set(-0.18, 0, -0.12);
    rig.leftShin.rotation.set(0.32, 0, 0);
    rig.rightShin.rotation.set(0.32, 0, 0);
    plantRigFeetOnTurf(rig, 0.05);
    return;
  }

  // Default: Ready stance with split-step anticipation crouch
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
