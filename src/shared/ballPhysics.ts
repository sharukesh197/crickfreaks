/**
 * CREASE CLASH — Authoritative 9-Phase Deterministic Cricket Ball Physics Engine
 *
 * Pure TypeScript simulation module (zero UI or renderer dependencies).
 * Operates in authoritative Cricket World Coordinates (X, Y, Z):
 * - X: Lateral across pitch (-X leg side, +X off side for RHB)
 * - Y: Longitudinal down pitch (0.00m bowler wicket -> 20.12m striker wicket)
 * - Z: Height above ground (meters)
 *
 * Enforces adaptive continuous collision detection with >= 20 micro-substeps per 1/120s
 * step at up to 150 km/h (41.67 m/s) to guarantee zero bat-ball or ball-stump tunneling.
 */

import { CricketVec3 } from './coordinates';
import {
  BALL_CONSTANTS,
  BoundaryConfig,
  DEFAULT_BOUNDARY_CONFIG,
  isBeyondBoundary,
  PITCH_CONSTANTS,
  WICKET_CONSTANTS,
} from './constants';
import {
  BAT_BLADE_DIMENSIONS,
  BatCollisionResult,
  BattingIntentInput,
  checkBatBallSubstepCollision,
  classifyTimingRating,
  ContactQualityCategory,
  FootworkType,
  getFootworkContactPlaneY,
  resolveIntendedShot,
  ShotFamilyId,
  ShotIntent,
  SwingPlaneFamily,
  TimingRating,
} from './batCollision';
import {
  DELIVERY_LIBRARY,
  DeliveryArchetypeSpec,
  DeliveryCategory,
  getDeliverySpec,
  MovementVariant,
  PACE_DELIVERY_VARIANTS,
  resolveBowlerReleaseExecution,
  SPIN_DELIVERY_VARIANTS,
} from './deliveries';

export {
  DELIVERY_LIBRARY,
  getDeliverySpec,
  PACE_DELIVERY_VARIANTS,
  resolveBowlerReleaseExecution,
  SPIN_DELIVERY_VARIANTS,
};
export type { DeliveryArchetypeSpec, DeliveryCategory, MovementVariant };

export type BallLifecyclePhase =
  | 'BOWLER_RELEASE'
  | 'PRE_BOUNCE_FLIGHT'
  | 'PITCH_IMPACT'
  | 'BOUNCE_RESPONSE'
  | 'POST_BOUNCE_FLIGHT'
  | 'BAT_CONTACT_OR_MISS'
  | 'POST_CONTACT_FLIGHT_OR_ROLL'
  | 'FIELDING_OR_WICKET_RESOLUTION'
  | 'DEAD_BALL';

export type DeliveryMovementType = MovementVariant;

export interface BowlingDeliverySetup {
  /** Release speed in km/h (e.g., 76 km/h spin up to 150 km/h express pace) */
  speedKmh: number;
  /** Target pitch landing X in meters (-0.45m leg to +0.55m wide off) */
  targetLineX: number;
  /** Target pitch landing Y in meters (7.5m short bouncer to 18.4m yorker) */
  targetLengthY: number;
  /** Aerodynamic swing / seam / spin movement type */
  movementType: MovementVariant;
  /** Release lateral X position at bowling crease (default -0.36m over the wicket) */
  releaseX?: number;
  /** Optional bowler release execution accuracy in [0..1] (default 1.0 = clean release) */
  releaseAccuracy01?: number;
  /** Optional bowler release timing bias (-1 early/fuller .. +1 late/shorter, default 0) */
  releaseTimingBias?: number;
}

export interface StumpCollisionEvent {
  struck: boolean;
  stumpId: 'leg' | 'middle' | 'off' | null;
  impactPoint: CricketVec3 | null;
  impactSpeedMs: number;
}

export interface DeliveryOutcomeSummary {
  headline: string;
  subheadline: string;
  runsScored: number;
  isBoundaryFour: boolean;
  isBoundarySix: boolean;
  isWicketBowled: boolean;
  contactCategory: ContactQualityCategory;
  timingRating: TimingRating;
  timingDeltaMs: number;
  deliverySpeedKmh: number;
  deliveryTypeLabel: string;
  pitchLengthLabel: string;
  pitchBounceLocation: { x: number; y: number } | null;
  bounceHeightAtCreaseZ: number;
  footworkLabel: string;
  shotIntent: ShotIntent;
  resolvedShotId: ShotFamilyId;
  resolvedShotName: string;
  swingFamily: SwingPlaneFamily;
  outgoingSectorLabel: string;
  outgoingAzimuthDeg: number;
  launchElevationDeg: number;
  exitSpeedKmh: number;
  shotDistanceMeters: number;
  struckStumpId: 'leg' | 'middle' | 'off' | null;
}

export interface FootworkArrivalSample {
  /** Ideal swingTriggerTimeSec so peak bat contact meets the ball at this footwork's Y plane */
  idealSwingTriggerTimeSec: number;
  /** Ball X coordinate when crossing this footwork's Y contact plane */
  ballX: number;
  /** Ball Z height when crossing this footwork's Y contact plane */
  ballZ: number;
}

