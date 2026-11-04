import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  cricketToThree,
  threeToCricket,
  cricketToThreeArray,
  cricketYawToThreeRotationY,
  getCricketYawBetweenPoints,
  cricketDistance3D,
  computeCameraElevationAngleDeg,
  getTransformedRigForwardCricket,
  getTransformedRigShouldersCricket,
  normalizeCricketVec3,
  dotCricketVec3,
  CricketVec3,
} from './coordinates';
import {
  PITCH_CONSTANTS,
  WICKET_CONSTANTS,
  BALL_CONSTANTS,
  DEFAULT_BOUNDARY_CONFIG,
  BOUNDARY_PRESETS,
  LOCKED_GAMEPLAY_CAMERA,
  CORE_ACTOR_POSITIONS,
  FIELD_PRESETS,
  isBeyondBoundary,
  getBoundaryRadiusAtAngle,
  clampToFieldPerimeter,
} from './constants';
import {
  BATTING_TEAM_PALETTE,
  BOWLING_TEAM_PALETTE,
  createBatterModel,
  createBowlerModel,
  createFielderModel,
  createUmpireModel,
  createWicketkeeperModel,
  applyCanonicalStrikerReadyStance,
  animateBowlerDeliverySequence,
  animateFielderPosture,
  animateNonStrikerSequence,
  animateStrikerShotSequence,
  animateUmpireSequence,
  animateWicketkeeperSequence,
  computeNonStrikerCanonicalOrientation,
  computeStrikerCanonicalOrientation,
} from '../game/models/CricketActors';
import { resolveIntendedShot } from './batCollision';

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

test('Canonical Character Orientation: RHB & LHB Striker Chest, Shoulder & Head Vectors (Zero Stacked Yaw)', () => {
  const dummyWoodTex = new THREE.Texture();
  const strikerRig = createBatterModel('striker', BATTING_TEAM_PALETTE, dummyWoodTex, false);

  // 1. Test Right-Handed Batter (RHB)
  const rhb = applyCanonicalStrikerReadyStance(strikerRig, 0, 'RHB');
  assert.equal(strikerRig.hips.rotation.y, 0, 'RHB hips.rotation.y must be 0 (zero stacked yaw)');
  assert.equal(strikerRig.torso.rotation.y, 0, 'RHB torso.rotation.y must be 0 in ready stance');

  const actualRhbChest = getTransformedRigForwardCricket(
    strikerRig.root.rotation.y + strikerRig.hips.rotation.y + strikerRig.torso.rotation.y,
  );
  const actualRhbShoulders = getTransformedRigShouldersCricket(
    strikerRig.root.rotation.y + strikerRig.hips.rotation.y + strikerRig.torso.rotation.y,
  );
  const actualRhbHead = getTransformedRigForwardCricket(
    strikerRig.root.rotation.y +
      strikerRig.hips.rotation.y +
      strikerRig.torso.rotation.y +
      strikerRig.headGroup.rotation.y,
  );

  // RHB stands on leg-side (X < 0) with chest facing +X (Off-Side), slightly open toward bowler (-Y)
  assert.ok(rhb.stancePosition.x < -0.2, 'RHB must stand on leg-side (X < 0)');
  assert.ok(
    actualRhbChest.x > 0.98 && actualRhbChest.y < -0.05,
    `RHB chest must face +X off-side slightly open toward bowler, got (${actualRhbChest.x.toFixed(3)}, ${actualRhbChest.y.toFixed(3)})`,
  );
  // RHB front shoulder (+X_rig = rightShoulder) points down pitch toward bowler (-Y)
  assert.ok(
    actualRhbShoulders.rightShoulder.y < -0.98,
    `RHB front shoulder must point toward bowler (-Y), got y=${actualRhbShoulders.rightShoulder.y.toFixed(3)}`,
  );
  // RHB back shoulder (-X_rig = leftShoulder) points toward wicketkeeper (+Y)
  assert.ok(
    actualRhbShoulders.leftShoulder.y > 0.98,
    `RHB back shoulder must point toward wicketkeeper (+Y), got y=${actualRhbShoulders.leftShoulder.y.toFixed(3)}`,
  );
  // RHB head looks directly down the pitch at the bowler's release point
  const vecToBowlerRhb = normalizeCricketVec3({
    x: CORE_ACTOR_POSITIONS.BOWLER_RELEASE_POINT.x - rhb.stancePosition.x,
    y: CORE_ACTOR_POSITIONS.BOWLER_RELEASE_POINT.y - rhb.stancePosition.y,
    z: 0,
  });
  assert.ok(
    dotCricketVec3(actualRhbHead, vecToBowlerRhb) > 0.9999,
    'RHB head forward vector must align directly with bowler release point',
  );

  // 2. Test Left-Handed Batter (LHB)
  const lhb = applyCanonicalStrikerReadyStance(strikerRig, 0, 'LHB');
  assert.equal(strikerRig.hips.rotation.y, 0, 'LHB hips.rotation.y must be 0 (zero stacked yaw)');
  assert.equal(strikerRig.torso.rotation.y, 0, 'LHB torso.rotation.y must be 0 in ready stance');

  const actualLhbChest = getTransformedRigForwardCricket(
    strikerRig.root.rotation.y + strikerRig.hips.rotation.y + strikerRig.torso.rotation.y,
  );
  const actualLhbShoulders = getTransformedRigShouldersCricket(
    strikerRig.root.rotation.y + strikerRig.hips.rotation.y + strikerRig.torso.rotation.y,
  );
  const actualLhbHead = getTransformedRigForwardCricket(
    strikerRig.root.rotation.y +
      strikerRig.hips.rotation.y +
      strikerRig.torso.rotation.y +
      strikerRig.headGroup.rotation.y,
  );

  assert.ok(lhb.stancePosition.x > 0.2, 'LHB must stand on +X leg-side for LHB');
  assert.ok(
    actualLhbChest.x < -0.98 && actualLhbChest.y < -0.05,
    `LHB chest must face -X off-side slightly open toward bowler, got (${actualLhbChest.x.toFixed(3)}, ${actualLhbChest.y.toFixed(3)})`,
  );
  assert.ok(
    actualLhbShoulders.leftShoulder.y < -0.98,
    `LHB front shoulder must point toward bowler (-Y), got y=${actualLhbShoulders.leftShoulder.y.toFixed(3)}`,
  );
  assert.ok(
    actualLhbShoulders.rightShoulder.y > 0.98,
    `LHB back shoulder must point toward wicketkeeper (+Y), got y=${actualLhbShoulders.rightShoulder.y.toFixed(3)}`,
  );
  assert.ok(
    actualLhbHead.y < -0.998,
    `LHB head must look down the pitch toward bowler (-Y), got y=${actualLhbHead.y.toFixed(3)}`,
  );
  // Mirror symmetry check between RHB and LHB
  assert.ok(Math.abs(actualRhbChest.x + actualLhbChest.x) < 1e-6);
  assert.ok(Math.abs(actualRhbChest.y - actualLhbChest.y) < 1e-6);
});

