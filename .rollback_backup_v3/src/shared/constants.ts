/**
 * CREASE CLASH — Regulation Cricket Proportions, Wicket Geometry,
 * Configurable Boundary Specification, Locked Camera & Field Presets.
 *
 * All measurements are in meters in authoritative Cricket World Coordinates (X, Y, Z).
 */

import { CricketVec3 } from './coordinates';

/**
 * 1. REGULATION PITCH & CREASE DIMENSIONS (MCC Law 6 & Law 7)
 */
export const PITCH_CONSTANTS = {
  /** Distance from bowler's wicket line (Y=0) to striker's wicket line (22 yards = 20.1168m -> 20.12m) */
  LENGTH_METERS: 20.12,
  /** Longitudinal center of the pitch */
  MIDPOINT_Y: 10.06,
  /** Regulation width of the prepared pitch surface (10 feet = 3.048m -> 3.05m) */
  WIDTH_METERS: 3.05,
  /** Bowler's end bowling crease (stump line) Y coordinate */
  BOWLER_STUMPS_Y: 0.0,
  /** Striker's end bowling crease (stump line) Y coordinate */
  STRIKER_STUMPS_Y: 20.12,
  /** Popping crease offset in front of each bowling crease (4 feet = 1.2192m -> 1.22m) */
  POPPING_CREASE_OFFSET: 1.22,
  /** Bowler's end popping crease Y coordinate */
  BOWLER_POPPING_CREASE_Y: 1.22,
  /** Striker's end popping crease Y coordinate */
  STRIKER_POPPING_CREASE_Y: 20.12 - 1.22, // 18.90m
  /** Distance between return creases (8 feet 8 inches = 2.6416m -> 2.64m; ±1.32m from X=0) */
  RETURN_CREASE_SPAN_X: 2.64,
  /** Half-width to each return crease from center line X=0 */
  RETURN_CREASE_HALF_X: 1.32,
  /** Length of bowling crease painted line (8 feet 8 inches = 2.64m) */
  BOWLING_CREASE_WIDTH_X: 2.64,
  /** Visible painted width of popping crease (minimum 12 feet = 3.66m) */
  POPPING_CREASE_WIDTH_X: 3.66,
  /** Return crease extension behind bowling crease (minimum 4 feet = 1.22m, we draw 2.44m total) */
  RETURN_CREASE_BACK_EXTENSION: 1.22,
  /** Wide guideline offset from middle stump for limited-overs (0.89m inside return crease) */
  WIDE_GUIDELINE_X: 0.89,
  /** Painted line thickness (meters) */
  LINE_WIDTH_METERS: 0.05,
} as const;

/**
 * 2. REGULATION WICKET, STUMP & BAIL GEOMETRY (MCC Law 8)
 *
 * - Total wicket width across 3 stumps = 0.2286m (9 inches).
 * - Stump height above ground = 0.711m (28 inches).
 * - Selected maximum regulation stump diameter = 0.0381m (1.5 inches; radius = 0.01905m).
 * - Bails are modeled separately resting in top spigot grooves above Z = 0.711m.
 */
export interface StumpSpec {
  id: 'leg' | 'middle' | 'off';
  label: string;
  centerX: number;
  heightZ: number;
  diameter: number;
  radius: number;
}

export interface BailSpec {
  id: 'leg_middle' | 'middle_off';
  label: string;
  centerX: number;
  restingBaseZ: number;
  overallLength: number;
  barrelLength: number;
  longSpigotLength: number;
  shortSpigotLength: number;
  barrelRadius: number;
  spigotRadius: number;
}

const STUMP_DIAMETER = 0.0381; // 1.5 in
const STUMP_RADIUS = STUMP_DIAMETER / 2; // 0.01905m
const TOTAL_WICKET_WIDTH = 0.2286; // 9.0 in
const HALF_WICKET_WIDTH = TOTAL_WICKET_WIDTH / 2; // 0.1143m
// Outer edge of leg/off stump aligns with ±HALF_WICKET_WIDTH (±0.1143m)
const OUTER_STUMP_CENTER_X = Number((HALF_WICKET_WIDTH - STUMP_RADIUS).toFixed(5)); // 0.09525m
// Clear gap between adjacent stumps = 0.09525 - 0.0381 = 0.05715m (2.25 in)
const STUMP_GAP = Number((OUTER_STUMP_CENTER_X - STUMP_DIAMETER).toFixed(5)); // 0.05715m

