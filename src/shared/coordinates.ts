/**
 * CREASE CLASH — Authoritative Cricket World Coordinate System
 *
 * All simulation, rules, physics, collision, fielding, and camera definitions
 * operate strictly in Cricket World Coordinates (X, Y, Z) in meters:
 *
 * - X: Lateral across the pitch (meters)
 *      X = 0.00m is the center line connecting middle stump to middle stump.
 *      -X is left of screen (leg-side for a right-handed striker).
 *      +X is right of screen (off-side for a right-handed striker).
 *
 * - Y: Longitudinal along the pitch (meters)
 *      Y = 0.00m is the bowler's end bowling crease (bowler's wicket line).
 *      Y = 1.22m is the bowler's end popping crease.
 *      Y = 10.06m is the exact longitudinal midpoint of the pitch.
 *      Y = 18.90m is the striker's end popping crease.
 *      Y = 20.12m is the striker's end bowling crease (striker's wicket line).
 *
 * - Z: Vertical height above the ground surface (meters)
 *      Z = 0.00m is the playing surface.
 *      +Z is upwards toward the sky.
 *
 * Explicit Three.js Coordinate Mapping:
 *   Cricket (X, Y, Z)  --->  Three.js (X, Z, -Y)
 *   Three.js (Xt, Yt, Zt) --->  Cricket (Xt, -Zt, Yt)
 */

export interface CricketVec3 {
  x: number;
  y: number;
  z: number;
}

export interface ThreeVec3Tuple {
  x: number;
  y: number;
  z: number;
}

/**
 * Normalizes -0 to +0 to keep numerical comparisons clean.
 */
function normalizeZero(val: number): number {
  return Object.is(val, -0) ? 0 : val;
}

/**
 * Converts a position or vector from authoritative Cricket World Coordinates (X, Y, Z)
 * to Three.js Render Coordinates (X_three = X, Y_three = Z, Z_three = -Y).
 */
export function cricketToThree(pos: CricketVec3): ThreeVec3Tuple {
  return {
    x: normalizeZero(pos.x),
    y: normalizeZero(pos.z),
    z: normalizeZero(-pos.y),
  };
}

/**
 * Converts a position or vector from Three.js Render Coordinates (X_t, Y_t, Z_t)
 * back to authoritative Cricket World Coordinates (X = X_t, Y = -Z_t, Z = Y_t).
 */
export function threeToCricket(threePos: ThreeVec3Tuple): CricketVec3 {
  return {
    x: normalizeZero(threePos.x),
    y: normalizeZero(-threePos.z),
    z: normalizeZero(threePos.y),
  };
}

/**
 * Converts Cricket World (X, Y, Z) into a 3-element tuple [X, Z, -Y]
 * suitable for Three.js Vector3.set(...tuple) or buffer attributes.
 */
export function cricketToThreeArray(x: number, y: number, z: number): [number, number, number] {
  return [normalizeZero(x), normalizeZero(z), normalizeZero(-y)];
}

/**
 * Converts a Cricket World yaw angle (in radians, where 0 faces +Y down the pitch
 * toward the striker, and positive yaw rotates clockwise toward +X / off-side)
 * into a Three.js Y-axis rotation (in radians).
 *
 * In Three.js (X, Z, -Y):
 * - Facing +Y_cricket corresponds to facing -Z_three (rotation.y = 0).
 * - Rotating toward +X_cricket corresponds to rotating from -Z_three toward +X_three,
 *   which is a negative rotation around +Y_three (right-hand rule).
 */
export function cricketYawToThreeRotationY(yawRadians: number): number {
  return normalizeZero(-yawRadians);
}

/**
 * Computes the Cricket World yaw angle (radians) from point A to point B in the (X, Y) plane.
 * Returns 0 when pointing straight down the pitch (+Y), +pi/2 when pointing toward +X.
 */
export function getCricketYawBetweenPoints(from: Pick<CricketVec3, 'x' | 'y'>, to: Pick<CricketVec3, 'x' | 'y'>): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return normalizeZero(Math.atan2(dx, dy));
}

/**
 * Normalizes any angle in radians into the principal range (-PI, +PI].
 */
export function normalizeAngleRadians(angleRad: number): number {
  let a = ((angleRad + Math.PI) % (Math.PI * 2));
  if (a <= 0) a += Math.PI * 2;
  return normalizeZero(a - Math.PI);
}


/**
 * Computes Euclidean 3D distance in Cricket World Coordinates.
 */