test('Canonical Character Orientation: Non-Striker Diagonal Inward Facing Vector (Never Hardcoded Lateral or Reversed)', () => {
  const dummyWoodTex = new THREE.Texture();
  const nonStrikerRig = createBatterModel('non_striker', BATTING_TEAM_PALETTE, dummyWoodTex, false);
  animateNonStrikerSequence(nonStrikerRig, 'SETUP', 0);

  // Verify the raw Three.js rotation is NOT hardcoded to +Math.PI/2 (reversed outward) or -Math.PI/2 (purely lateral)
  assert.ok(
    Math.abs(nonStrikerRig.root.rotation.y - Math.PI / 2) > 0.5,
    'Non-striker rotation.y must never be +Math.PI/2 (which faces outward toward -X)',
  );
  assert.ok(
    Math.abs(nonStrikerRig.root.rotation.y - -Math.PI / 2) > 0.4,
    'Non-striker rotation.y must not be hardcoded to -Math.PI/2 (purely lateral)',
  );

  // Verify actual transformed forward vector points diagonally inward (+X) AND down the pitch (+Y)
  const forward = getTransformedRigForwardCricket(nonStrikerRig.root.rotation.y);
  assert.ok(
    forward.x > 0.45 && forward.x < 0.85,
    `Non-striker forward.x must point diagonally inward toward +X pitch, got ${forward.x.toFixed(3)}`,
  );
  assert.ok(
    forward.y > 0.75 && forward.y < 0.95,
    `Non-striker forward.y must point diagonally down the pitch toward +Y striker end, got ${forward.y.toFixed(3)}`,
  );

  // Verify exact alignment with intended focus target vector
  const computed = computeNonStrikerCanonicalOrientation(CORE_ACTOR_POSITIONS.NON_STRIKER_STANCE);
  const expectedUnit = normalizeCricketVec3({
    x: 0.0 - CORE_ACTOR_POSITIONS.NON_STRIKER_STANCE.x,
    y: 3.4 - CORE_ACTOR_POSITIONS.NON_STRIKER_STANCE.y,
    z: 0,
  });
  assert.ok(dotCricketVec3(computed.forwardCricket, expectedUnit) > 0.999999);
});