export interface BallSimulationState {
  phase: BallLifecyclePhase;
  simTimeSec: number;
  position: CricketVec3;
  velocity: CricketVec3;
  spinVector: CricketVec3;
  seamAngleRad: number;
  /** Trail of recent ball positions in Cricket (X, Y, Z) for rendering the flight ribbon */
  trailPoints: CricketVec3[];
  pitchBouncePoint: CricketVec3 | null;
  heightAtStrikerPoppingCreaseZ: number | null;
  batCollision: BatCollisionResult | null;
  stumpCollision: StumpCollisionEvent;
  hasTouchedOutfieldGroundPostContact: boolean;
  /** Default front-foot ideal swing trigger time (seconds) */
  idealSwingTriggerTimeSec: number;
  /** Exact arrival samples per footwork plane (advance, front_foot, back_foot, leave) */
  footworkExpectedArrival: Record<FootworkType, FootworkArrivalSample>;
  outcome: DeliveryOutcomeSummary | null;
}

const GRAVITY_Z = -9.81; // m/s^2 downward
const AIR_DRAG_COEFF = 0.0042;
/** Quadratic grass-blade drag coefficient (m^-1) for ball rolling across outfield turf */
const GRASS_QUAD_DRAG_COEFF = 0.0062;
/** Base turf rolling friction deceleration (m/s^2) */
const GRASS_ROLLING_FRICTION_DECEL = 2.65;
/** Minimum micro-substeps per 1/120s physics step (strictly >= 18 as required) */
const MIN_COLLISION_SUBSTEPS = 20;

export function getPitchLengthLabel(bounceY: number): string {
  if (bounceY >= 17.4) return 'Yorker';
  if (bounceY >= 15.2) return 'Full';
  if (bounceY >= 12.6) return 'Good Length';
  if (bounceY >= 10.2) return 'Back of a Length';
  return 'Short Bouncer';
}

export function getDeliveryVariationLabel(movement: MovementVariant): string {
  return getDeliverySpec(movement).label;
}

/**
 * Initializes a new delivery simulation from the bowler's release point (Y = 1.15m, Z = 2.08m),
 * analytically solving the release velocity vector so the ball pitches accurately at
 * (effectiveLineX, effectiveLengthY) while accounting for gravity, air drag, vertical Magnus dip/lift,
 * and aerodynamic swing/drift.
 */
