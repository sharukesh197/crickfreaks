/**
 * CREASE CLASH — Continuous 360° Bat Swing, Contextual Shot Resolution & 3D OBB Collision Solver
 *
 * Pure TypeScript simulation module (zero UI or Three.js renderer dependencies).
 * Operates strictly in authoritative Cricket World Coordinates (X, Y, Z):
 * - X: Lateral across pitch (-X leg side, +X off side for Right-Handed Batter; mirrored for Left-Handed Batter)
 * - Y: Pitch length (Y = 0 bowler's wicket -> Y = 20.12m striker's wicket)
 * - Z: Height above ground (meters)
 *
 * Core Design Principle:
 * 1. Player inputs (360° joystick direction, shot intent, footwork, handedness) determine the INTENDED cricket stroke
 *    and its physical 3D swing plane.
 * 2. Timing, incoming ball trajectory, bat-face orientation, and 3D OBB collision geometry determine the ACTUAL
 *    contact quality (sweet spot, solid, outside/inside/top/bottom edge, toe, miss) and ball exit velocity.
 */

import { CricketVec3 } from './coordinates';
import { BALL_CONSTANTS } from './constants';

export type BatterHandedness = 'RHB' | 'LHB';
export type FootworkType = 'front_foot' | 'back_foot' | 'advance' | 'leave';
export type ShotIntent = 'push' | 'stroke' | 'loft' | 'special';

/** Backward-compatible aliases for legacy callers */
export type ShotType = 'drive' | 'defence' | ShotIntent;
export type BatDirectionIntent = 'off' | 'straight' | 'on';

export type SwingPlaneFamily =
  | 'defensive_push'
  | 'vertical_drive'
  | 'on_side_flick'
  | 'horizontal_cut'
  | 'horizontal_pull'
  | 'kneeling_sweep'
  | 'behind_wicket_ramp'
  | 'leave';

export type ShotFamilyId =
  | 'left_alone'
  // Defensive & Controlled Strokes
  | 'forward_defence'
  | 'back_foot_defence'
  | 'dead_bat_block'
  | 'late_defensive_touch'
  // Classical Ground Strokes
  | 'straight_drive'
  | 'off_drive'
  | 'extra_cover_drive'
  | 'cover_drive'
  | 'square_drive'
  | 'on_drive'
  | 'flick'
  | 'glance'
  | 'leg_glance'
  | 'cut'
  | 'square_cut'
  | 'late_cut'
  // Attacking & Lofted Strokes
  | 'pull'
  | 'hook'
  | 'lofted_straight_drive'
  | 'lofted_cover_drive'
  | 'lofted_on_drive'
  | 'slog'
  | 'slog_sweep'
  // Special & Improvised 360° Strokes
  | 'sweep'
  | 'paddle_sweep'
  | 'reverse_sweep'
  | 'ramp'
  | 'scoop'
  | 'uppercut';

export type ContactQualityCategory =
  | 'sweet_spot'
  | 'solid'
  | 'outside_edge'
  | 'inside_edge'
  | 'top_edge'
  | 'bottom_edge'
  | 'toe'
  | 'miss'
  | 'left_alone';

export type TimingRating = 'early' | 'good' | 'perfect' | 'late' | 'none';

export interface ResolvedShotSpec {
  shotId: ShotFamilyId;
  shotName: string;
  swingFamily: SwingPlaneFamily;
  shotIntent: ShotIntent;
  footwork: FootworkType;
  /** World azimuth angle in degrees (-180..+180; 0 = straight down -Y, +90 = +X, -90 = -X, ±180 = +Y behind keeper) */
  aimAngleDeg: number;
  /** Batter-relative angle in degrees (positive = Off-Side, negative = Leg-Side for both RHB and LHB) */
  relativeAngleDeg: number;
  /** Human-readable field sector targeted by the 360° input */
  targetSectorLabel: string;
}

export interface BattingIntentInput {
  footwork: FootworkType;
  /** Primary 4-way shot intent ('push' | 'stroke' | 'loft' | 'special'); optional fallback to legacy shotType */
  shotIntent?: ShotIntent;
  /** Legacy compatibility field ('drive' -> 'stroke', 'defence' -> 'push') */
  shotType?: ShotType;
  /** Continuous 360-degree aim angle in degrees (-180..180; 0 = Straight -Y, +90 = +X, -90 = -X, 180 = +Y) */
  aimAngleDeg?: number;
  /** Legacy 3-way direction fallback if aimAngleDeg is omitted */
  directionIntent?: BatDirectionIntent;
  /** Batter handedness (defaults to 'RHB') */
  handedness?: BatterHandedness;
  /** Simulation timestamp (seconds since release) when the batter triggered the downswing */
  swingTriggerTimeSec: number | null;
  /** Target line X corridor where the batter anticipates the ball arriving */
  anticipatedLineX: number;
  /** Target height Z where the batter anticipates meeting the ball */
  anticipatedHeightZ: number;
}

export interface BatPose3D {
  /** Center of the hitting blade in Cricket (X, Y, Z) */
  bladeCenter: CricketVec3;
  /** Unit vector across blade width (+u points toward outside/off edge) */
  axisU: CricketVec3;
  /** Unit vector along blade length (+v points from handle splice toward toe) */
  axisV: CricketVec3;
  /** Unit vector normal to flat hitting face (+w points in direction bat face is aiming) */
  axisW: CricketVec3;
  /** Instantaneous linear velocity of the blade center in Cricket (X, Y, Z) m/s */
  bladeVelocity: CricketVec3;
  /** Normalized swing progress [0 = stance, 0.5 = peak contact zone, 1 = follow-through] */
  swingProgress: number;
  /** Whether the bat is currently in its active physical downswing/contact arc */
  isActiveSwing: boolean;
  /** Resolved intended shot specification */
  resolvedShot: ResolvedShotSpec;
}

