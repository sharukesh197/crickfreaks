/**
 * CREASE CLASH — Competitive Bowling Delivery Library & Aerodynamic / Pitch-Bounce Profiles
 *
 * Defines the complete Pace/Seam and Spin delivery repertoire with authentic:
 * - Speed ranges (km/h)
 * - Pre-bounce aerodynamic swing / Magnus drift accelerations (m/s^2)
 * - Magnified overspin/underspin vertical dip accelerations (m/s^2)
 * - Pitch bounce vertical restitution and longitudinal grip/skid friction
 * - Post-bounce seam/spin lateral deviation off the pitch
 * - Release execution accuracy & over-effort scatter model
 */

export type MovementVariant =
  // Pace & Seam Arsenal
  | 'straight'
  | 'seam_straight'
  | 'fast_stock'
  | 'medium_stock'
  | 'outswing'
  | 'inswing'
  | 'off_cutter'
  | 'leg_cutter'
  | 'slower_ball'
  | 'bouncer'
  | 'yorker_special'
  // Spin Arsenal
  | 'off_spin'
  | 'arm_ball'
  | 'top_spinner'
  | 'leg_spin'
  | 'googly'
  | 'slider';

export type DeliveryCategory = 'pace' | 'spin';

export interface DeliveryArchetypeSpec {
  id: MovementVariant;
  label: string;
  shortTag: string;
  category: DeliveryCategory;
  defaultSpeedKmh: number;
  minSpeedKmh: number;
  maxSpeedKmh: number;
  /** Lateral aerodynamic acceleration in air before pitch bounce (+X is off-side for RHB) */
  airSwingOrDriftAccelX: number;
  /** Vertical Magnus acceleration in air (negative = top-spin dip, positive = back-spin lift) */
  airMagnusAccelZ: number;
  /** Post-bounce residual lateral swing/drift multiplier */
  postBounceAirRatio: number;
  /** Base vertical bounce restitution on a good-length pitch */
  baseRestitutionZ: number;
  /** Longitudinal pitch friction multiplier (lower = grips & slows more; higher = skids on) */
  pitchLongitudinalRetentionY: number;
  /** Lateral velocity impulse (m/s at nominal speed) imparted by seam or spin at pitch bounce (+X is toward RHB off-side) */
  pitchLateralDeflectionVx: number;
  /** Visual spin rate (rad/s) for ball seam rotation */
  spinRateRadSec: number;
  /** Seam cant angle (radians) */
  seamAngleRad: number;
  description: string;
}

