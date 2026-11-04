import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cricketToThree,
  threeToCricket,
  cricketToThreeArray,
  cricketYawToThreeRotationY,
  getCricketYawBetweenPoints,
  cricketDistance3D,
  computeCameraElevationAngleDeg,
  CricketVec3,
} from './coordinates';
import {
  PITCH_CONSTANTS,
  WICKET_CONSTANTS,
  BALL_CONSTANTS,
  DEFAULT_BOUNDARY_CONFIG,
  BOUNDARY_PRESETS,
  LOCKED_GAMEPLAY_CAMERA,
  FIELD_PRESETS,
  isBeyondBoundary,
  getBoundaryRadiusAtAngle,
  clampToFieldPerimeter,
} from './constants';

test('Coordinate Mapping: Cricket (X, Y, Z) -> Three.js (X, Z, -Y) and exact inverse', () => {
  const samples: CricketVec3[] = [
    { x: 0, y: 0, z: 0 }, // Bowler's wicket base
    { x: 0, y: 20.12, z: 0.711 }, // Top of striker's middle stump
    { x: -0.36, y: 1.22, z: 2.08 }, // Bowler release point
    { x: 14.2, y: 11.5, z: 0 }, // Cover fielder on off-side (+X)
    { x: -16.8, y: 11.5, z: 0 }, // Midwicket fielder on leg-side (-X)
  ];

  for (const pt of samples) {
    const threePt = cricketToThree(pt);
    assert.equal(threePt.x, pt.x, 'Three.js X must equal Cricket X');
    assert.equal(threePt.y, pt.z, 'Three.js Y must equal Cricket Z (height)');
    assert.equal(threePt.z, pt.y === 0 ? 0 : -pt.y, 'Three.js Z must equal -Cricket Y');

    const tuple = cricketToThreeArray(pt.x, pt.y, pt.z);
    assert.deepEqual(tuple, [threePt.x, threePt.y, threePt.z]);

    const roundTrip = threeToCricket(threePt);
    assert.ok(Math.abs(roundTrip.x - pt.x) < 1e-9);
    assert.ok(Math.abs(roundTrip.y - pt.y) < 1e-9);
    assert.ok(Math.abs(roundTrip.z - pt.z) < 1e-9);
  }
});