export interface BatCollisionResult {
  collided: boolean;
  contactCategory: ContactQualityCategory;
  timingRating: TimingRating;
  /** Timing delta in milliseconds (negative = Early, 0 = Ideal peak, positive = Late) */
  timingDeltaMs: number;
  /** Local lateral offset on blade in meters (-0.054m inside edge to +0.054m outside edge) */
  bladeOffsetX: number;
  /** Local longitudinal offset on blade in meters (-0.28m shoulder to +0.28m toe) */
  bladeOffsetY: number;
  /** Outgoing 3D ball velocity vector (vx, vy, vz) in m/s in Cricket World Coordinates */
  outgoingVelocity: CricketVec3;
  /** World point of contact (X, Y, Z) */
  contactPoint: CricketVec3;
  /** Exit speed in km/h */
  exitSpeedKmh: number;
  /** Launch elevation angle in degrees */
  launchElevationDeg: number;
  /** Outgoing horizontal azimuth angle in degrees (-180..+180) */
  outgoingAzimuthDeg: number;
  /** Outgoing field sector label */
  outgoingSectorLabel: string;
  /** Resolved intended shot specification */
  resolvedShot: ResolvedShotSpec;
}

export const BAT_BLADE_DIMENSIONS = {
  /** Regulation blade length (meters) */
  LENGTH_V: 0.56,
  HALF_LENGTH_V: 0.28,
  /** Regulation blade width (4.25 inches = 0.108m) */
  WIDTH_U: 0.108,
  HALF_WIDTH_U: 0.054,
  /** Blade thickness (0.042m) */
  THICKNESS_W: 0.042,
  HALF_THICKNESS_W: 0.021,
  /** Total downswing duration from trigger to follow-through completion (seconds) */
  SWING_DURATION_SEC: 0.28,
  /** Time offset from swingTriggerTimeSec to peak bat velocity at the contact plane (seconds) */
  PEAK_CONTACT_OFFSET_SEC: 0.11,
} as const;

/**
 * Normalizes any angle in degrees to (-180, +180].
 */
export function normalizeAngleDeg(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

export const normalizeSignedAngleDeg = normalizeAngleDeg;
export type ShotIntentType = ShotIntent;

/**
 * Converts a normalized 2D joystick vector (joyX, joyY) where:
 * - joyX in [-1, 1] (left to right on screen)
 * - joyY in [-1, 1] (-1 = up/toward bowler on screen, +1 = down/behind wicketkeeper on screen)
 * into a Cricket World azimuth angle in degrees (-180..+180).
 */
export function joystickVectorToAimAngleDeg(
  joyX: number,
  joyY: number,
  fallbackAngleDeg = 0,
): number {
  if (Math.hypot(joyX, joyY) < 0.05) {
    return fallbackAngleDeg; // Default straight down the ground (-Y) or previous angle
  }
  // Straight down ground (-Y) is joyY = -1, joyX = 0 -> atan2(joyX, -joyY) = 0 deg
  const rad = Math.atan2(joyX, -joyY);
  return normalizeAngleDeg((rad * 180) / Math.PI);
}

/**
 * Converts a Cricket World azimuth angle in degrees (-180..+180) into a unit 2D direction vector
 * in Cricket (X, Y) ground plane.
 */
export function aimAngleDegToCricketUnitVec2(angleDeg: number): { dx: number; dy: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    dx: Math.sin(rad),
    dy: -Math.cos(rad),
  };
}

/**
 * Computes the horizontal azimuth angle in degrees (-180..+180) of a 3D velocity or displacement vector
 * relative to the striker's crease (0 deg = straight toward bowler -Y, +90 = +X, -90 = -X, ±180 = +Y behind keeper).
 */
export function computeCricketAzimuthDeg(vx: number, vy: number): number {
  if (Math.hypot(vx, vy) < 1e-5) return 0;
  return normalizeAngleDeg((Math.atan2(vx, -vy) * 180) / Math.PI);
}

/**
 * Returns the authentic cricket field sector name for a given world azimuth angle and batter handedness.
 */
export function getFieldSectorLabel(
  worldAngleDeg: number,
  handedness: BatterHandedness = 'RHB',
): string {
  const handSign = handedness === 'LHB' ? -1 : 1;
  const rel = normalizeAngleDeg(worldAngleDeg * handSign);

  if (Math.abs(rel) <= 14) return 'Straight';
  if (rel > 14 && rel <= 34) return 'Mid-Off';
  if (rel > 34 && rel <= 56) return 'Extra Cover';
  if (rel > 56 && rel <= 78) return 'Cover';
  if (rel > 78 && rel <= 102) return 'Point';
  if (rel > 102 && rel <= 124) return 'Backward Point';
  if (rel > 124 && rel <= 148) return 'Third Man';
  if (rel > 148 && rel <= 168) return 'Fine Third Man';
  if (rel > 168 || rel < -168) return 'Behind Wicket (Keeper)';
  if (rel < -14 && rel >= -36) return 'Mid-On';
  if (rel < -36 && rel >= -72) return 'Midwicket';
  if (rel < -72 && rel >= -104) return 'Square Leg';
  if (rel < -104 && rel >= -128) return 'Backward Square Leg';
  if (rel < -128 && rel >= -152) return 'Fine Leg';
  return 'Long Stop / Fine Scoop';
}

/**
 * Resolves effective ShotIntent from a BattingIntentInput (supporting both modern shotIntent and legacy shotType).
 */