export const DELIVERY_LIBRARY: Record<MovementVariant, DeliveryArchetypeSpec> = {
  straight: {
    id: 'straight',
    label: 'Fast Stock Seam',
    shortTag: 'FAST',
    category: 'pace',
    defaultSpeedKmh: 138,
    minSpeedKmh: 128,
    maxSpeedKmh: 150,
    airSwingOrDriftAccelX: 0,
    airMagnusAccelZ: 0,
    postBounceAirRatio: 0,
    baseRestitutionZ: 0.56,
    pitchLongitudinalRetentionY: 0.86,
    pitchLateralDeflectionVx: 0,
    spinRateRadSec: 22,
    seamAngleRad: 0,
    description: 'Hard-hitting upright-seam stock delivery carrying through true off the pitch.',
  },
  seam_straight: {
    id: 'seam_straight',
    label: 'Express Seam',
    shortTag: 'EXPR',
    category: 'pace',
    defaultSpeedKmh: 146,
    minSpeedKmh: 138,
    maxSpeedKmh: 150,
    airSwingOrDriftAccelX: 0,
    airMagnusAccelZ: 0.15,
    postBounceAirRatio: 0,
    baseRestitutionZ: 0.58,
    pitchLongitudinalRetentionY: 0.88,
    pitchLateralDeflectionVx: 0.08,
    spinRateRadSec: 26,
    seamAngleRad: 0.05,
    description: 'High-pace hit-the-deck seam delivery skidding onto the bat.',
  },
  fast_stock: {
    id: 'fast_stock',
    label: 'Fast Stock',
    shortTag: 'FAST',
    category: 'pace',
    defaultSpeedKmh: 140,
    minSpeedKmh: 132,
    maxSpeedKmh: 150,
    airSwingOrDriftAccelX: 0.18,
    airMagnusAccelZ: 0,
    postBounceAirRatio: 0.1,
    baseRestitutionZ: 0.56,
    pitchLongitudinalRetentionY: 0.86,
    pitchLateralDeflectionVx: 0.12,
    spinRateRadSec: 24,
    seamAngleRad: 0.08,
    description: 'Crisp fast-bowling stock ball with subtle natural away movement.',
  },
  medium_stock: {
    id: 'medium_stock',
    label: 'Medium Wobble Seam',
    shortTag: 'MED',
    category: 'pace',
    defaultSpeedKmh: 126,
    minSpeedKmh: 116,
    maxSpeedKmh: 134,
    airSwingOrDriftAccelX: 0.25,
    airMagnusAccelZ: -0.15,
    postBounceAirRatio: 0.15,
    baseRestitutionZ: 0.53,
    pitchLongitudinalRetentionY: 0.84,
    pitchLateralDeflectionVx: -0.28,
    spinRateRadSec: 20,
    seamAngleRad: -0.12,
    description: 'Accurate medium-pace wobble seam that nips back off the surface.',
  },
  outswing: {
    id: 'outswing',
    label: 'Outswinger',
    shortTag: 'OUT',
    category: 'pace',
    defaultSpeedKmh: 136,
    minSpeedKmh: 124,
    maxSpeedKmh: 146,
    airSwingOrDriftAccelX: 1.65,
    airMagnusAccelZ: -0.1,
    postBounceAirRatio: 0.28,
    baseRestitutionZ: 0.55,
    pitchLongitudinalRetentionY: 0.86,
    pitchLateralDeflectionVx: 0.44,
    spinRateRadSec: 24,
    seamAngleRad: 0.34,
    description: 'Late conventional outswing curving away toward the slips.',
  },
  inswing: {
    id: 'inswing',
    label: 'Inswinger',
    shortTag: 'IN',
    category: 'pace',
    defaultSpeedKmh: 136,
    minSpeedKmh: 124,
    maxSpeedKmh: 146,
    airSwingOrDriftAccelX: -1.65,
    airMagnusAccelZ: -0.1,
    postBounceAirRatio: 0.28,
    baseRestitutionZ: 0.55,
    pitchLongitudinalRetentionY: 0.86,
    pitchLateralDeflectionVx: -0.44,
    spinRateRadSec: 24,
    seamAngleRad: -0.34,
    description: 'Booming inswinger tailing back into the pads and stumps.',
  },
  off_cutter: {
    id: 'off_cutter',
    label: 'Off-Cutter',
    shortTag: 'OCUT',
    category: 'pace',
    defaultSpeedKmh: 125,
    minSpeedKmh: 114,
    maxSpeedKmh: 135,
    airSwingOrDriftAccelX: 0.15,
    airMagnusAccelZ: -0.35,
    postBounceAirRatio: 0.1,
    baseRestitutionZ: 0.51,
    pitchLongitudinalRetentionY: 0.79,
    pitchLateralDeflectionVx: -0.78,
    spinRateRadSec: 48,
    seamAngleRad: -0.26,
    description: 'Fingers rolled down the outside of the ball; grips and cuts sharply in off the pitch.',
  },
  leg_cutter: {
    id: 'leg_cutter',
    label: 'Leg-Cutter',
    shortTag: 'LCUT',
    category: 'pace',
    defaultSpeedKmh: 125,
    minSpeedKmh: 114,
    maxSpeedKmh: 135,
    airSwingOrDriftAccelX: -0.15,
    airMagnusAccelZ: -0.35,
    postBounceAirRatio: 0.1,
    baseRestitutionZ: 0.51,
    pitchLongitudinalRetentionY: 0.79,
    pitchLateralDeflectionVx: 0.78,
    spinRateRadSec: 48,
    seamAngleRad: 0.26,
    description: 'Fingers pulled across the seam; grips the surface and jags away toward off-side.',
  },
  slower_ball: {
    id: 'slower_ball',
    label: 'Slower Dipper',
    shortTag: 'SLOW',
    category: 'pace',
    defaultSpeedKmh: 112,
    minSpeedKmh: 102,
    maxSpeedKmh: 122,
    airSwingOrDriftAccelX: 0.35,
    airMagnusAccelZ: -0.85,
    postBounceAirRatio: 0.15,
    baseRestitutionZ: 0.48,
    pitchLongitudinalRetentionY: 0.76,
    pitchLateralDeflectionVx: -0.22,
    spinRateRadSec: 42,
    seamAngleRad: -0.18,
    description: 'Back-of-the-hand slower ball that dips late and holds up in the surface to deceive timing.',
  },
  bouncer: {
    id: 'bouncer',
    label: 'Short Bouncer',
    shortTag: 'BNCR',
    category: 'pace',
    defaultSpeedKmh: 142,
    minSpeedKmh: 132,
    maxSpeedKmh: 150,
    airSwingOrDriftAccelX: -0.18,
    airMagnusAccelZ: 0.1,
    postBounceAirRatio: 0.1,
    baseRestitutionZ: 0.415,
    pitchLongitudinalRetentionY: 0.87,
    pitchLateralDeflectionVx: -0.12,
    spinRateRadSec: 26,
    seamAngleRad: -0.08,
    description: 'Steeply rising short-pitched bumper climbing toward the badge and splice.',
  },
  yorker_special: {
    id: 'yorker_special',
    label: 'Inswinging Yorker',
    shortTag: 'YORK',
    category: 'pace',
    defaultSpeedKmh: 142,
    minSpeedKmh: 132,
    maxSpeedKmh: 150,
    airSwingOrDriftAccelX: -1.35,
    airMagnusAccelZ: -0.65,
    postBounceAirRatio: 0.3,
    baseRestitutionZ: 0.46,
    pitchLongitudinalRetentionY: 0.88,
    pitchLateralDeflectionVx: -0.35,
    spinRateRadSec: 25,
    seamAngleRad: -0.3,
    description: 'Searing late-dipping yorker aimed right underneath the bat toe.',
  },
  off_spin: {
    id: 'off_spin',
    label: 'Off-Break',
    shortTag: 'OSPN',
    category: 'spin',
    defaultSpeedKmh: 88,
    minSpeedKmh: 78,
    maxSpeedKmh: 98,
    airSwingOrDriftAccelX: 0.78, // Drifts toward off before turning in
    airMagnusAccelZ: -0.95, // Overspin loop & dip
    postBounceAirRatio: 0.12,
    baseRestitutionZ: 0.55,
    pitchLongitudinalRetentionY: 0.77,
    pitchLateralDeflectionVx: -1.18, // Sharp turn into RHB (-X)
    spinRateRadSec: 110,
    seamAngleRad: -0.38,
    description: 'Flighted finger-spin that drifts away in the air and turns sharply back into the gate.',
  },
  arm_ball: {
    id: 'arm_ball',
    label: 'Arm Ball',
    shortTag: 'ARM',
    category: 'spin',
    defaultSpeedKmh: 94,
    minSpeedKmh: 84,
    maxSpeedKmh: 104,
    airSwingOrDriftAccelX: 0.65,
    airMagnusAccelZ: -0.35,
    postBounceAirRatio: 0.25,
    baseRestitutionZ: 0.5,
    pitchLongitudinalRetentionY: 0.86,
    pitchLateralDeflectionVx: 0.22, // Skids on with the arm toward +X instead of turning in!
    spinRateRadSec: 75,
    seamAngleRad: 0.15,
    description: 'Delivered from an off-break action with upright seam; drifts away and skids straight on.',
  },
  top_spinner: {
    id: 'top_spinner',
    label: 'Top-Spinner',
    shortTag: 'TOPS',
    category: 'spin',
    defaultSpeedKmh: 89,
    minSpeedKmh: 80,
    maxSpeedKmh: 98,
    airSwingOrDriftAccelX: 0.15,
    airMagnusAccelZ: -1.45, // Heavy overspin dip in flight
    postBounceAirRatio: 0.1,
    baseRestitutionZ: 0.63, // Extra bounce off the pitch!
    pitchLongitudinalRetentionY: 0.83,
    pitchLateralDeflectionVx: -0.18,
    spinRateRadSec: 118,
    seamAngleRad: 0.0,
    description: 'Heavy overspin causes the ball to dip sharply before kicking up high off the surface.',
  },
  leg_spin: {
    id: 'leg_spin',
    label: 'Leg-Break',
    shortTag: 'LSPN',
    category: 'spin',
    defaultSpeedKmh: 86,
    minSpeedKmh: 76,
    maxSpeedKmh: 96,
    airSwingOrDriftAccelX: -0.82, // Drifts toward leg before ripping away
    airMagnusAccelZ: -1.05,
    postBounceAirRatio: 0.12,
    baseRestitutionZ: 0.57,
    pitchLongitudinalRetentionY: 0.76,
    pitchLateralDeflectionVx: 1.32, // Ripping leg-break turn toward off-side (+X)
    spinRateRadSec: 125,
    seamAngleRad: 0.42,
    description: 'Wrist-spun leg-break with loop, drift toward leg, and vicious away turn off the pitch.',
  },
  googly: {
    id: 'googly',
    label: 'Googly (Wrong’un)',
    shortTag: 'GGLY',
    category: 'spin',
    defaultSpeedKmh: 87,
    minSpeedKmh: 78,
    maxSpeedKmh: 96,
    airSwingOrDriftAccelX: -0.45, // Looks like leg-spin in flight
    airMagnusAccelZ: -0.95,
    postBounceAirRatio: 0.12,
    baseRestitutionZ: 0.55,
    pitchLongitudinalRetentionY: 0.78,
    pitchLateralDeflectionVx: -1.15, // Turns sharply IN (-X) the opposite way!
    spinRateRadSec: 118,
    seamAngleRad: -0.38,
    description: 'Deceptive wrist-spin wrong’un released out of the back of the hand, turning sharply into the RHB.',
  },
  slider: {
    id: 'slider',
    label: 'Slider / Flipper',
    shortTag: 'SLDR',
    category: 'spin',
    defaultSpeedKmh: 94,
    minSpeedKmh: 84,
    maxSpeedKmh: 104,
    airSwingOrDriftAccelX: -0.25,
    airMagnusAccelZ: 0.45, // Back-spin floats slightly longer
    postBounceAirRatio: 0.15,
    baseRestitutionZ: 0.44, // Skids low!
    pitchLongitudinalRetentionY: 0.89, // Skids on fast off the surface!
    pitchLateralDeflectionVx: 0.18,
    spinRateRadSec: 105,
    seamAngleRad: 0.12,
    description: 'Back-spinning wrist delivery that floats in the air and skids low and fast through the crease.',
  },
};