export function createDeliverySimulation(setup: BowlingDeliverySetup): BallSimulationState {
  const exec = resolveBowlerReleaseExecution(
    setup.targetLineX,
    setup.targetLengthY,
    setup.speedKmh,
    setup.movementType,
    setup.releaseAccuracy01 ?? 1.0,
    setup.releaseTimingBias ?? 0.0,
  );
  const spec = getDeliverySpec(setup.movementType);

  const clampedSpeedKmh = Math.max(74, Math.min(150, exec.effectiveSpeedKmh));
  const speedMs = clampedSpeedKmh / 3.6;

  const releasePos: CricketVec3 = {
    x: setup.releaseX ?? -0.36,
    y: 1.15,
    z: 2.08,
  };

  const targetY = Math.max(6.5, Math.min(19.2, exec.effectiveLengthY));
  const targetX = Math.max(-0.85, Math.min(0.95, exec.effectiveLineX));

  const dy = targetY - releasePos.y;
  const dz = BALL_CONSTANTS.RADIUS_METERS - releasePos.z; // 0.036 - 2.08 = -2.044m

  // Lateral swing / drift acceleration during pre-bounce flight (m/s^2)
  const swingAccelX =
    getSwingAccelerationX(setup.movementType, clampedSpeedKmh) * exec.movementEfficiency;
  const magnusAccelZ = spec.airMagnusAccelZ * exec.movementEfficiency;

  // Flight time to pitch impact accounting for subtle drag slowdown (~3.2% average over flight)
  const effectiveHorizontalSpeed = speedMs * 0.968;
  const flightTimeToBounce = dy / effectiveHorizontalSpeed;

  // Solve initial vz0 so z(t_bounce) = 0.036m under gravity + vertical Magnus dip/lift
  const effectiveGravityZ = GRAVITY_Z + magnusAccelZ;
  const vz0 =
    (dz - 0.5 * effectiveGravityZ * flightTimeToBounce * flightTimeToBounce) /
    flightTimeToBounce;

  // Solve initial vx0 so x(t_bounce) = targetX under lateral swing/drift acceleration
  const dx = targetX - releasePos.x;
  const vx0 =
    (dx - 0.5 * swingAccelX * flightTimeToBounce * flightTimeToBounce) / flightTimeToBounce;

  const vy0 = Math.sqrt(Math.max(80, speedMs * speedMs - vx0 * vx0 - vz0 * vz0));

  // Integrate pre-contact trajectory to record arrival timing and reference (X, Z) at each footwork plane:
  // - advance (Y = 16.95m)
  // - front_foot (Y = 18.25m)
  // - leave (Y = 18.88m)
  // - back_foot (Y = 19.30m)
  let probeX = releasePos.x;
  let probeY = releasePos.y;
  let probeZ = releasePos.z;
  let probeVx = vx0;
  let probeVy = vy0;
  let probeVz = vz0;
  let probeTime = 0;
  let bounced = false;
  const probeDt = 1 / 2400;

  const planes: Record<FootworkType, number> = {
    advance: getFootworkContactPlaneY('advance'),
    front_foot: getFootworkContactPlaneY('front_foot'),
    leave: getFootworkContactPlaneY('leave'),
    back_foot: getFootworkContactPlaneY('back_foot'),
  };

  const footworkExpectedArrival = {} as Record<FootworkType, FootworkArrivalSample>;

  while (probeY < 19.65 && probeTime < 2.4) {
    probeTime += probeDt;
    const vMag = Math.hypot(probeVx, probeVy, probeVz);
    const dragX = -AIR_DRAG_COEFF * vMag * probeVx;
    const dragY = -AIR_DRAG_COEFF * vMag * probeVy;
    const dragZ = -AIR_DRAG_COEFF * vMag * probeVz;

    const latAccelX = !bounced ? swingAccelX : swingAccelX * spec.postBounceAirRatio;
    const vertMagnusZ = !bounced ? magnusAccelZ : 0;

    probeVx += (dragX + latAccelX) * probeDt;
    probeVy += dragY * probeDt;
    probeVz += (GRAVITY_Z + vertMagnusZ + dragZ) * probeDt;

    probeX += probeVx * probeDt;
    probeY += probeVy * probeDt;
    probeZ += probeVz * probeDt;

    if (!bounced && probeZ <= BALL_CONSTANTS.RADIUS_METERS && probeVz < 0) {
      bounced = true;
      probeZ = BALL_CONSTANTS.RADIUS_METERS;
      const bounceResp = computePitchBounceResponse(
        setup.movementType,
        probeY,
        probeVy,
        probeVz,
        exec.movementEfficiency,
      );
      probeVz = bounceResp.nextVz;
      probeVy = bounceResp.nextVy;
      probeVx += bounceResp.deltaVx;
    }

    for (const fw of ['advance', 'front_foot', 'leave', 'back_foot'] as FootworkType[]) {
      if (!footworkExpectedArrival[fw] && probeY >= planes[fw]) {
        footworkExpectedArrival[fw] = {
          idealSwingTriggerTimeSec: Math.max(
            0.04,
            probeTime - BAT_BLADE_DIMENSIONS.PEAK_CONTACT_OFFSET_SEC,
          ),
          ballX: probeX,
          ballZ: probeZ,
        };
      }
    }
  }

  // Fallback for any plane not reached
  const defaultSample: FootworkArrivalSample = footworkExpectedArrival.front_foot ?? {
    idealSwingTriggerTimeSec: 0.38,
    ballX: targetX,
    ballZ: 0.38,
  };
  for (const fw of ['advance', 'front_foot', 'leave', 'back_foot'] as FootworkType[]) {
    if (!footworkExpectedArrival[fw]) {
      footworkExpectedArrival[fw] = { ...defaultSample };
    }
  }

  return {
    phase: 'BOWLER_RELEASE',
    simTimeSec: 0,
    position: { ...releasePos },
    velocity: { x: vx0, y: vy0, z: vz0 },
    spinVector: {
      x: 0,
      y: 0,
      z: spec.spinRateRadSec,
    },
    seamAngleRad: spec.seamAngleRad,
    trailPoints: [{ ...releasePos }],
    pitchBouncePoint: null,
    heightAtStrikerPoppingCreaseZ: null,
    batCollision: null,
    stumpCollision: { struck: false, stumpId: null, impactPoint: null, impactSpeedMs: 0 },
    hasTouchedOutfieldGroundPostContact: false,
    idealSwingTriggerTimeSec: footworkExpectedArrival.front_foot.idealSwingTriggerTimeSec,
    footworkExpectedArrival,
    outcome: null,
  };
}

/**
 * Advances the authoritative ball simulation by fixed step `dt` (default 1/120s)
 * using >= 20 continuous micro-substeps to prevent bat-ball and ball-stump tunneling.
 */