export function resolveEffectiveShotIntent(input: BattingIntentInput): ShotIntent {
  if (input.shotIntent) return input.shotIntent;
  if (input.shotType === 'defence' || input.shotType === 'push') return 'push';
  if (input.shotType === 'loft') return 'loft';
  if (input.shotType === 'special') return 'special';
  return 'stroke';
}

/**
 * Resolves effective 360° aimAngleDeg from a BattingIntentInput (supporting both continuous aimAngleDeg and legacy directionIntent).
 */
export function resolveEffectiveAimAngleDeg(input: BattingIntentInput): number {
  const handSign = (input.handedness ?? 'RHB') === 'LHB' ? -1 : 1;
  if (typeof input.aimAngleDeg === 'number' && !Number.isNaN(input.aimAngleDeg)) {
    return normalizeAngleDeg(input.aimAngleDeg);
  }
  if (input.directionIntent === 'off') return 36 * handSign;
  if (input.directionIntent === 'on') return -36 * handSign;
  return 0;
}

/**
 * Deterministically resolves the player's INTENDED cricket stroke from their combination of:
 * - 360° Directional Joystick Angle
 * - Shot Intent (PUSH / STROKE / LOFT / SPECIAL)
 * - Footwork (FRONT_FOOT / BACK_FOOT / ADVANCE / LEAVE)
 * - Batter Handedness (RHB / LHB)
 *
 * IMPORTANT: This function depends ONLY on player intent, never on timing errors or outcome tables.
 */
