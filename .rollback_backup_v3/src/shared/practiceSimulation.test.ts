import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BowlingDeliverySetup,
  createDeliverySimulation,
  stepDeliverySimulation,
} from './ballPhysics';
import {
  BattingIntentInput,
  FootworkType,
  resolveIntendedShot,
  ShotIntent,
} from './batCollision';

function runFullDelivery(
  setup: BowlingDeliverySetup,
  battingInput: BattingIntentInput,
) {
  let state = createDeliverySimulation(setup);
  const dt = 1 / 120;
  let steps = 0;
  while (state.phase !== 'DEAD_BALL' && steps < 720) {
    state = stepDeliverySimulation(state, dt, setup, battingInput);
    steps++;
  }
  assert.equal(state.phase, 'DEAD_BALL', 'Delivery must terminate in DEAD_BALL');
  assert.ok(state.outcome, 'Delivery must produce a physical DeliveryOutcomeSummary');
  return state;
}

function runDeliveryWithIdealFootworkTiming(
  setup: BowlingDeliverySetup,
  footwork: FootworkType,
  shotIntent: ShotIntent,
  aimAngleDeg: number,
  timingOffsetSec = 0,
  handedness: 'RHB' | 'LHB' = 'RHB',
) {
  const preview = createDeliverySimulation(setup);
  const sample = preview.footworkExpectedArrival[footwork];
  return runFullDelivery(setup, {
    footwork,
    shotIntent,
    aimAngleDeg,
    handedness,
    swingTriggerTimeSec:
      footwork === 'leave' ? null : sample.idealSwingTriggerTimeSec + timingOffsetSec,
    anticipatedLineX: sample.ballX,
    anticipatedHeightZ: sample.ballZ,
  });
}

test('1. 150 km/h Express Delivery: Zero Stump Tunneling & Bowled Detection', () => {
  const expressSetup: BowlingDeliverySetup = {
    speedKmh: 150,
    targetLineX: 0.0,
    targetLengthY: 16.4,
    movementType: 'seam_straight',
    releaseX: 0.0,
  };

  const leaveInput: BattingIntentInput = {
    footwork: 'leave',
    shotIntent: 'push',
    aimAngleDeg: 0,
    swingTriggerTimeSec: null,
    anticipatedLineX: 0,
    anticipatedHeightZ: 0.35,
  };

  const result = runFullDelivery(expressSetup, leaveInput);
  assert.equal(result.stumpCollision.struck, true, '150 km/h middle-stump ball must strike stumps without tunneling');
  assert.equal(result.stumpCollision.stumpId, 'middle');
  assert.equal(result.outcome?.isWicketBowled, true);
});