export function stepDeliverySimulation(
  state: BallSimulationState,
  dt: number,
  setup: BowlingDeliverySetup,
  battingInput: BattingIntentInput,
  boundaryConfig: BoundaryConfig = DEFAULT_BOUNDARY_CONFIG,
): BallSimulationState {
  if (state.phase === 'DEAD_BALL') {
    return state;
  }

  // Phase 1: BOWLER_RELEASE transitions immediately on first physics step to PRE_BOUNCE_FLIGHT
  if (state.phase === 'BOWLER_RELEASE') {
    state.phase = 'PRE_BOUNCE_FLIGHT';
  }

  const exec = resolveBowlerReleaseExecution(
    setup.targetLineX,
    setup.targetLengthY,
    setup.speedKmh,
    setup.movementType,
    setup.releaseAccuracy01 ?? 1.0,
    setup.releaseTimingBias ?? 0.0,
  );
  const spec = getDeliverySpec(setup.movementType);

  const speedMs = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  // Adaptive continuous substeps: always >= 20, increasing if ball is launched even faster
  const substeps = Math.max(MIN_COLLISION_SUBSTEPS, Math.ceil((speedMs * dt) / 0.008));
  const subDt = dt / substeps;

  const swingAccelX =
    getSwingAccelerationX(setup.movementType, exec.effectiveSpeedKmh) *
    exec.movementEfficiency;
  const magnusAccelZ = spec.airMagnusAccelZ * exec.movementEfficiency;
  const rBall = BALL_CONSTANTS.RADIUS_METERS;

  // Ensure battingInput has the pre-bounce visualReleaseCue if anticipatedLineX/Z are not explicitly overridden
  const effectiveBattingInput: BattingIntentInput =
    battingInput.visualReleaseCue !== undefined
      ? battingInput
      : {
          ...battingInput,
          visualReleaseCue: {
            releaseX: setup.releaseX ?? -0.36,
            targetLineX: setup.targetLineX,
            targetLengthY: setup.targetLengthY,
          },
        };

  for (let i = 0; i < substeps; i++) {
    const prevPos: CricketVec3 = { ...state.position };
    state.simTimeSec += subDt;

    // Integrate linear velocity & position depending on whether ball is rolling on turf or airborne
    if (
      state.phase === 'POST_CONTACT_FLIGHT_OR_ROLL' &&
      state.position.z <= rBall + 0.004 &&
      Math.abs(state.velocity.z) < 0.35
    ) {
      // Ground rolling on outfield turf with quadratic grass-blade drag + rolling resistance:
      // a_decel(v) = c_grass * v^2 + mu_roll * g
      state.position.z = rBall;
      state.velocity.z = 0;
      const horizSpeed = Math.hypot(state.velocity.x, state.velocity.y);
      if (horizSpeed > 0.08) {
        const grassDecelRate =
          GRASS_QUAD_DRAG_COEFF * horizSpeed * horizSpeed + GRASS_ROLLING_FRICTION_DECEL;
        const decel = grassDecelRate * subDt;
        const nextSpeed = Math.max(0, horizSpeed - decel);
        const ratio = nextSpeed / horizSpeed;
        state.velocity.x *= ratio;
        state.velocity.y *= ratio;
      } else {
        state.velocity.x = 0;
        state.velocity.y = 0;
      }
      state.position.x += state.velocity.x * subDt;
      state.position.y += state.velocity.y * subDt;
    } else {
      // 3D Airborne flight integration (gravity + aerodynamic drag + pre-bounce swing/drift + Magnus dip)
      const vMag = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
      const dragX = -AIR_DRAG_COEFF * vMag * state.velocity.x;
      const dragY = -AIR_DRAG_COEFF * vMag * state.velocity.y;
      const dragZ = -AIR_DRAG_COEFF * vMag * state.velocity.z;

      const lateralSwing =
        state.phase === 'PRE_BOUNCE_FLIGHT'
          ? swingAccelX
          : state.phase === 'POST_BOUNCE_FLIGHT'
            ? swingAccelX * spec.postBounceAirRatio
            : 0;

      const verticalMagnus = state.phase === 'PRE_BOUNCE_FLIGHT' ? magnusAccelZ : 0;

      state.velocity.x += (dragX + lateralSwing) * subDt;
      state.velocity.y += dragY * subDt;
      state.velocity.z += (GRAVITY_Z + verticalMagnus + dragZ) * subDt;

      state.position.x += state.velocity.x * subDt;
      state.position.y += state.velocity.y * subDt;
      state.position.z += state.velocity.z * subDt;
    }

    // Track ball height as it crosses the striker's popping crease (Y = 18.90m)
    if (
      state.heightAtStrikerPoppingCreaseZ === null &&
      prevPos.y < PITCH_CONSTANTS.STRIKER_POPPING_CREASE_Y &&
      state.position.y >= PITCH_CONSTANTS.STRIKER_POPPING_CREASE_Y
    ) {
      state.heightAtStrikerPoppingCreaseZ = state.position.z;
    }

    // Phase 2 -> Phase 3 & 4 & 5: Pitch Impact & Bounce Response
    if (state.phase === 'PRE_BOUNCE_FLIGHT') {
      if (state.position.z <= rBall && state.velocity.z < 0) {
        state.position.z = rBall;
        state.phase = 'PITCH_IMPACT';
        state.pitchBouncePoint = { x: state.position.x, y: state.position.y, z: rBall };

        // Phase 4: Bounce Response (restitution, longitudinal friction, and seam/cutter/spin lateral deviation)
        state.phase = 'BOUNCE_RESPONSE';
        const bounceResp = computePitchBounceResponse(
          setup.movementType,
          state.position.y,
          state.velocity.y,
          state.velocity.z,
          exec.movementEfficiency,
        );
        state.velocity.z = bounceResp.nextVz;
        state.velocity.y = bounceResp.nextVy;
        state.velocity.x += bounceResp.deltaVx;

        // Transition immediately to Phase 5: POST_BOUNCE_FLIGHT
        state.phase = 'POST_BOUNCE_FLIGHT';
      } else if (state.position.y >= 16.2 && state.pitchBouncePoint === null) {
        // Full toss reaching the batter's advance/front-foot zone without bouncing first
        state.phase = 'POST_BOUNCE_FLIGHT';
      }
    }

    // Phase 5 -> Phase 6: Continuous Swept 3D Bat-Ball Collision Check in Batter's Reach Zone
    // Covers Advance (Y = 16.95m), Front Foot (Y = 18.25m), and Back Foot (Y = 19.30m)
    if (
      state.phase === 'POST_BOUNCE_FLIGHT' &&
      state.batCollision === null &&
      state.position.y >= 16.1 &&
      state.position.y <= 19.95
    ) {
      const hit = checkBatBallSubstepCollision(
        state.position,
        state.velocity,
        state.simTimeSec,
        effectiveBattingInput,
      );

      if (hit && hit.collided) {
        state.batCollision = hit;
        state.phase = 'BAT_CONTACT_OR_MISS';
        state.velocity = { ...hit.outgoingVelocity };
        state.phase = 'POST_CONTACT_FLIGHT_OR_ROLL';
      }
    }

    // If ball passes the batter's contact plane without bat contact, transition through BAT_CONTACT_OR_MISS
    const contactPlaneY = getFootworkContactPlaneY(effectiveBattingInput.footwork);
    if (
      state.phase === 'POST_BOUNCE_FLIGHT' &&
      state.batCollision === null &&
      state.position.y > contactPlaneY + 0.45
    ) {
      const resolvedShot = resolveIntendedShot(effectiveBattingInput);
      const missedTimingMs =
        effectiveBattingInput.swingTriggerTimeSec !== null
          ? Math.round(
              (state.simTimeSec -
                (effectiveBattingInput.swingTriggerTimeSec +
                  BAT_BLADE_DIMENSIONS.PEAK_CONTACT_OFFSET_SEC)) *
                1000,
            )
          : 0;
      const isLeave =
        effectiveBattingInput.footwork === 'leave' ||
        effectiveBattingInput.swingTriggerTimeSec === null;
      state.batCollision = {
        collided: false,
        contactCategory: isLeave ? 'left_alone' : 'miss',
        timingRating: isLeave ? 'none' : classifyTimingRating(missedTimingMs),
        timingDeltaMs: missedTimingMs,
        bladeOffsetX: 0,
        bladeOffsetY: 0,
        outgoingVelocity: { ...state.velocity },
        contactPoint: { ...state.position },
        exitSpeedKmh: Math.round(
          Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) * 3.6,
        ),
        launchElevationDeg: 0,
        outgoingAzimuthDeg: resolvedShot.aimAngleDeg,
        outgoingSectorLabel: resolvedShot.targetSectorLabel,
        resolvedShot,
      };
      state.phase = 'BAT_CONTACT_OR_MISS';
      state.phase = 'POST_CONTACT_FLIGHT_OR_ROLL';
    }

    // Continuous Swept Ball-Stump Collision Check at Striker's Wicket (Y = 20.12m)
    if (
      !state.stumpCollision.struck &&
      prevPos.y <= PITCH_CONSTANTS.STRIKER_STUMPS_Y + WICKET_CONSTANTS.STUMP_RADIUS_METERS &&
      state.position.y >=
        PITCH_CONSTANTS.STRIKER_STUMPS_Y - WICKET_CONSTANTS.STUMP_RADIUS_METERS - rBall
    ) {
      const stumpHit = checkStrikerWicketCollision(state.position);
      if (stumpHit) {
        state.stumpCollision = {
          struck: true,
          stumpId: stumpHit,
          impactPoint: { ...state.position },
          impactSpeedMs: Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z),
        };
        // Deflect ball off struck wooden stump
        state.velocity.y = -Math.abs(state.velocity.y) * 0.25;
        state.velocity.x += stumpHit === 'off' ? 2.8 : stumpHit === 'leg' ? -2.8 : 0.9;
        state.velocity.z = Math.max(1.2, state.velocity.z * 0.4);
        state.phase = 'FIELDING_OR_WICKET_RESOLUTION';
      }
    }

    // Outfield grass turf bounce during POST_CONTACT_FLIGHT_OR_ROLL or FIELDING_OR_WICKET_RESOLUTION
    if (
      (state.phase === 'POST_CONTACT_FLIGHT_OR_ROLL' ||
        state.phase === 'FIELDING_OR_WICKET_RESOLUTION') &&
      state.position.z <= rBall &&
      state.velocity.z < 0
    ) {
      state.position.z = rBall;
      state.hasTouchedOutfieldGroundPostContact = true;
      const impactVz = Math.abs(state.velocity.z);
      if (impactVz > 0.55) {
        // Oblique grass turf impact: vertical restitution ~0.36, horizontal momentum loss proportional to vertical impact
        state.velocity.z = impactVz * 0.36;
        const horizTurfRetention = Math.max(0.66, 0.80 - 0.012 * impactVz);
        state.velocity.x *= horizTurfRetention;
        state.velocity.y *= horizTurfRetention;
      } else {
        state.velocity.z = 0;
        state.velocity.x *= 0.88;
        state.velocity.y *= 0.88;
      }
    }

    // Check termination conditions for Phase 8 (FIELDING_OR_WICKET_RESOLUTION) -> Phase 9 (DEAD_BALL)
    const beyondRope = isBeyondBoundary(state.position.x, state.position.y, boundaryConfig);
    const keeperCollected =
      !state.batCollision?.collided &&
      !state.stumpCollision.struck &&
      state.position.y >= 23.2;
    const stoppedInField =
      (state.phase === 'POST_CONTACT_FLIGHT_OR_ROLL' ||
        state.phase === 'FIELDING_OR_WICKET_RESOLUTION') &&
      Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) < 0.45 &&
      state.simTimeSec > 0.8;
    const bowledSettled =
      state.stumpCollision.struck &&
      state.simTimeSec > state.idealSwingTriggerTimeSec + 0.45;

    if (beyondRope || keeperCollected || stoppedInField || bowledSettled || state.simTimeSec > 5.8) {
      state.phase = 'FIELDING_OR_WICKET_RESOLUTION';
      state.outcome = buildDeliveryOutcomeSummary(
        state,
        setup,
        effectiveBattingInput,
        beyondRope,
      );
      state.phase = 'DEAD_BALL';
      break;
    }
  }

  // Append position to flight trail ribbon
  const lastTrail = state.trailPoints[state.trailPoints.length - 1];
  if (
    !lastTrail ||
    Math.hypot(
      state.position.x - lastTrail.x,
      state.position.y - lastTrail.y,
      state.position.z - lastTrail.z,
    ) > 0.18
  ) {
    state.trailPoints.push({ ...state.position });
    if (state.trailPoints.length > 90) {
      state.trailPoints.shift();
    }
  }

  return state;
}