export function cricketDistance3D(a: CricketVec3, b: CricketVec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.hypot(dx, dy, dz);
}

/**
 * Computes horizontal ground distance in the Cricket (X, Y) plane.
 */
export function cricketGroundDistance(a: Pick<CricketVec3, 'x' | 'y'>, b: Pick<CricketVec3, 'x' | 'y'>): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Computes the downward camera viewing angle (in degrees) from a camera position
 * to a target look-at point in Cricket World Coordinates.
 */
export function computeCameraElevationAngleDeg(cameraPos: CricketVec3, lookAtTarget: CricketVec3): number {
  const horizontalDist = cricketGroundDistance(cameraPos, lookAtTarget);
  const verticalDrop = cameraPos.z - lookAtTarget.z;
  return (Math.atan2(verticalDrop, horizontalDist) * 180) / Math.PI;
}

/**
 * ============================================================================
 * CANONICAL CHARACTER RIG ORIENTATION & VECTOR TRANSFORMATION HELPERS
 * ============================================================================
 *
 * Canonical Rig Local Coordinate Convention (Three.js right-handed space):
 * - At zero rotation (rotation.y = 0):
 *   - Local Forward  = ( 0,  0, -1)_three  --->  Cricket ( 0, +1,  0) (+Y down pitch toward striker)
 *   - Local Right    = (+1,  0,  0)_three  --->  Cricket (+1,  0,  0) (+X right shoulder)
 *   - Local Left     = (-1,  0,  0)_three  --->  Cricket (-1,  0,  0) (-X left shoulder)
 *   - Local Up       = ( 0, +1,  0)_three  --->  Cricket ( 0,  0, +1) (+Z skyward)
 */

/**
 * Normalizes a 3D vector in Cricket World Coordinates to unit length.
 */
export function normalizeCricketVec3(v: CricketVec3): CricketVec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-12) {
    return { x: 0, y: 1, z: 0 };
  }
  return {
    x: normalizeZero(v.x / len),
    y: normalizeZero(v.y / len),
    z: normalizeZero(v.z / len),
  };
}

/**
 * Computes the dot product of two 3D vectors in Cricket World Coordinates.
 */
export function dotCricketVec3(a: CricketVec3, b: CricketVec3): number {
  return normalizeZero(a.x * b.x + a.y * b.y + a.z * b.z);
}

/**
 * Transforms a local rig vector (lx, ly, lz in Three.js rig space) by a cumulative
 * Three.js Y-axis rotation `threeRotationY` (in radians) and returns the resulting
 * vector in authoritative Cricket World Coordinates (X, Y, Z).
 *
 * In Three.js:
 *   x' =  lx * cos(theta) + lz * sin(theta)
 *   y' =  ly
 *   z' = -lx * sin(theta) + lz * cos(theta)
 * Mapped via threeToCricket (X = x', Y = -z', Z = y'):
 *   X_cricket =  lx * cos(theta) + lz * sin(theta)
 *   Y_cricket =  lx * sin(theta) - lz * cos(theta)
 *   Z_cricket =  ly
 */
export function transformLocalRigVectorToCricket(
  localThreeVec: ThreeVec3Tuple,
  threeRotationY: number,
): CricketVec3 {
  const c = Math.cos(threeRotationY);
  const s = Math.sin(threeRotationY);
  const xThree = localThreeVec.x * c + localThreeVec.z * s;
  const yThree = localThreeVec.y;
  const zThree = -localThreeVec.x * s + localThreeVec.z * c;
  return threeToCricket({ x: xThree, y: yThree, z: zThree });
}

/**
 * Returns the actual transformed Cricket World forward unit vector (-Z_rig)
 * for a character rig or sub-group given its cumulative Three.js Y rotation.
 */
export function getTransformedRigForwardCricket(threeRotationY: number): CricketVec3 {
  return transformLocalRigVectorToCricket({ x: 0, y: 0, z: -1 }, threeRotationY);
}

/**
 * Returns the actual transformed Cricket World left-shoulder unit vector (-X_rig)
 * and right-shoulder unit vector (+X_rig) given cumulative Three.js Y rotation.
 */
export function getTransformedRigShouldersCricket(threeRotationY: number): {
  leftShoulder: CricketVec3;
  rightShoulder: CricketVec3;
} {
  return {
    leftShoulder: transformLocalRigVectorToCricket({ x: -1, y: 0, z: 0 }, threeRotationY),
    rightShoulder: transformLocalRigVectorToCricket({ x: 1, y: 0, z: 0 }, threeRotationY),
  };
}