export const WICKET_CONSTANTS = {
  /** Regulation height of the top of the stumps above the ground (28 inches = 0.7112m -> 0.711m) */
  STUMP_HEIGHT_Z: 0.711,
  /** Regulation total width of the wicket across the 3 stumps (9 inches = 0.2286m) */
  TOTAL_WIDTH_X: TOTAL_WICKET_WIDTH,
  /** Maximum regulation stump diameter (1.5 inches = 0.0381m) */
  STUMP_DIAMETER_METERS: STUMP_DIAMETER,
  /** Stump radius (0.01905m) */
  STUMP_RADIUS_METERS: STUMP_RADIUS,
  /** Center X offset of off and leg stumps (±0.09525m) */
  OUTER_STUMP_CENTER_X,
  /** Clear horizontal gap between adjacent stumps (0.05715m < 0.072m ball diameter) */
  ADJACENT_STUMP_GAP_METERS: STUMP_GAP,
  /** Individual bail overall length (4 5/16 inches = 0.1095m) */
  BAIL_OVERALL_LENGTH: 0.1095,
  /** Bail central barrel length (2 1/8 inches = 0.054m) */
  BAIL_BARREL_LENGTH: 0.054,
  /** Bail longer spigot length (1 3/8 inches = 0.0349m) */
  BAIL_LONG_SPIGOT_LENGTH: 0.0349,
  /** Bail shorter spigot length (13/16 inch = 0.0206m) */
  BAIL_SHORT_SPIGOT_LENGTH: 0.0206,
  /** Bail barrel radius (0.0085m) */
  BAIL_BARREL_RADIUS: 0.0085,
  /** Bail spigot radius (0.0045m) */
  BAIL_SPIGOT_RADIUS: 0.0045,
  /** Total height of wicket including resting bail barrel above stump top (~0.723m) */
  TOTAL_HEIGHT_WITH_BAILS_Z: 0.711 + 0.012,

  /** Individual Stump Definitions (for Right-Handed Batter at Striker's End: -X is Leg, +X is Off) */
  STUMPS: [
    {
      id: 'leg',
      label: 'Leg Stump',
      centerX: -OUTER_STUMP_CENTER_X,
      heightZ: 0.711,
      diameter: STUMP_DIAMETER,
      radius: STUMP_RADIUS,
    },
    {
      id: 'middle',
      label: 'Middle Stump',
      centerX: 0,
      heightZ: 0.711,
      diameter: STUMP_DIAMETER,
      radius: STUMP_RADIUS,
    },
    {
      id: 'off',
      label: 'Off Stump',
      centerX: OUTER_STUMP_CENTER_X,
      heightZ: 0.711,
      diameter: STUMP_DIAMETER,
      radius: STUMP_RADIUS,
    },
  ] as readonly StumpSpec[],

  /** Individual Bail Definitions modeled separately above Z = 0.711m */
  BAILS: [
    {
      id: 'leg_middle',
      label: 'Leg-Middle Bail',
      centerX: -OUTER_STUMP_CENTER_X / 2, // -0.047625m
      restingBaseZ: 0.711,
      overallLength: 0.1095,
      barrelLength: 0.054,
      longSpigotLength: 0.0349,
      shortSpigotLength: 0.0206,
      barrelRadius: 0.0085,
      spigotRadius: 0.0045,
    },
    {
      id: 'middle_off',
      label: 'Middle-Off Bail',
      centerX: OUTER_STUMP_CENTER_X / 2, // +0.047625m
      restingBaseZ: 0.711,
      overallLength: 0.1095,
      barrelLength: 0.054,
      longSpigotLength: 0.0349,
      shortSpigotLength: 0.0206,
      barrelRadius: 0.0085,
      spigotRadius: 0.0045,
    },
  ] as readonly BailSpec[],
} as const;

/**
 * 3. REGULATION CRICKET BALL SPECIFICATION (MCC Law 4)
 */
export type BallColorVariant = 'red' | 'white' | 'pink';