/**
 * Checks whether the ball center intersects any of the 3 regulation stumps or 2 bails
 * at the striker's wicket (Y = 20.12m, height Z <= 0.723m).
 */
function checkStrikerWicketCollision(ballPos: CricketVec3): 'leg' | 'middle' | 'off' | null {
  const rBall = BALL_CONSTANTS.RADIUS_METERS;
  if (ballPos.z > WICKET_CONSTANTS.TOTAL_HEIGHT_WITH_BAILS_Z + rBall || ballPos.z < 0) {
    return null;
  }

  const dy = Math.abs(ballPos.y - PITCH_CONSTANTS.STRIKER_STUMPS_Y);
  for (const stump of WICKET_CONSTANTS.STUMPS) {
    const dx = Math.abs(ballPos.x - stump.centerX);
    const radialDist = Math.hypot(dx, dy);
    if (radialDist <= stump.radius + rBall) {
      return stump.id;
    }
  }
  return null;
}

function getSwingAccelerationX(movement: MovementVariant, speedKmh: number): number {
  const spec = getDeliverySpec(movement);
  if (spec.category === 'spin') {
    return spec.airSwingOrDriftAccelX;
  }
  const paceFactor = Math.max(0.65, speedKmh / 136);
  return spec.airSwingOrDriftAccelX * paceFactor;
}