export function resolveIntendedShot(input: BattingIntentInput): ResolvedShotSpec {
  const handedness: BatterHandedness = input.handedness ?? 'RHB';
  const handSign = handedness === 'LHB' ? -1 : 1;
  const shotIntent = resolveEffectiveShotIntent(input);
  const aimAngleDeg = resolveEffectiveAimAngleDeg(input);
  const rel = normalizeAngleDeg(aimAngleDeg * handSign);
  const targetSectorLabel = getFieldSectorLabel(aimAngleDeg, handedness);

  // 1. Leave
  if (input.footwork === 'leave') {
    return {
      shotId: 'left_alone',
      shotName: 'Left Alone',
      swingFamily: 'leave',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  // 2. PUSH Intent (Defensive & Soft-Hands Placement Strokes)
  if (shotIntent === 'push') {
    if (rel >= 102) {
      return {
        shotId: 'late_defensive_touch',
        shotName: 'Late Defensive Touch',
        swingFamily: 'defensive_push',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel <= -102) {
      return {
        shotId: 'leg_glance',
        shotName: 'Soft Leg Glance',
        swingFamily: 'defensive_push',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (input.footwork === 'back_foot') {
      const isDeadBlock = Math.abs(rel) <= 20;
      return {
        shotId: isDeadBlock ? 'dead_bat_block' : 'back_foot_defence',
        shotName: isDeadBlock ? 'Dead-Bat Block' : 'Back-Foot Defence',
        swingFamily: 'defensive_push',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    const isDeadBlock = Math.abs(rel) <= 18;
    return {
      shotId: isDeadBlock ? 'dead_bat_block' : 'forward_defence',
      shotName: isDeadBlock ? 'Dead-Bat Block' : 'Forward Defence',
      swingFamily: 'defensive_push',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  // 3. SPECIAL Intent (Sweeps, Reverse Sweeps, Paddles, Ramps, Scoops, Uppercuts)
  if (shotIntent === 'special') {
    if (rel >= 120) {
      const isUppercut = input.footwork === 'back_foot';
      return {
        shotId: isUppercut ? 'uppercut' : 'ramp',
        shotName: isUppercut ? 'Uppercut' : 'Third-Man Ramp',
        swingFamily: isUppercut ? 'horizontal_cut' : 'behind_wicket_ramp',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel <= -120) {
      const isRamp = input.footwork === 'back_foot';
      return {
        shotId: isRamp ? 'ramp' : 'scoop',
        shotName: isRamp ? 'Fine-Leg Ramp' : 'Scoop Over Keeper',
        swingFamily: 'behind_wicket_ramp',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel > 20) {
      return {
        shotId: 'reverse_sweep',
        shotName: 'Reverse Sweep',
        swingFamily: 'kneeling_sweep',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel <= -85) {
      return {
        shotId: 'paddle_sweep',
        shotName: 'Paddle Sweep',
        swingFamily: 'kneeling_sweep',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (input.footwork === 'advance') {
      return {
        shotId: 'slog_sweep',
        shotName: 'Slog Sweep',
        swingFamily: 'kneeling_sweep',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    return {
      shotId: 'sweep',
      shotName: 'Conventional Sweep',
      swingFamily: 'kneeling_sweep',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  // 4. Back-Foot Off-Side Horizontal Cuts (Cut, Square Cut, Late Cut, Uppercut)
  if (input.footwork === 'back_foot' && rel >= 50) {
    if (shotIntent === 'loft' && rel >= 100) {
      return {
        shotId: 'uppercut',
        shotName: 'Uppercut',
        swingFamily: 'horizontal_cut',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel >= 110) {
      return {
        shotId: 'late_cut',
        shotName: 'Late Cut',
        swingFamily: 'horizontal_cut',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel >= 72) {
      return {
        shotId: 'square_cut',
        shotName: 'Square Cut',
        swingFamily: 'horizontal_cut',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    return {
      shotId: 'cut',
      shotName: 'Back-Foot Cut',
      swingFamily: 'horizontal_cut',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  // 5. Back-Foot Leg-Side Horizontal Pull & Hook
  if (input.footwork === 'back_foot' && rel <= -42 && rel >= -135) {
    const isHook = shotIntent === 'loft' || rel <= -88;
    return {
      shotId: isHook ? 'hook' : 'pull',
      shotName: isHook ? 'Hook Shot' : 'Pull Shot',
      swingFamily: 'horizontal_pull',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  // 6. LOFT Intent (Lofted Drives, Slogs, Slog Sweeps, Scoops)
  if (shotIntent === 'loft') {
    if (rel >= 115) {
      return {
        shotId: 'uppercut',
        shotName: 'Lofted Uppercut',
        swingFamily: 'horizontal_cut',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel <= -125) {
      return {
        shotId: 'scoop',
        shotName: 'Lofted Scoop',
        swingFamily: 'behind_wicket_ramp',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel >= 22) {
      return {
        shotId: 'lofted_cover_drive',
        shotName: 'Lofted Cover Drive',
        swingFamily: 'vertical_drive',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel <= -52) {
      const isSlogSweep = input.footwork === 'front_foot' && rel <= -68;
      return {
        shotId: isSlogSweep ? 'slog_sweep' : 'slog',
        shotName: isSlogSweep ? 'Slog Sweep' : 'Cow-Corner Slog',
        swingFamily: isSlogSweep ? 'kneeling_sweep' : 'on_side_flick',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    if (rel <= -18) {
      return {
        shotId: 'lofted_on_drive',
        shotName: 'Lofted On Drive',
        swingFamily: 'on_side_flick',
        shotIntent,
        footwork: input.footwork,
        aimAngleDeg,
        relativeAngleDeg: rel,
        targetSectorLabel,
      };
    }
    return {
      shotId: 'lofted_straight_drive',
      shotName: 'Lofted Straight Drive',
      swingFamily: 'vertical_drive',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  // 7. STROKE Intent (Classical Ground Drives, Flicks, Glances & Late Cuts)
  if (rel >= 112) {
    return {
      shotId: 'late_cut',
      shotName: 'Late Cut',
      swingFamily: 'horizontal_cut',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }
  if (rel >= 76) {
    return {
      shotId: 'square_drive',
      shotName: 'Square Drive',
      swingFamily: 'vertical_drive',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }
  if (rel >= 52) {
    return {
      shotId: 'cover_drive',
      shotName: 'Cover Drive',
      swingFamily: 'vertical_drive',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }
  if (rel >= 30) {
    return {
      shotId: 'extra_cover_drive',
      shotName: 'Extra-Cover Drive',
      swingFamily: 'vertical_drive',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }
  if (rel > 14) {
    return {
      shotId: 'off_drive',
      shotName: 'Off Drive',
      swingFamily: 'vertical_drive',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  if (rel <= -112) {
    return {
      shotId: 'leg_glance',
      shotName: 'Fine Leg Glance',
      swingFamily: 'on_side_flick',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }
  if (rel <= -74) {
    return {
      shotId: 'glance',
      shotName: 'Hip Glance',
      swingFamily: 'on_side_flick',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }
  if (rel <= -38) {
    return {
      shotId: 'flick',
      shotName: 'Wristy Flick',
      swingFamily: 'on_side_flick',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }
  if (rel < -14) {
    return {
      shotId: 'on_drive',
      shotName: 'On Drive',
      swingFamily: 'on_side_flick',
      shotIntent,
      footwork: input.footwork,
      aimAngleDeg,
      relativeAngleDeg: rel,
      targetSectorLabel,
    };
  }

  return {
    shotId: 'straight_drive',
    shotName: 'Straight Drive',
    swingFamily: 'vertical_drive',
    shotIntent,
    footwork: input.footwork,
    aimAngleDeg,
    relativeAngleDeg: rel,
    targetSectorLabel,
  };
}

/**
 * Returns the longitudinal Y contact plane in Cricket World Coordinates based on selected footwork.
 * - Advance charges down the pitch to meet the ball early at Y = 16.95m.
 * - Front foot steps forward from popping crease (Y = 18.90m) to meet the ball at Y = 18.25m.
 * - Back foot steps deeper into the crease to meet the ball at Y = 19.30m.
 * - Leave stays at Y = 18.88m with bat withdrawn high.
 */
export function getFootworkContactPlaneY(footwork: FootworkType): number {
  if (footwork === 'advance') return 16.95;
  if (footwork === 'front_foot') return 18.25;
  if (footwork === 'back_foot') return 19.3;
  return 18.88;
}

/**
 * Evaluates the instantaneous 3D pose, orientation axes, and velocity of the bat blade at simulation time `simTimeSec`.
 * Each SwingPlaneFamily has genuinely distinct 3D kinematics, vertical/lateral reach envelopes, loft angles, and bat speeds.
 */
export function evaluateBatPoseAtTime(
  simTimeSec: number,
  input: BattingIntentInput,
): BatPose3D {
  const resolvedShot = resolveIntendedShot(input);
  const handedness: BatterHandedness = input.handedness ?? 'RHB';
  const handSign = handedness === 'LHB' ? -1 : 1;
  const basePlaneY = getFootworkContactPlaneY(input.footwork);

  // Reachable lateral X envelope depends on stroke family:
  // Ramps/Scoops operate near the stump corridor; Cuts/Sweeps reach wider.
  let minLineX = -0.64;
  let maxLineX = 0.64;
  if (resolvedShot.swingFamily === 'behind_wicket_ramp') {
    minLineX = -0.28;
    maxLineX = 0.28;
  } else if (resolvedShot.swingFamily === 'horizontal_cut') {
    if (handSign === 1) {
      minLineX = -0.04;
      maxLineX = 0.72;
    } else {
      minLineX = -0.72;
      maxLineX = 0.04;
    }
  }
  const clampedLineX = Math.max(minLineX, Math.min(maxLineX, input.anticipatedLineX));

  // Vertical reach Z envelope depends on Footwork AND SwingPlaneFamily:
  let minCenterZ = 0.2;
  let maxCenterZ = 0.72;
  if (resolvedShot.swingFamily === 'kneeling_sweep') {
    // Kneeling sweep reaches low balls (Z in [0.14m, 0.50m]); high-bouncing balls fly over the sweep!
    minCenterZ = 0.14;
    maxCenterZ = 0.5;
  } else if (resolvedShot.swingFamily === 'behind_wicket_ramp') {
    minCenterZ = 0.18;
    maxCenterZ = 0.78;
  } else if (
    resolvedShot.swingFamily === 'horizontal_cut' ||
    resolvedShot.swingFamily === 'horizontal_pull'
  ) {
    // Cross-bat back-foot strokes operate from waist height (0.42m) up to chest/head height (1.32m for Hook)
    minCenterZ = 0.42;
    maxCenterZ = resolvedShot.shotId === 'hook' || resolvedShot.shotId === 'uppercut' ? 1.34 : 1.22;
  } else if (input.footwork === 'back_foot') {
    minCenterZ = 0.42;
    maxCenterZ = 1.08;
  } else if (input.footwork === 'advance') {
    minCenterZ = 0.18;
    maxCenterZ = 0.78;
  }
  const targetHeightZ = Math.max(minCenterZ, Math.min(maxCenterZ, input.anticipatedHeightZ));

  // If batter chose Leave or hasn't triggered a swing yet
  if (input.footwork === 'leave' || input.swingTriggerTimeSec === null) {
    const liftedZ = input.footwork === 'leave' ? 1.48 : 0.62;
    return {
      bladeCenter: { x: clampedLineX - 0.15 * handSign, y: basePlaneY + 0.35, z: liftedZ },
      axisU: { x: handSign, y: 0, z: 0 },
      axisV: { x: 0, y: 0.25, z: -0.968 },
      axisW: { x: 0, y: -0.968, z: -0.25 },
      bladeVelocity: { x: 0, y: 0, z: 0 },
      swingProgress: 0,
      isActiveSwing: false,
      resolvedShot,
    };
  }

  const elapsed = simTimeSec - input.swingTriggerTimeSec;
  const duration = BAT_BLADE_DIMENSIONS.SWING_DURATION_SEC;
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  const isActiveSwing = elapsed >= -0.025 && elapsed <= duration + 0.035;

  // Peak contact happens at elapsed == PEAK_CONTACT_OFFSET_SEC (0.11s)
  const peakElapsed = BAT_BLADE_DIMENSIONS.PEAK_CONTACT_OFFSET_SEC;
  const relTime = elapsed - peakElapsed; // 0 at ideal contact moment, <0 before, >0 after

  // Continuous 360-degree target azimuth in radians
  const targetYawRad = (resolvedShot.aimAngleDeg * Math.PI) / 180;

  // Timing shifts the instantaneous bat-face yaw along the swing arc:
  // Early contact (<0) catches the bat slightly further along the follow-through side;
  // Late contact (>0) catches the bat slightly more open.
  const timingYawShift = -relTime * 2.2 * handSign;
  const instantaneousYawRad = targetYawRad + timingYawShift;

  // Distinct speed, loft pitch angle, and 3D swing trajectory per ShotIntent & SwingPlaneFamily
  let peakBatSpeed = 25.5;
  let baseLoftRad = 0.14;
  let upwardVelRatio = 0.52;
  let arcRadius = 0.76;

  switch (resolvedShot.shotIntent) {
    case 'push':
      peakBatSpeed = 2.4;
      baseLoftRad = -0.22; // Angled downward to deaden the ball onto the turf
      upwardVelRatio = -0.15;
      arcRadius = 0.24;
      break;
    case 'stroke':
      peakBatSpeed = 26.2;
      baseLoftRad = 0.12; // Crisp ground-hugging stroke
      upwardVelRatio = 0.42;
      arcRadius = 0.78;
      break;
    case 'loft':
      peakBatSpeed = 30.5;
      baseLoftRad = 0.48; // ~27.5 deg elevated bat face for genuine aerial trajectory
      upwardVelRatio = 0.92;
      arcRadius = 0.88;
      break;
    case 'special':
      if (resolvedShot.swingFamily === 'behind_wicket_ramp') {
        peakBatSpeed = 14.5;
        baseLoftRad = 0.68; // ~39 deg scoop/ramp angle using bowler's pace to lift over keeper
        upwardVelRatio = 1.15;
        arcRadius = 0.48;
      } else {
        // Kneeling Sweep / Reverse Sweep / Paddle Sweep
        peakBatSpeed = resolvedShot.shotId === 'paddle_sweep' ? 16.5 : 26.0;
        baseLoftRad = resolvedShot.shotId === 'slog_sweep' ? 0.44 : 0.18;
        upwardVelRatio = resolvedShot.shotId === 'slog_sweep' ? 0.85 : 0.48;
        arcRadius = 0.74;
      }
      break;
  }

  // Family-specific overrides for cross-bat Cuts, Pulls, Hooks, Uppercuts
  if (resolvedShot.shotId === 'uppercut') {
    peakBatSpeed = 21.0;
    baseLoftRad = 0.62;
    upwardVelRatio = 1.05;
  } else if (resolvedShot.swingFamily === 'horizontal_cut') {
    peakBatSpeed = resolvedShot.shotIntent === 'loft' ? 28.0 : 25.5;
    baseLoftRad = resolvedShot.shotIntent === 'loft' ? 0.36 : 0.08;
  } else if (resolvedShot.swingFamily === 'horizontal_pull') {
    peakBatSpeed = resolvedShot.shotId === 'hook' ? 29.0 : 27.2;
    baseLoftRad = resolvedShot.shotId === 'hook' || resolvedShot.shotIntent === 'loft' ? 0.38 : 0.15;
  }

  const speedEnvelope = Math.exp(-Math.pow(relTime / 0.085, 2));
  const currentSpeed = isActiveSwing ? peakBatSpeed * speedEnvelope : 0;

  const arcAngle = Math.max(
    -1.2,
    Math.min(1.3, relTime * (resolvedShot.shotIntent === 'push' ? 4.5 : 9.5)),
  );
  const sinArc = Math.sin(arcAngle);

  // Instantaneous 3D blade center path at the contact plane:
  // Timing offset (relTime = simTimeSec - idealTime) shifts the blade along its swing arc:
  // - At relTime = 0 (Perfect timing), bladeCenter is at (clampedLineX, basePlaneY, targetHeightZ).
  // - Early/Late timing shifts the blade laterally and vertically along the stroke's swing path.
  const dirX = Math.sin(instantaneousYawRad);
  const dirY = -Math.cos(instantaneousYawRad);

  const isHorizontalBat =
    resolvedShot.swingFamily === 'horizontal_cut' ||
    resolvedShot.swingFamily === 'horizontal_pull' ||
    resolvedShot.swingFamily === 'kneeling_sweep';

  const centerX =
    clampedLineX +
    (isHorizontalBat ? relTime * 0.95 * handSign : relTime * 1.18 * handSign);
  const centerY = basePlaneY;
  const centerZ =
    targetHeightZ +
    (isHorizontalBat ? relTime * 1.05 : Math.pow(relTime * 3.2, 2) * 0.18);

  const loftPitchRad =
    baseLoftRad + (resolvedShot.shotIntent === 'push' ? 0 : sinArc * 0.2);
  const cosLoft = Math.cos(loftPitchRad);
  const sinLoft = Math.sin(loftPitchRad);

  // Face normal axisW points in the 3D direction (instantaneousYawRad, loftPitchRad)
  const axisW: CricketVec3 = normalizeVec3({
    x: dirX * cosLoft,
    y: dirY * cosLoft,
    z: sinLoft,
  });

  // Construct blade length axisV and width axisU based on vertical vs horizontal cross-bat swing plane:
  let axisU: CricketVec3;
  let axisV: CricketVec3;

  if (isHorizontalBat) {
    const horizPerp: CricketVec3 = normalizeVec3({
      x: -dirY * handSign,
      y: dirX * handSign,
      z: -0.22,
    });
    axisV = horizPerp;
    axisU = normalizeVec3(crossVec3(axisV, axisW));
  } else {
    axisU = normalizeVec3({
      x: Math.cos(instantaneousYawRad) * handSign,
      y: Math.sin(instantaneousYawRad) * handSign,
      z: 0,
    });
    axisV = normalizeVec3(crossVec3(axisW, axisU));
  }

  const bladeVelocity: CricketVec3 = {
    x: axisW.x * currentSpeed,
    y: axisW.y * currentSpeed,
    z: axisW.z * currentSpeed * upwardVelRatio,
  };

  return {
    bladeCenter: { x: centerX, y: centerY, z: centerZ },
    axisU,
    axisV,
    axisW,
    bladeVelocity,
    swingProgress: progress,
    isActiveSwing,
    resolvedShot,
  };
}

/**
 * Evaluates a single micro-substep for 3D intersection between the cricket ball sphere
 * and the moving 3D Oriented Bounding Box (OBB) of the bat blade as the ball crosses the
 * footwork contact plane.
 */
export function checkBatBallSubstepCollision(
  ballPos: CricketVec3,
  ballVel: CricketVec3,
  simTimeSec: number,
  input: BattingIntentInput,
): BatCollisionResult | null {
  if (input.footwork === 'leave' || input.swingTriggerTimeSec === null) {
    return null;
  }

  const pose = evaluateBatPoseAtTime(simTimeSec, input);
  if (!pose.isActiveSwing) {
    return null;
  }

  const ballRadius = BALL_CONSTANTS.RADIUS_METERS;
  const halfU = BAT_BLADE_DIMENSIONS.HALF_WIDTH_U;
  const halfV = BAT_BLADE_DIMENSIONS.HALF_LENGTH_V;
  const halfW = BAT_BLADE_DIMENSIONS.HALF_THICKNESS_W;

  // Check longitudinal crossing of the bat's contact plane Y
  const dyPlane = ballPos.y - pose.bladeCenter.y;
  if (dyPlane < -(halfW + ballRadius * 0.5) || dyPlane > halfW + ballRadius * 1.5) {
    return null;
  }

  // Timing window check: if the batter swung > 62ms early or late when the ball arrives at the contact plane,
  // the bat has already swept past (or hasn't entered) the hitting zone -> physical Play & Miss!
  const idealTime = input.swingTriggerTimeSec + BAT_BLADE_DIMENSIONS.PEAK_CONTACT_OFFSET_SEC;
  // Negative timingDeltaSec = EARLY swing (bat reached peak before ball arrived); Positive = LATE swing
  const timingDeltaSec = idealTime - simTimeSec;
  if (Math.abs(timingDeltaSec) > 0.062) {
    return null;
  }

  const handedness: BatterHandedness = input.handedness ?? 'RHB';
  const handSign = handedness === 'LHB' ? -1 : 1;
  const resolvedShot = pose.resolvedShot;

  const isHorizontalBat =
    resolvedShot.swingFamily === 'horizontal_cut' ||
    resolvedShot.swingFamily === 'horizontal_pull' ||
    resolvedShot.swingFamily === 'kneeling_sweep';

  // Spatial offset between ball center and blade center in the contact plane (X, Z)
  const dx = ballPos.x - pose.bladeCenter.x;
  const dz = ballPos.z - pose.bladeCenter.z;

  // Map spatial (dx, dz) onto the blade's width U (edge-to-edge) and length V (splice-to-toe) axes:
  // - For vertical-bat strokes: U is lateral across pitch (dx), V is vertical along blade length (-dz).
  // - For horizontal cross-bat strokes (Cut/Pull/Sweep): U is vertical across blade width (dz), V is lateral along blade length (dx).
  const localU = isHorizontalBat ? dz : dx * handSign;
  const localV = isHorizontalBat ? dx * handSign : -dz;

  const clampedU = Math.max(-halfU, Math.min(halfU, localU));
  const clampedV = Math.max(-halfV, Math.min(halfV, localV));

  const diffU = localU - clampedU;
  const diffV = localV - clampedV;
  const distSq = diffU * diffU + diffV * diffV;

  if (distSq > ballRadius * ballRadius) {
    return null;
  }

  // Physical 3D collision detected!
  const timingDeltaMs = Math.round(timingDeltaSec * 1000);
  const timingRating = classifyTimingRating(timingDeltaMs);

  // Normalized blade coordinates: normU in [-1, 1] across width, normV in [-1, 1] along length
  // Include timing-induced blade rotation offset when swinging significantly early or late (>18ms)
  const timingEdgeBias =
    Math.abs(timingDeltaMs) > 18 ? (-timingDeltaSec / 0.042) * 0.68 : 0;
  const normU = Math.max(-1, Math.min(1, localU / halfU + timingEdgeBias));
  const normV = localV / halfV;

  // Determine physical contact category from exact blade impact geometry
  let contactCategory: ContactQualityCategory = 'solid';
  if (Math.abs(normU) <= 0.45 && normV >= -0.45 && normV <= 0.55 && timingRating === 'perfect') {
    contactCategory = 'sweet_spot';
  } else if (isHorizontalBat) {
    if (normU > 0.56) contactCategory = 'top_edge';
    else if (normU < -0.56) contactCategory = 'bottom_edge';
    else if (normV > 0.8) contactCategory = 'toe';
    else if (normV < -0.75) contactCategory = 'inside_edge';
  } else {
    if (normU > 0.56) contactCategory = 'outside_edge';
    else if (normU < -0.56) contactCategory = 'inside_edge';
    else if (normV < -0.76) contactCategory = 'top_edge';
    else if (normV > 0.82) contactCategory = 'toe';
  }

  // Construct effective 3D surface normal at the impact point on the blade
  let edgeDeflectionU = 0;
  let edgeDeflectionV = 0;

  if (contactCategory === 'outside_edge' || (isHorizontalBat && contactCategory === 'top_edge')) {
    edgeDeflectionU = 0.82 + Math.min(0.35, (Math.abs(normU) - 0.56) * 0.8);
  } else if (
    contactCategory === 'inside_edge' ||
    (isHorizontalBat && contactCategory === 'bottom_edge')
  ) {
    edgeDeflectionU = -0.84 - Math.min(0.35, (Math.abs(normU) - 0.56) * 0.8);
  } else {
    edgeDeflectionU = normU * 0.16;
  }

  if (!isHorizontalBat && contactCategory === 'top_edge') {
    edgeDeflectionV = -0.75;
  } else if (contactCategory === 'toe' || (!isHorizontalBat && contactCategory === 'bottom_edge')) {
    edgeDeflectionV = 0.55;
  }

  const effectiveNormal = normalizeVec3({
    x: pose.axisW.x + pose.axisU.x * edgeDeflectionU + pose.axisV.x * edgeDeflectionV,
    y: pose.axisW.y + pose.axisU.y * edgeDeflectionU + pose.axisV.y * edgeDeflectionV,
    z: pose.axisW.z + pose.axisU.z * edgeDeflectionU + pose.axisV.z * edgeDeflectionV,
  });

  const isPush = resolvedShot.shotIntent === 'push';
  const isEdge =
    contactCategory === 'outside_edge' ||
    contactCategory === 'inside_edge' ||
    contactCategory === 'top_edge' ||
    contactCategory === 'bottom_edge';

  let outgoingVelocity: CricketVec3;

  if (isPush && !isEdge) {
    // Soft-hands defensive / placement push absorbs incoming momentum and places ball softly in the chosen direction
    const hasDirectionalPush = Math.abs(resolvedShot.relativeAngleDeg) > 18;
    const deadenSpeed = hasDirectionalPush
      ? contactCategory === 'sweet_spot'
        ? 6.4
        : 5.2
      : contactCategory === 'sweet_spot'
        ? 4.2
        : 3.2;
    outgoingVelocity = {
      x: effectiveNormal.x * deadenSpeed + ballVel.x * 0.08,
      y: effectiveNormal.y * deadenSpeed,
      z: Math.max(-1.0, effectiveNormal.z * deadenSpeed - 0.55),
    };
  } else if (resolvedShot.swingFamily === 'behind_wicket_ramp' && !isEdge) {
    // Ramp / Scoop: deflects incoming ball speed upward and backward (+Y) in the aimed behind-the-wicket sector
    const incomingSpeed = Math.hypot(ballVel.x, ballVel.y, ballVel.z);
    const qualityFactor = contactCategory === 'sweet_spot' ? 0.88 : 0.74;
    const timingPenalty = timingRating === 'perfect' || timingRating === 'good' ? 1.0 : 0.7;
    const redirectSpeed = Math.max(18, incomingSpeed * qualityFactor * timingPenalty) + 6.0;
    outgoingVelocity = {
      x: effectiveNormal.x * redirectSpeed,
      y: effectiveNormal.y * redirectSpeed,
      z: Math.max(6.8, effectiveNormal.z * redirectSpeed * 0.9),
    };
  } else {
    // Full 3D rigid-body restitution & moving bat impulse across 360 degrees
    let restitution = 0.62;
    if (contactCategory === 'sweet_spot') {
      restitution = resolvedShot.shotIntent === 'loft' ? 0.82 : 0.76;
    } else if (isEdge) {
      restitution = 0.42;
    } else if (contactCategory === 'toe') {
      restitution = 0.38;
    }

    const relVel: CricketVec3 = {
      x: ballVel.x - pose.bladeVelocity.x,
      y: ballVel.y - pose.bladeVelocity.y,
      z: ballVel.z - pose.bladeVelocity.z,
    };

    const relNormalSpeed = dotVec3(relVel, effectiveNormal);
    if (relNormalSpeed < 0) {
      const batTransfer = isEdge ? 0.32 : 0.96;
      const tangentialRetention = isEdge ? 0.88 : 0.16;
      const normalVelComponent = dotVec3(relVel, effectiveNormal);
      const tangVel: CricketVec3 = {
        x: (relVel.x - effectiveNormal.x * normalVelComponent) * tangentialRetention,
        y: (relVel.y - effectiveNormal.y * normalVelComponent) * tangentialRetention,
        z: (relVel.z - effectiveNormal.z * normalVelComponent) * tangentialRetention,
      };
      const bouncedNormalMag = -restitution * normalVelComponent;

      outgoingVelocity = {
        x:
          pose.bladeVelocity.x * batTransfer +
          tangVel.x +
          effectiveNormal.x * bouncedNormalMag,
        y:
          pose.bladeVelocity.y * batTransfer +
          tangVel.y +
          effectiveNormal.y * bouncedNormalMag,
        z:
          pose.bladeVelocity.z * batTransfer +
          tangVel.z +
          effectiveNormal.z * bouncedNormalMag,
      };
    } else {
      outgoingVelocity = {
        x: pose.bladeVelocity.x * 0.85 + effectiveNormal.x * 12,
        y: pose.bladeVelocity.y * 0.85 + effectiveNormal.y * 12,
        z: pose.bladeVelocity.z * 0.65 + effectiveNormal.z * 6,
      };
    }

    // Enforce ground vs lofted launch elevation distinction on clean contact
    if (!isEdge) {
      const horizSpd = Math.hypot(outgoingVelocity.x, outgoingVelocity.y);
      if (resolvedShot.shotIntent === 'stroke' && resolvedShot.shotId !== 'hook') {
        outgoingVelocity.z = Math.min(outgoingVelocity.z, horizSpd * 0.16);
      } else if (resolvedShot.shotIntent === 'loft' || resolvedShot.shotId === 'hook') {
        outgoingVelocity.z = Math.max(outgoingVelocity.z, horizSpd * 0.42);
      }
    }

    // Realistic cricket bat exit speed ceiling modulated by timing accuracy & contact quality
    const rawSpd = Math.hypot(outgoingVelocity.x, outgoingVelocity.y, outgoingVelocity.z);
    const baseMaxSpd = resolvedShot.shotIntent === 'loft' ? 42.8 : 39.5;
    const timingCapFactor = isEdge
      ? 0.66
      : Math.max(0.72, 1 - Math.abs(timingDeltaMs) * 0.0075);
    const maxSpd = baseMaxSpd * timingCapFactor;
    if (rawSpd > maxSpd) {
      const scale = maxSpd / rawSpd;
      outgoingVelocity.x *= scale;
      outgoingVelocity.y *= scale;
      outgoingVelocity.z *= scale;
    }
  }

  const exitSpeedMs = Math.hypot(
    outgoingVelocity.x,
    outgoingVelocity.y,
    outgoingVelocity.z,
  );
  const horizSpeedMs = Math.hypot(outgoingVelocity.x, outgoingVelocity.y);
  const launchElevationDeg = Number(
    ((Math.atan2(outgoingVelocity.z, Math.max(0.001, horizSpeedMs)) * 180) / Math.PI).toFixed(1),
  );
  const outgoingAzimuthDeg = Number(
    computeCricketAzimuthDeg(outgoingVelocity.x, outgoingVelocity.y).toFixed(1),
  );
  const outgoingSectorLabel = getFieldSectorLabel(outgoingAzimuthDeg, handedness);

  return {
    collided: true,
    contactCategory,
    timingRating,
    timingDeltaMs,
    bladeOffsetX: Number(localU.toFixed(4)),
    bladeOffsetY: Number(localV.toFixed(4)),
    outgoingVelocity,
    contactPoint: { ...ballPos },
    exitSpeedKmh: Math.round(exitSpeedMs * 3.6),
    launchElevationDeg,
    outgoingAzimuthDeg,
    outgoingSectorLabel,
    resolvedShot,
  };
}

export function classifyTimingRating(timingDeltaMs: number): TimingRating {
  const absMs = Math.abs(timingDeltaMs);
  if (absMs <= 16) return 'perfect';
  if (absMs <= 36) return 'good';
  return timingDeltaMs < 0 ? 'early' : 'late';
}

function dotVec3(a: CricketVec3, b: CricketVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossVec3(a: CricketVec3, b: CricketVec3): CricketVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVec3(v: CricketVec3): CricketVec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: -1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