export const BALL_CONSTANTS = {
  /** Regulation mass (0.156 kg / 5.5 oz) */
  MASS_KG: 0.156,
  /** Regulation diameter (0.072m / 2.83 in) */
  DIAMETER_METERS: 0.072,
  /** Regulation radius (0.036m) */
  RADIUS_METERS: 0.036,
  /** Subtle minimum visual screen-readability scale multiplier at far distances */
  READABILITY_SCALE_FAR: 1.38,
} as const;

/**
 * 4. CONFIGURABLE BOUNDARY SPECIFICATION
 *
 * Supports oval/elliptical or circular grounds centered at the pitch midpoint (X=0, Y=10.06m).
 */
export interface BoundaryConfig {
  id: string;
  name: string;
  /** Center X of the oval (default 0) */
  centerX: number;
  /** Center Y of the oval (default 10.06m, pitch midpoint) */
  centerY: number;
  /** Square boundary radius along X axis (meters, e.g., 64m) */
  squareBoundaryMeters: number;
  /** Straight boundary radius along Y axis from pitch midpoint (meters, e.g., 68m) */
  straightBoundaryMeters: number;
  /** Extra turf buffer beyond boundary rope to stadium perimeter wall (meters) */
  outfieldMarginMeters: number;
}

export const DEFAULT_BOUNDARY_CONFIG: BoundaryConfig = {
  id: 'standard_oval',
  name: 'Crown Oval (68m Straight / 64m Square)',
  centerX: 0,
  centerY: PITCH_CONSTANTS.MIDPOINT_Y,
  squareBoundaryMeters: 64.0,
  straightBoundaryMeters: 68.0,
  outfieldMarginMeters: 8.5,
};

export const BOUNDARY_PRESETS: readonly BoundaryConfig[] = [
  DEFAULT_BOUNDARY_CONFIG,
  {
    id: 'compact_t20',
    name: 'Compact Arena (60m Straight / 56m Square)',
    centerX: 0,
    centerY: PITCH_CONSTANTS.MIDPOINT_Y,
    squareBoundaryMeters: 56.0,
    straightBoundaryMeters: 60.0,
    outfieldMarginMeters: 7.5,
  },
  {
    id: 'grand_melbourne',
    name: 'Grand Colosseum (76m Straight / 70m Square)',
    centerX: 0,
    centerY: PITCH_CONSTANTS.MIDPOINT_Y,
    squareBoundaryMeters: 70.0,
    straightBoundaryMeters: 76.0,
    outfieldMarginMeters: 9.0,
  },
];

/**
 * Returns the exact boundary distance from (centerX, centerY) at polar angle theta
 * (where theta = 0 is straight down +Y, theta = pi/2 is square toward +X).
 */
export function getBoundaryRadiusAtAngle(thetaRadians: number, config: BoundaryConfig = DEFAULT_BOUNDARY_CONFIG): number {
  const sinT = Math.sin(thetaRadians); // X component
  const cosT = Math.cos(thetaRadians); // Y component
  const rx = config.squareBoundaryMeters;
  const ry = config.straightBoundaryMeters;
  const denom = Math.hypot(sinT / rx, cosT / ry);
  return denom > 0 ? 1 / denom : Math.min(rx, ry);
}

/**
 * Evaluates normalized elliptical radius squared:
 *   ((x - cx) / Rx)^2 + ((y - cy) / Ry)^2
 * Value >= 1.0 means the point has reached or crossed the boundary rope.
 */
export function getNormalizedBoundaryRatio(
  x: number,
  y: number,
  config: BoundaryConfig = DEFAULT_BOUNDARY_CONFIG,
): number {
  const dx = (x - config.centerX) / config.squareBoundaryMeters;
  const dy = (y - config.centerY) / config.straightBoundaryMeters;
  return Math.hypot(dx, dy);
}

export function isBeyondBoundary(
  x: number,
  y: number,
  config: BoundaryConfig = DEFAULT_BOUNDARY_CONFIG,
): boolean {
  return getNormalizedBoundaryRatio(x, y, config) >= 1.0;
}

/**
 * Clamps a world (X, Y) position so it stays inside the playable boundary rope by `marginMeters`.
 */