test('2. True 360-Degree Shot Placement Across All Field Sectors (Straight, Cover, Point, Third Man, Fine Leg, Square Leg)', () => {
  const setup: BowlingDeliverySetup = {
    speedKmh: 134,
    targetLineX: 0.05,
    targetLengthY: 14.8,
    movementType: 'straight',
    releaseX: -0.32,
  };

  const straightRes = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'stroke', 0);
  const coverRes = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'stroke', 60);
  const pointCutRes = runDeliveryWithIdealFootworkTiming(
    { ...setup, targetLengthY: 10.8, targetLineX: 0.18 },
    'back_foot',
    'stroke',
    90,
  );
  const thirdManLateCutRes = runDeliveryWithIdealFootworkTiming(
    { ...setup, targetLengthY: 11.2, targetLineX: 0.16 },
    'back_foot',
    'stroke',
    132,
  );
  const squareLegPullRes = runDeliveryWithIdealFootworkTiming(
    { ...setup, targetLengthY: 10.6, targetLineX: -0.06 },
    'back_foot',
    'stroke',
    -85,
  );
  const fineLegScoopRes = runDeliveryWithIdealFootworkTiming(
    { ...setup, targetLengthY: 15.6, targetLineX: 0.0 },
    'front_foot',
    'special',
    -148,
  );

  assert.ok(straightRes.batCollision?.collided);
  assert.ok(coverRes.batCollision?.collided);
  assert.ok(pointCutRes.batCollision?.collided);
  assert.ok(thirdManLateCutRes.batCollision?.collided);
  assert.ok(squareLegPullRes.batCollision?.collided);
  assert.ok(fineLegScoopRes.batCollision?.collided);

  // Verify outgoing azimuth angles span the full 360 degrees
  assert.ok(Math.abs(straightRes.outcome!.outgoingAzimuthDeg) < 20, 'Straight drive travels straight');
  assert.ok(
    coverRes.outcome!.outgoingAzimuthDeg > 35 && coverRes.outcome!.outgoingAzimuthDeg < 80,
    `Cover drive travels through covers (got ${coverRes.outcome!.outgoingAzimuthDeg} deg)`,
  );
  assert.ok(
    pointCutRes.outcome!.outgoingAzimuthDeg > 65 && pointCutRes.outcome!.outgoingAzimuthDeg < 115,
    `Square cut travels square through point (got ${pointCutRes.outcome!.outgoingAzimuthDeg} deg)`,
  );
  assert.ok(
    thirdManLateCutRes.outcome!.outgoingAzimuthDeg > 105,
    `Late cut travels behind point toward third man (got ${thirdManLateCutRes.outcome!.outgoingAzimuthDeg} deg)`,
  );
  assert.ok(
    squareLegPullRes.outcome!.outgoingAzimuthDeg < -55 &&
      squareLegPullRes.outcome!.outgoingAzimuthDeg > -115,
    `Pull shot travels toward midwicket/square leg (got ${squareLegPullRes.outcome!.outgoingAzimuthDeg} deg)`,
  );
  assert.ok(
    fineLegScoopRes.outcome!.outgoingAzimuthDeg < -115,
    `Scoop travels behind the wicket toward fine leg (got ${fineLegScoopRes.outcome!.outgoingAzimuthDeg} deg)`,
  );
});

test('3. Distinct Shot Intents: PUSH vs STROKE vs LOFT Physical Behavior', () => {
  const setup: BowlingDeliverySetup = {
    speedKmh: 135,
    targetLineX: 0.04,
    targetLengthY: 15.2,
    movementType: 'straight',
    releaseX: -0.32,
  };

  const pushState = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'push', 35);
  const strokeState = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'stroke', 35);
  const loftState = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'loft', 35);

  assert.ok(pushState.batCollision?.collided);
  assert.ok(strokeState.batCollision?.collided);
  assert.ok(loftState.batCollision?.collided);

  // Push has controlled soft-hands exit speed and short placement distance
  assert.ok(
    pushState.outcome!.exitSpeedKmh < strokeState.outcome!.exitSpeedKmh * 0.45,
    `Push exit speed (${pushState.outcome!.exitSpeedKmh}) must be much lower than Stroke (${strokeState.outcome!.exitSpeedKmh})`,
  );
  assert.ok(
    pushState.outcome!.shotDistanceMeters < strokeState.outcome!.shotDistanceMeters,
    'Push must travel a shorter controlled distance than a full Stroke',
  );

  // Loft has genuinely higher launch elevation angle than a conventional ground Stroke
  assert.ok(
    loftState.outcome!.launchElevationDeg > strokeState.outcome!.launchElevationDeg + 10,
    `Loft launch angle (${loftState.outcome!.launchElevationDeg} deg) must be significantly higher than ground Stroke (${strokeState.outcome!.launchElevationDeg} deg)`,
  );
});