test('Canonical Character Orientation: Bowler, Wicketkeeper, Umpire & All 9 Fielders Transformed Vectors', () => {
  const bowlerRig = createBowlerModel(BOWLING_TEAM_PALETTE, false);
  const wkRig = createWicketkeeperModel(BOWLING_TEAM_PALETTE, false);
  const umpireRig = createUmpireModel(false);

  // 1. Bowler faces +Y down the pitch toward striker's wicket
  const bowlerFwd = getTransformedRigForwardCricket(bowlerRig.root.rotation.y);
  assert.ok(bowlerFwd.y > 0.999, `Bowler must face +Y toward striker, got y=${bowlerFwd.y}`);

  // 2. Wicketkeeper faces -Y toward striker's wicket and bowler
  const wkFwd = getTransformedRigForwardCricket(wkRig.root.rotation.y);
  const unitWkToStumps = normalizeCricketVec3({
    x: 0 - wkRig.currentCricketPos.x,
    y: PITCH_CONSTANTS.STRIKER_STUMPS_Y - wkRig.currentCricketPos.y,
    z: 0,
  });
  assert.ok(wkFwd.y < -0.985, `Wicketkeeper must face -Y toward bowler, got y=${wkFwd.y}`);
  assert.ok(
    dotCricketVec3(wkFwd, unitWkToStumps) > 0.999999,
    'Wicketkeeper forward vector must align with striker stumps',
  );

  // 3. Umpire faces +Y down the pitch toward striker's wicket
  const umpireFwd = getTransformedRigForwardCricket(umpireRig.root.rotation.y);
  assert.ok(umpireFwd.y > 0.999, `Umpire must face +Y toward striker, got y=${umpireFwd.y}`);

  // 4. All 9 Fielders in all 4 presets face the striker pre-contact, and track the ball post-contact
  const sampleBallAfterContact: CricketVec3 = { x: 24.0, y: 8.5, z: 0.2 };
  for (const preset of FIELD_PRESETS) {
    for (const fSpec of preset.fielders) {
      const fRig = createFielderModel(fSpec.id, BOWLING_TEAM_PALETTE, false);

      // Pre-contact: faces striker
      animateFielderPosture(fRig, fSpec.position, 'SETUP', 0, undefined, false);
      const preFwd = getTransformedRigForwardCricket(fRig.root.rotation.y);
      const unitToStriker = normalizeCricketVec3({
        x: CORE_ACTOR_POSITIONS.STRIKER_STANCE.x - fSpec.position.x,
        y: CORE_ACTOR_POSITIONS.STRIKER_STANCE.y - fSpec.position.y,
        z: 0,
      });
      assert.ok(
        dotCricketVec3(preFwd, unitToStriker) > 0.999999,
        `Fielder ${fSpec.roleName} pre-contact forward vector must align with striker`,
      );

      // Post-contact: rotates to face live ball
      animateFielderPosture(fRig, fSpec.position, 'LIVE_BALL', 1.0, sampleBallAfterContact, true);
      const postFwd = getTransformedRigForwardCricket(fRig.root.rotation.y);
      const unitToBall = normalizeCricketVec3({
        x: sampleBallAfterContact.x - fSpec.position.x,
        y: sampleBallAfterContact.y - fSpec.position.y,
        z: 0,
      });
      assert.ok(
        dotCricketVec3(postFwd, unitToBall) > 0.999999,
        `Fielder ${fSpec.roleName} post-contact forward vector must track the live ball`,
      );
    }
  }
});

test('Articulated Player Rigs & Kinematic Foot Planting Across Action Sequences', () => {
  const dummyWoodTex = new THREE.Texture();
  const strikerRig = createBatterModel('striker', BATTING_TEAM_PALETTE, dummyWoodTex, false);
  const bowlerRig = createBowlerModel(BOWLING_TEAM_PALETTE, false);

  // Verify 2-segment arm & leg sub-groups exist
  assert.ok(strikerRig.leftForearm && strikerRig.rightForearm, 'Forearm elbow groups must exist');
  assert.ok(strikerRig.leftShin && strikerRig.rightShin, 'Shin knee groups must exist');
  assert.ok(strikerRig.leftAnkle && strikerRig.rightAnkle, 'Ankle boot groups must exist');

  const readyHipsY = strikerRig.hips.position.y;
  assert.ok(readyHipsY > 0.78 && readyHipsY < 0.96, `Ready stance hips height must be planted (${readyHipsY})`);

  // Sweep shot drops the batter low onto the knee via kinematic foot planting
  const sweepSpec = resolveIntendedShot({
    footwork: 'front_foot',
    shotIntent: 'special',
    aimAngleDeg: -85,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: 0,
    anticipatedHeightZ: 0.25,
  });
  animateStrikerShotSequence(
    strikerRig,
    CORE_ACTOR_POSITIONS.STRIKER_STANCE,
    'front_foot',
    sweepSpec,
    'RHB',
    0.55,
    true,
    1.0,
  );
  assert.ok(
    strikerRig.hips.position.y < readyHipsY - 0.1,
    'Kneeling sweep must lower pelvis height relative to standing ready stance',
  );

  // Bowler gather leap elevates Z at u = 0.82 and returns to Z = 0 at release (u = 1.0)
  animateBowlerDeliverySequence(bowlerRig, 'runup', 0.82, -0.36);
  assert.ok(bowlerRig.currentCricketPos.z > 0.15, 'Bowler gather bound must elevate Z > 0.15m');
  animateBowlerDeliverySequence(bowlerRig, 'runup', 1.0, -0.36);
  assert.equal(bowlerRig.currentCricketPos.z, 0, 'Bowler front-foot block at release must plant at Z = 0');
});