export function clampToFieldPerimeter(
  x: number,
  y: number,
  config: BoundaryConfig = DEFAULT_BOUNDARY_CONFIG,
  marginMeters = 1.5,
): { x: number; y: number } {
  const dx = x - config.centerX;
  const dy = y - config.centerY;
  const rx = Math.max(10, config.squareBoundaryMeters - marginMeters);
  const ry = Math.max(10, config.straightBoundaryMeters - marginMeters);
  const norm = Math.hypot(dx / rx, dy / ry);
  if (norm <= 1.0) {
    return { x, y };
  }
  return {
    x: config.centerX + dx / norm,
    y: config.centerY + dy / norm,
  };
}

/**
 * 5. LOCKED BEHIND-THE-BOWLER GAMEPLAY CAMERA SPECIFICATION
 *
 * Positioned behind and above the bowler's run-up end looking down the length of the pitch
 * toward the striker's wicket.
 *
 * - Camera Position: (X = 0.0m, Y = -11.8m, Z = 9.6m)
 * - LookAt Target:   (X = 0.0m, Y = 11.2m,  Z = 0.45m)
 * - Horizontal distance = 23.0m, vertical drop = 9.15m -> Downward viewing angle = 21.69 degrees.
 * - Vertical FOV = 35 degrees.
 *
 * This framing keeps:
 * - The bowler's run-up and release in the lower foreground.
 * - Both sets of stumps, bails, and creases clearly separated along the vertical center axis.
 * - The striker, wicketkeeper, slip cordon, and surrounding infield/outfield readable.
 * - The entire ball flight corridor unobstructed.
 */
export interface LockedCameraSpec {
  position: CricketVec3;
  lookAt: CricketVec3;
  fovDegrees: number;
  near: number;
  far: number;
}

export const LOCKED_GAMEPLAY_CAMERA: LockedCameraSpec = {
  position: { x: 0.0, y: -15.8, z: 8.2 },
  lookAt: { x: 0.0, y: 8.8, z: 0.5 },
  fovDegrees: 26,
  near: 0.5,
  far: 260,
};

/**
 * 6. CORE ON-FIELD ACTOR POSITIONS & TACTICAL FIELD PRESETS (IN CRICKET X, Y, Z)
 */
export interface FielderPlacement {
  id: string;
  roleName: string;
  position: CricketVec3;
}

export interface FieldPreset {
  id: 'attacking' | 'balanced' | 'defensive' | 'boundary_protection';
  name: string;
  description: string;
  fielders: readonly FielderPlacement[];
}

export const CORE_ACTOR_POSITIONS = {
  /** Bowler starting mark at top of run-up in near foreground (over the wicket left of stumps) */
  BOWLER_RUNUP_START: { x: -0.52, y: -2.4, z: 0.0 } as CricketVec3,
  /** Bowler release crease position (over the wicket, right-arm) */
  BOWLER_RELEASE_POINT: { x: -0.36, y: 1.15, z: 2.08 } as CricketVec3,
  /** Striker ready stance at striker's popping crease (slightly leg-side so all 3 stumps behind are visible) */
  STRIKER_STANCE: { x: -0.28, y: 18.82, z: 0.0 } as CricketVec3,
  /** Non-striker backing up beside bowler's end popping crease */
  NON_STRIKER_STANCE: { x: -1.42, y: 1.18, z: 0.0 } as CricketVec3,
  /** Wicketkeeper crouched behind striker's stumps on off-side */
  WICKETKEEPER_NORMAL: { x: 0.34, y: 22.8, z: 0.0 } as CricketVec3,
  /** Pitch Umpire standing at bowler's end just off the stump line so bowler's wicket is 100% visible */
  UMPIRE_STANDING: { x: 0.44, y: -1.35, z: 0.0 } as CricketVec3,
} as const;