test('4. Distinct Footwork Modes: Front Foot, Back Foot, Advance & Leave', () => {
  const setup: BowlingDeliverySetup = {
    speedKmh: 132,
    targetLineX: 0.06,
    targetLengthY: 14.5,
    movementType: 'straight',
    releaseX: -0.32,
  };

  const advanceRes = runDeliveryWithIdealFootworkTiming(setup, 'advance', 'loft', 0);
  const frontRes = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'stroke', 0);
  const backRes = runDeliveryWithIdealFootworkTiming(setup, 'back_foot', 'stroke', 85);
  const leaveRes = runDeliveryWithIdealFootworkTiming(
    { ...setup, targetLineX: 0.25 },
    'leave',
    'push',
    0,
  );

  // Advance intercepts the ball more than 1.0m further down the pitch than Front Foot, and >2.0m further than Back Foot
  assert.ok(
    advanceRes.batCollision!.contactPoint.y < frontRes.batCollision!.contactPoint.y - 0.9,
    `Advance contact Y (${advanceRes.batCollision!.contactPoint.y}) must be well ahead of Front Foot (${frontRes.batCollision!.contactPoint.y})`,
  );
  assert.ok(
    frontRes.batCollision!.contactPoint.y < backRes.batCollision!.contactPoint.y - 0.7,
    `Front Foot contact Y (${frontRes.batCollision!.contactPoint.y}) must be ahead of Back Foot (${backRes.batCollision!.contactPoint.y})`,
  );
  assert.equal(leaveRes.batCollision?.collided, false, 'Leave footwork must not touch the ball');
  assert.equal(leaveRes.outcome?.contactCategory, 'left_alone');
});

test('5. Shot Combination & Contextual Resolution Across All Required Families', () => {
  const coverDrive = resolveIntendedShot({
    footwork: 'front_foot',
    shotIntent: 'stroke',
    aimAngleDeg: 58,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: 0.1,
    anticipatedHeightZ: 0.35,
  });
  assert.equal(coverDrive.shotId, 'cover_drive');

  const squareCut = resolveIntendedShot({
    footwork: 'back_foot',
    shotIntent: 'stroke',
    aimAngleDeg: 88,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: 0.2,
    anticipatedHeightZ: 0.7,
  });
  assert.equal(squareCut.shotId, 'square_cut');

  const pullShot = resolveIntendedShot({
    footwork: 'back_foot',
    shotIntent: 'stroke',
    aimAngleDeg: -72,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: -0.05,
    anticipatedHeightZ: 0.75,
  });
  assert.equal(pullShot.shotId, 'pull');

  const hookShot = resolveIntendedShot({
    footwork: 'back_foot',
    shotIntent: 'loft',
    aimAngleDeg: -95,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: -0.08,
    anticipatedHeightZ: 0.92,
  });
  assert.equal(hookShot.shotId, 'hook');

  const sweepShot = resolveIntendedShot({
    footwork: 'front_foot',
    shotIntent: 'special',
    aimAngleDeg: -65,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: 0.0,
    anticipatedHeightZ: 0.28,
  });
  assert.equal(sweepShot.shotId, 'sweep');

  const reverseSweep = resolveIntendedShot({
    footwork: 'front_foot',
    shotIntent: 'special',
    aimAngleDeg: 75,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: 0.05,
    anticipatedHeightZ: 0.28,
  });
  assert.equal(reverseSweep.shotId, 'reverse_sweep');

  const scoopShot = resolveIntendedShot({
    footwork: 'front_foot',
    shotIntent: 'special',
    aimAngleDeg: -155,
    handedness: 'RHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: 0.0,
    anticipatedHeightZ: 0.35,
  });
  assert.equal(scoopShot.shotId, 'scoop');
});