test('Yaw & Distance Helpers in Cricket World Coordinates', () => {
  const bowlerStumps = { x: 0, y: 0, z: 0 };
  const strikerStumps = { x: 0, y: 20.12, z: 0 };

  assert.equal(cricketDistance3D(bowlerStumps, strikerStumps), 20.12);
  const yawStraightDownPitch = getCricketYawBetweenPoints(bowlerStumps, strikerStumps);
  assert.equal(yawStraightDownPitch, 0);
  assert.equal(cricketYawToThreeRotationY(yawStraightDownPitch), 0);

  const offSidePoint = { x: 10, y: 0 };
  const yawToOffSide = getCricketYawBetweenPoints(bowlerStumps, offSidePoint);
  assert.ok(Math.abs(yawToOffSide - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(cricketYawToThreeRotationY(yawToOffSide) + Math.PI / 2) < 1e-9);
});

test('Regulation Pitch & Crease Proportions', () => {
  assert.equal(PITCH_CONSTANTS.LENGTH_METERS, 20.12);
  assert.equal(PITCH_CONSTANTS.WIDTH_METERS, 3.05);
  assert.equal(PITCH_CONSTANTS.BOWLER_POPPING_CREASE_Y, 1.22);
  assert.ok(Math.abs(PITCH_CONSTANTS.STRIKER_POPPING_CREASE_Y - 18.9) < 1e-9);
  assert.equal(PITCH_CONSTANTS.RETURN_CREASE_SPAN_X, 2.64);
});

test('Regulation Wicket, Individual Stumps & Separate Bails Geometry', () => {
  // Stump height = 0.711m, total wicket width = 0.2286m, max stump diameter = 0.0381m
  assert.equal(WICKET_CONSTANTS.STUMP_HEIGHT_Z, 0.711);
  assert.equal(WICKET_CONSTANTS.TOTAL_WIDTH_X, 0.2286);
  assert.equal(WICKET_CONSTANTS.STUMP_DIAMETER_METERS, 0.0381);
  assert.equal(WICKET_CONSTANTS.STUMPS.length, 3);

  const [legStump, middleStump, offStump] = WICKET_CONSTANTS.STUMPS;
  assert.equal(middleStump.centerX, 0);

  // Outer edge of leg stump to outer edge of off stump must equal 0.2286m
  const leftOuterEdge = legStump.centerX - legStump.radius;
  const rightOuterEdge = offStump.centerX + offStump.radius;
  const totalSpan = rightOuterEdge - leftOuterEdge;
  assert.ok(Math.abs(totalSpan - 0.2286) < 1e-6, `Expected 0.2286m wicket width, got ${totalSpan}`);

  // Gap between adjacent stumps must be smaller than cricket ball diameter (0.072m)
  const gapBetweenMiddleAndOff =
    offStump.centerX - offStump.radius - (middleStump.centerX + middleStump.radius);
  assert.ok(gapBetweenMiddleAndOff > 0.05 && gapBetweenMiddleAndOff < BALL_CONSTANTS.DIAMETER_METERS);

  // Separate bails resting at Z = 0.711m
  assert.equal(WICKET_CONSTANTS.BAILS.length, 2);
  for (const bail of WICKET_CONSTANTS.BAILS) {
    assert.equal(bail.restingBaseZ, 0.711);
    const partsSum = bail.barrelLength + bail.longSpigotLength + bail.shortSpigotLength;
    assert.ok(Math.abs(partsSum - bail.overallLength) < 1e-6);
  }
});

test('Configurable Boundary Geometry & Field Presets Legality', () => {
  assert.equal(isBeyondBoundary(0, PITCH_CONSTANTS.MIDPOINT_Y, DEFAULT_BOUNDARY_CONFIG), false);
  // Straight hit beyond 68m from pitch center (Y = 10.06 + 69 = 79.06m)
  assert.equal(isBeyondBoundary(0, 80, DEFAULT_BOUNDARY_CONFIG), true);
  // Square hit beyond 64m from center X
  assert.equal(isBeyondBoundary(65, PITCH_CONSTANTS.MIDPOINT_Y, DEFAULT_BOUNDARY_CONFIG), true);

  // Verify polar boundary radius at straight (0 rad) and square (pi/2 rad)
  const rStraight = getBoundaryRadiusAtAngle(0, DEFAULT_BOUNDARY_CONFIG);
  const rSquare = getBoundaryRadiusAtAngle(Math.PI / 2, DEFAULT_BOUNDARY_CONFIG);
  assert.ok(Math.abs(rStraight - DEFAULT_BOUNDARY_CONFIG.straightBoundaryMeters) < 1e-6);
  assert.ok(Math.abs(rSquare - DEFAULT_BOUNDARY_CONFIG.squareBoundaryMeters) < 1e-6);

  // Clamp outside coordinate back inside perimeter
  const clamped = clampToFieldPerimeter(100, 10.06, DEFAULT_BOUNDARY_CONFIG, 2.0);
  assert.equal(isBeyondBoundary(clamped.x, clamped.y, DEFAULT_BOUNDARY_CONFIG), false);

  // All 9 fielders in every preset must be inside every boundary preset and grounded at Z=0
  for (const preset of FIELD_PRESETS) {
    assert.equal(preset.fielders.length, 9);
    for (const fielder of preset.fielders) {
      assert.equal(fielder.position.z, 0);
      for (const boundary of BOUNDARY_PRESETS) {
        assert.equal(
          isBeyondBoundary(fielder.position.x, fielder.position.y, boundary),
          false,
          `Fielder ${fielder.roleName} in ${preset.name} must be inside ${boundary.name}`,
        );
      }
    }
  }
});

test('Locked Behind-the-Bowler Camera Calibration', () => {
  const { position, lookAt, fovDegrees } = LOCKED_GAMEPLAY_CAMERA;
  assert.equal(position.x, 0, 'Camera must be centered behind the pitch (X = 0)');
  assert.ok(position.y < -8, 'Camera must be positioned behind the bowler run-up (Y < -8m)');
  assert.ok(position.z > 7, 'Camera must be elevated above the pitch (Z > 7m)');
  assert.ok(lookAt.y >= 6 && lookAt.y <= 16, 'Camera must look down the length of the pitch');

  const angleDeg = computeCameraElevationAngleDeg(position, lookAt);
  assert.ok(
    angleDeg >= 14 && angleDeg <= 28,
    `Expected elevated camera look angle between 14° and 28°, got ${angleDeg.toFixed(2)}°`,
  );
  assert.ok(fovDegrees >= 22 && fovDegrees <= 42);
});