export const FIELD_PRESETS: readonly FieldPreset[] = [
  {
    id: 'attacking',
    name: 'Attacking Slip Cordon',
    description: 'Two slips, gully, catching cover and midwicket pressing for early wickets.',
    fielders: [
      { id: 'f1', roleName: 'First Slip', position: { x: 1.85, y: 23.4, z: 0 } },
      { id: 'f2', roleName: 'Second Slip', position: { x: 2.95, y: 23.1, z: 0 } },
      { id: 'f3', roleName: 'Gully', position: { x: 6.2, y: 20.6, z: 0 } },
      { id: 'f4', roleName: 'Point', position: { x: 15.5, y: 18.8, z: 0 } },
      { id: 'f5', roleName: 'Cover', position: { x: 14.2, y: 11.5, z: 0 } },
      { id: 'f6', roleName: 'Mid-Off', position: { x: 8.5, y: -3.5, z: 0 } },
      { id: 'f7', roleName: 'Mid-On', position: { x: -8.5, y: -3.2, z: 0 } },
      { id: 'f8', roleName: 'Short Midwicket', position: { x: -11.5, y: 13.0, z: 0 } },
      { id: 'f9', roleName: 'Fine Leg', position: { x: -18.0, y: 36.0, z: 0 } },
    ],
  },
  {
    id: 'balanced',
    name: 'Balanced Powerplay',
    description: 'Single slip, ring protection through covers and midwicket, two boundary sweepers.',
    fielders: [
      { id: 'f1', roleName: 'First Slip', position: { x: 2.1, y: 23.3, z: 0 } },
      { id: 'f2', roleName: 'Backward Point', position: { x: 16.5, y: 20.5, z: 0 } },
      { id: 'f3', roleName: 'Cover', position: { x: 17.0, y: 12.0, z: 0 } },
      { id: 'f4', roleName: 'Mid-Off', position: { x: 10.2, y: -5.0, z: 0 } },
      { id: 'f5', roleName: 'Mid-On', position: { x: -10.2, y: -4.8, z: 0 } },
      { id: 'f6', roleName: 'Midwicket', position: { x: -16.8, y: 11.5, z: 0 } },
      { id: 'f7', roleName: 'Square Leg', position: { x: -16.0, y: 19.2, z: 0 } },
      { id: 'f8', roleName: 'Deep Cover-Point', position: { x: 46.0, y: 16.0, z: 0 } },
      { id: 'f9', roleName: 'Deep Midwicket', position: { x: -46.0, y: 12.0, z: 0 } },
    ],
  },
  {
    id: 'defensive',
    name: 'Defensive Ring & Riders',
    description: 'Spread field cutting off singles and gaps on both sides of the wicket.',
    fielders: [
      { id: 'f1', roleName: 'Third Man', position: { x: 28.0, y: 44.0, z: 0 } },
      { id: 'f2', roleName: 'Point', position: { x: 18.5, y: 18.8, z: 0 } },
      { id: 'f3', roleName: 'Extra Cover', position: { x: 18.0, y: 9.0, z: 0 } },
      { id: 'f4', roleName: 'Long-Off', position: { x: 18.0, y: -38.0, z: 0 } },
      { id: 'f5', roleName: 'Long-On', position: { x: -18.0, y: -38.0, z: 0 } },
      { id: 'f6', roleName: 'Midwicket', position: { x: -18.5, y: 11.0, z: 0 } },
      { id: 'f7', roleName: 'Deep Square Leg', position: { x: -48.0, y: 19.5, z: 0 } },
      { id: 'f8', roleName: 'Deep Cover', position: { x: 47.0, y: 9.5, z: 0 } },
      { id: 'f9', roleName: 'Short Fine Leg', position: { x: -11.5, y: 27.5, z: 0 } },
    ],
  },
  {
    id: 'boundary_protection',
    name: 'Death Overs Boundary Riders',
    description: 'Five boundary riders protecting straight and square ropes against lofted shots.',
    fielders: [
      { id: 'f1', roleName: 'Third Man', position: { x: 32.0, y: 46.0, z: 0 } },
      { id: 'f2', roleName: 'Deep Point', position: { x: 50.0, y: 19.0, z: 0 } },
      { id: 'f3', roleName: 'Cover', position: { x: 16.0, y: 12.5, z: 0 } },
      { id: 'f4', roleName: 'Long-Off', position: { x: 20.0, y: -42.0, z: 0 } },
      { id: 'f5', roleName: 'Long-On', position: { x: -20.0, y: -42.0, z: 0 } },
      { id: 'f6', roleName: 'Midwicket', position: { x: -15.5, y: 12.5, z: 0 } },
      { id: 'f7', roleName: 'Deep Midwicket', position: { x: -48.0, y: 10.0, z: 0 } },
      { id: 'f8', roleName: 'Deep Square Leg', position: { x: -50.0, y: 22.0, z: 0 } },
      { id: 'f9', roleName: 'Fine Leg', position: { x: -13.0, y: 27.0, z: 0 } },
    ],
  },
];