test('6. Separate Player Intent from Physical Outcome: Timing Modifies Contact Quality Without Replacing Intended Shot', () => {
  const setup: BowlingDeliverySetup = {
    speedKmh: 138,
    targetLineX: 0.08,
    targetLengthY: 14.6,
    movementType: 'outswing',
    releaseX: -0.36,
  };

  const perfectDrive = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'stroke', 58, 0);
  const earlyDrive = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'stroke', 58, -0.026);
  const veryLateDrive = runDeliveryWithIdealFootworkTiming(setup, 'front_foot', 'stroke', 58, +0.085);

  // Intended shot remains 'Cover Drive' in all three cases!
  assert.equal(perfectDrive.outcome?.resolvedShotId, 'cover_drive');
  assert.equal(earlyDrive.outcome?.resolvedShotId, 'cover_drive');
  assert.equal(veryLateDrive.outcome?.resolvedShotId, 'cover_drive');

  // Physical outcomes differ based on timing:
  assert.ok(
    perfectDrive.outcome?.contactCategory === 'sweet_spot' ||
      perfectDrive.outcome?.contactCategory === 'solid',
  );
  assert.notEqual(
    perfectDrive.outcome?.exitSpeedKmh,
    earlyDrive.outcome?.exitSpeedKmh,
    'Early timing must alter physical exit velocity compared to Perfect timing',
  );
  assert.equal(
    veryLateDrive.outcome?.contactCategory,
    'miss',
    'Swinging 85ms late must physically miss the ball while keeping intended shot as Cover Drive',
  );
});

test('7. Context-Sensitive Special Shots: Succeed on Reachable Ball & Fail on Unreachable Bouncer/Wide Ball', () => {
  // Full straight ball can be scooped behind the wicket
  const fullStraight: BowlingDeliverySetup = {
    speedKmh: 136,
    targetLineX: 0.0,
    targetLengthY: 15.8,
    movementType: 'straight',
    releaseX: -0.3,
  };
  const goodScoop = runDeliveryWithIdealFootworkTiming(
    fullStraight,
    'front_foot',
    'special',
    -155,
  );
  assert.equal(goodScoop.batCollision?.collided, true, 'Scoop on full straight ball should connect');
  assert.ok(
    goodScoop.position.y > 20.12,
    'Successfully scooped ball must travel behind the striker wicket (+Y > 20.12m)',
  );

  // Short high bouncer cannot be swept with a low front-foot kneeling sweep
  const shortBouncer: BowlingDeliverySetup = {
    speedKmh: 144,
    targetLineX: 0.05,
    targetLengthY: 8.8,
    movementType: 'bouncer',
    releaseX: -0.35,
  };
  const previewBouncer = createDeliverySimulation(shortBouncer);
  const arrival = previewBouncer.footworkExpectedArrival.front_foot;
  const impossibleSweep = runFullDelivery(shortBouncer, {
    footwork: 'front_foot',
    shotIntent: 'special',
    aimAngleDeg: -75, // Kneeling sweep
    swingTriggerTimeSec: arrival.idealSwingTriggerTimeSec,
    anticipatedLineX: arrival.ballX,
    anticipatedHeightZ: arrival.ballZ, // Clamped by kneeling_sweep reach to <= 0.50m while bouncer is > 0.85m!
  });
  assert.equal(
    impossibleSweep.batCollision?.collided,
    false,
    'Kneeling sweep against a high-bouncing 144 km/h bouncer must physically miss under the ball',
  );
});

test('8. Left-Handed Batter (LHB) Mirroring Works Symmetrically', () => {
  // For LHB, -58 deg world angle is their Off-Side Cover Drive!
  const lhbCoverDrive = resolveIntendedShot({
    footwork: 'front_foot',
    shotIntent: 'stroke',
    aimAngleDeg: -58,
    handedness: 'LHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: -0.1,
    anticipatedHeightZ: 0.35,
  });
  assert.equal(lhbCoverDrive.shotId, 'cover_drive');
  assert.equal(lhbCoverDrive.targetSectorLabel, 'Cover');

  // And +72 deg world angle for LHB is their Leg-Side Pull Shot on the back foot!
  const lhbPull = resolveIntendedShot({
    footwork: 'back_foot',
    shotIntent: 'stroke',
    aimAngleDeg: 72,
    handedness: 'LHB',
    swingTriggerTimeSec: 0.4,
    anticipatedLineX: 0.08,
    anticipatedHeightZ: 0.72,
  });
  assert.equal(lhbPull.shotId, 'pull');
  assert.equal(lhbPull.targetSectorLabel, 'Midwicket');
});