function computePitchBounceResponse(
  movement: MovementVariant,
  bounceY: number,
  forwardVy: number,
  impactVz: number,
  movementEfficiency = 1.0,
): { nextVz: number; nextVy: number; deltaVx: number } {
  const spec = getDeliverySpec(movement);
  const isShort = bounceY < 11.5;
  const isVeryShort = bounceY < 9.5;
  const isYorkerOrFull = bounceY > 16.5;

  let restitutionZ = spec.baseRestitutionZ;
  if (isVeryShort) {
    restitutionZ = movement === 'bouncer' ? spec.baseRestitutionZ : 0.41;
  } else if (isShort) {
    restitutionZ = Math.min(restitutionZ, 0.46);
  } else if (isYorkerOrFull) {
    restitutionZ = Math.min(restitutionZ, 0.52);
  }

  const speedScale =
    spec.category === 'spin'
      ? Math.max(0.78, forwardVy / 24)
      : Math.max(0.7, forwardVy / 34);

  return {
    nextVz: Math.abs(impactVz) * restitutionZ,
    nextVy: forwardVy * spec.pitchLongitudinalRetentionY,
    deltaVx: spec.pitchLateralDeflectionVx * speedScale * movementEfficiency,
  };
}

function formatFootworkLabel(fw: FootworkType): string {
  switch (fw) {
    case 'front_foot':
      return 'Front Foot';
    case 'back_foot':
      return 'Back Foot';
    case 'advance':
      return 'Advance Down Track';
    case 'leave':
      return 'Left Alone';
  }
}