export const PACE_DELIVERY_VARIANTS: readonly MovementVariant[] = [
  'straight',
  'outswing',
  'inswing',
  'off_cutter',
  'leg_cutter',
  'slower_ball',
  'bouncer',
  'yorker_special',
];

export const SPIN_DELIVERY_VARIANTS: readonly MovementVariant[] = [
  'off_spin',
  'arm_ball',
  'top_spinner',
  'leg_spin',
  'googly',
  'slider',
];

export function getDeliverySpec(movement: MovementVariant): DeliveryArchetypeSpec {
  return DELIVERY_LIBRARY[movement] ?? DELIVERY_LIBRARY.straight;
}

/**
 * Evaluates bowler release execution accuracy & scatter.
 * - When `releaseAccuracy01 = 1.0` (default / perfect release), zero scatter is applied and
 *   100% of swing/seam/spin movement is achieved.
 * - When `releaseAccuracy01 < 1.0` (mistimed release or over-effort), target line/length
 *   drifts deterministically and lateral movement efficiency drops.
 */
export function resolveBowlerReleaseExecution(
  targetLineX: number,
  targetLengthY: number,
  speedKmh: number,
  movement: MovementVariant,
  releaseAccuracy01 = 1.0,
  releaseTimingBias = 0.0, // negative = early release (shorter/fuller), positive = late release (drags down)
): {
  effectiveLineX: number;
  effectiveLengthY: number;
  effectiveSpeedKmh: number;
  movementEfficiency: number;
} {
  const spec = getDeliverySpec(movement);
  const clampedAcc = Math.max(0, Math.min(1, releaseAccuracy01));
  const inaccuracy = 1 - clampedAcc;

  // Over-pressing speed beyond archetype's natural ceiling slightly penalizes control
  const overEffort = Math.max(0, (speedKmh - spec.maxSpeedKmh) / 12);
  const totalError = Math.min(1, inaccuracy + overEffort * 0.35);

  const signBias = releaseTimingBias !== 0 ? Math.sign(releaseTimingBias) : 1;
  const lineScatterX = totalError * 0.24 * signBias;
  const lengthScatterY = totalError * 1.45 * -signBias; // Late release drags length shorter; early release floats fuller

  return {
    effectiveLineX: Math.max(-0.95, Math.min(1.05, targetLineX + lineScatterX)),
    effectiveLengthY: Math.max(6.2, Math.min(19.4, targetLengthY + lengthScatterY)),
    effectiveSpeedKmh: Math.max(72, Math.min(150, speedKmh * (1 - inaccuracy * 0.04))),
    movementEfficiency: Math.max(0.45, 1 - totalError * 0.45),
  };
}