function buildDeliveryOutcomeSummary(
  state: BallSimulationState,
  setup: BowlingDeliverySetup,
  battingInput: BattingIntentInput,
  crossedBoundary: boolean,
): DeliveryOutcomeSummary {
  const contact = state.batCollision;
  const resolvedShot = contact?.resolvedShot ?? resolveIntendedShot(battingInput);
  const contactCategory: ContactQualityCategory = contact?.contactCategory ?? 'miss';
  const timingRating: TimingRating = contact?.timingRating ?? 'none';
  const timingDeltaMs = contact?.timingDeltaMs ?? 0;
  const exitSpeedKmh = contact?.exitSpeedKmh ?? 0;
  const launchElevationDeg = contact?.launchElevationDeg ?? 0;
  const outgoingAzimuthDeg = contact?.outgoingAzimuthDeg ?? resolvedShot.aimAngleDeg;
  const outgoingSectorLabel = contact?.outgoingSectorLabel ?? resolvedShot.targetSectorLabel;

  const shotDistanceMeters = Number(
    Math.hypot(
      state.position.x,
      state.position.y - PITCH_CONSTANTS.STRIKER_POPPING_CREASE_Y,
    ).toFixed(1),
  );

  const bouncePoint = state.pitchBouncePoint
    ? {
        x: Number(state.pitchBouncePoint.x.toFixed(2)),
        y: Number(state.pitchBouncePoint.y.toFixed(2)),
      }
    : null;
  const bounceHeightAtCreaseZ = Number(
    (state.heightAtStrikerPoppingCreaseZ ?? 0.45).toFixed(2),
  );
  const deliveryTypeLabel = getDeliveryVariationLabel(setup.movementType);
  const pitchLengthLabel = getPitchLengthLabel(bouncePoint?.y ?? setup.targetLengthY);
  const footworkLabel = formatFootworkLabel(battingInput.footwork);

  // Case 1: BOWLED! (Ball hit the striker's stumps directly or via an inside/bottom edge)
  if (state.stumpCollision.struck) {
    const stumpLabel =
      state.stumpCollision.stumpId === 'off'
        ? 'Off Stump'
        : state.stumpCollision.stumpId === 'leg'
          ? 'Leg Stump'
          : 'Middle Stump';
    const viaEdge =
      contactCategory === 'inside_edge' || contactCategory === 'bottom_edge';
    return {
      headline: `BOWLED! ${stumpLabel.toUpperCase()} UPROOTED`,
      subheadline: viaEdge
        ? `Dragged ${resolvedShot.shotName} (${contactCategory.replace('_', ' ')}) onto ${stumpLabel}`
        : battingInput.footwork === 'leave'
          ? `Left alone & crashed into ${stumpLabel} (${setup.speedKmh} km/h ${deliveryTypeLabel})`
          : `Beaten attempting ${resolvedShot.shotName} (${timingRating.toUpperCase()} ${
              timingDeltaMs >= 0 ? `+${timingDeltaMs}ms` : `${timingDeltaMs}ms`
            })`,
      runsScored: 0,
      isBoundaryFour: false,
      isBoundarySix: false,
      isWicketBowled: true,
      contactCategory,
      timingRating,
      timingDeltaMs,
      deliverySpeedKmh: setup.speedKmh,
      deliveryTypeLabel,
      pitchLengthLabel,
      pitchBounceLocation: bouncePoint,
      bounceHeightAtCreaseZ,
      footworkLabel,
      shotIntent: resolvedShot.shotIntent,
      resolvedShotId: resolvedShot.shotId,
      resolvedShotName: resolvedShot.shotName,
      swingFamily: resolvedShot.swingFamily,
      outgoingSectorLabel,
      outgoingAzimuthDeg,
      launchElevationDeg,
      exitSpeedKmh,
      shotDistanceMeters: 0,
      struckStumpId: state.stumpCollision.stumpId,
    };
  }

  // Case 2: No Bat Contact (Left Alone or Played & Missed, gathered by Wicketkeeper)
  if (!contact || !contact.collided) {
    if (contactCategory === 'left_alone') {
      return {
        headline: 'WELL LEFT · TAKEN BY KEEPER',
        subheadline: `Pass height ${bounceHeightAtCreaseZ}m at crease · ${setup.speedKmh} km/h ${deliveryTypeLabel}`,
        runsScored: 0,
        isBoundaryFour: false,
        isBoundarySix: false,
        isWicketBowled: false,
        contactCategory: 'left_alone',
        timingRating: 'none',
        timingDeltaMs: 0,
        deliverySpeedKmh: setup.speedKmh,
        deliveryTypeLabel,
        pitchLengthLabel,
        pitchBounceLocation: bouncePoint,
        bounceHeightAtCreaseZ,
        footworkLabel,
        shotIntent: resolvedShot.shotIntent,
        resolvedShotId: resolvedShot.shotId,
        resolvedShotName: resolvedShot.shotName,
        swingFamily: resolvedShot.swingFamily,
        outgoingSectorLabel,
        outgoingAzimuthDeg,
        launchElevationDeg: 0,
        exitSpeedKmh: 0,
        shotDistanceMeters: 0,
        struckStumpId: null,
      };
    }

    return {
      headline: `PLAYED & MISSED · ${resolvedShot.shotName.toUpperCase()}`,
      subheadline: `Swung ${timingRating.toUpperCase()} (${
        timingDeltaMs >= 0 ? `+${timingDeltaMs}ms` : `${timingDeltaMs}ms`
      }) against ${setup.speedKmh} km/h ${deliveryTypeLabel} (${pitchLengthLabel})`,
      runsScored: 0,
      isBoundaryFour: false,
      isBoundarySix: false,
      isWicketBowled: false,
      contactCategory: 'miss',
      timingRating,
      timingDeltaMs,
      deliverySpeedKmh: setup.speedKmh,
      deliveryTypeLabel,
      pitchLengthLabel,
      pitchBounceLocation: bouncePoint,
      bounceHeightAtCreaseZ,
      footworkLabel,
      shotIntent: resolvedShot.shotIntent,
      resolvedShotId: resolvedShot.shotId,
      resolvedShotName: resolvedShot.shotName,
      swingFamily: resolvedShot.swingFamily,
      outgoingSectorLabel,
      outgoingAzimuthDeg,
      launchElevationDeg: 0,
      exitSpeedKmh: 0,
      shotDistanceMeters: 0,
      struckStumpId: null,
    };
  }

  // Case 3: Bat-Ball Contact Occurred!
  const isSix = crossedBoundary && !state.hasTouchedOutfieldGroundPostContact;
  const isFour = crossedBoundary && state.hasTouchedOutfieldGroundPostContact;

  let runs = 0;
  if (isSix) runs = 6;
  else if (isFour) runs = 4;
  else if (shotDistanceMeters >= 42) runs = 3;
  else if (shotDistanceMeters >= 24) runs = 2;
  else if (shotDistanceMeters >= 11) runs = 1;

  const shotLabel = resolvedShot.shotName;
  let headline = `${shotLabel.toUpperCase()} TO ${outgoingSectorLabel.toUpperCase()} · ${
    runs === 0 ? 'DOT BALL' : `${runs} RUN${runs > 1 ? 'S' : ''}`
  }`;
  if (isSix) {
    headline = `SIX! ${shotLabel.toUpperCase()} OVER ${outgoingSectorLabel.toUpperCase()} (${shotDistanceMeters}m)`;
  } else if (isFour) {
    headline = `FOUR! ${shotLabel.toUpperCase()} THROUGH ${outgoingSectorLabel.toUpperCase()} (${exitSpeedKmh} km/h)`;
  } else if (contactCategory === 'outside_edge') {
    headline = `OUTSIDE EDGE! STREAKS TOWARD ${outgoingSectorLabel.toUpperCase()}`;
  } else if (contactCategory === 'inside_edge') {
    headline = `INSIDE EDGE! DEFLECTED TO ${outgoingSectorLabel.toUpperCase()}`;
  } else if (contactCategory === 'top_edge') {
    headline = `TOP EDGE! SPLICED TOWARD ${outgoingSectorLabel.toUpperCase()}`;
  } else if (resolvedShot.shotIntent === 'push') {
    headline =
      runs > 0
        ? `SOFT PUSH TO ${outgoingSectorLabel.toUpperCase()} · ${runs} RUN${runs > 1 ? 'S' : ''}`
        : `SOLID ${shotLabel.toUpperCase()} · DEADENED`;
  }

  return {
    headline,
    subheadline: `${shotLabel} (${footworkLabel}) · ${contactCategory.replace('_', ' ').toUpperCase()} · Timing ${timingRating.toUpperCase()} (${
      timingDeltaMs >= 0 ? `+${timingDeltaMs}ms` : `${timingDeltaMs}ms`
    }) · Exit ${exitSpeedKmh} km/h`,
    runsScored: runs,
    isBoundaryFour: isFour,
    isBoundarySix: isSix,
    isWicketBowled: false,
    contactCategory,
    timingRating,
    timingDeltaMs,
    deliverySpeedKmh: setup.speedKmh,
    deliveryTypeLabel,
    pitchLengthLabel,
    pitchBounceLocation: bouncePoint,
    bounceHeightAtCreaseZ,
    footworkLabel,
    shotIntent: resolvedShot.shotIntent,
    resolvedShotId: resolvedShot.shotId,
    resolvedShotName: resolvedShot.shotName,
    swingFamily: resolvedShot.swingFamily,
    outgoingSectorLabel,
    outgoingAzimuthDeg,
    launchElevationDeg,
    exitSpeedKmh,
    shotDistanceMeters,
    struckStumpId: null,
  };
}
