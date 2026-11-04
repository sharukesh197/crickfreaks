/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  BallColorVariant,
  FIELD_PRESETS,
  FieldPreset,
  LOCKED_GAMEPLAY_CAMERA,
} from './shared/constants';
import { computeCameraElevationAngleDeg } from './shared/coordinates';
import { BowlingDeliverySetup } from './shared/ballPhysics';
import {
  BatterHandedness,
  FootworkType,
  ShotIntentType,
  normalizeSignedAngleDeg,
  resolveIntendedShot,
} from './shared/batCollision';
import {
  CricketWorldScene,
  LightingPresetId,
  LivePracticeTelemetry,
} from './game/world/CricketScene';
import { TitleOverlay } from './components/TitleOverlay';
import {
  PracticeSessionStats,
  StadiumHud,
  TimingModeOverride,
} from './components/StadiumHud';
import { SpecsModal } from './components/SpecsModal';

type GameShellState = 'title' | 'playing' | 'paused';

const INITIAL_DELIVERY_SETUP: BowlingDeliverySetup = {
  speedKmh: 136,
  targetLineX: 0.06,
  targetLengthY: 14.8,
  movementType: 'outswing',
  releaseX: -0.36,
};

const INITIAL_TELEMETRY: LivePracticeTelemetry = {
  playPhase: 'SETUP',
  ballPhase: 'READY',
  simTimeSec: 0,
  idealSwingTriggerTimeSec: 0.45,
  timingMeterProgress: 0,
  ballPositionCricket: { x: -0.32, y: -2.2, z: 1.15 },
  cameraElevationDeg: Number(
    computeCameraElevationAngleDeg(
      LOCKED_GAMEPLAY_CAMERA.position,
      LOCKED_GAMEPLAY_CAMERA.lookAt,
    ).toFixed(1),
  ),
  latestOutcome: null,
  hasTriggeredSwing: false,
  resolvedIntendedShot: resolveIntendedShot({
    footwork: 'front_foot',
    shotIntent: 'stroke',
    aimAngleDeg: 35,
    handedness: 'RHB',
    swingTriggerTimeSec: null,
    anticipatedLineX: 0.06,
    anticipatedHeightZ: 0.38,
  }),
  fielderPositions: FIELD_PRESETS[1].fielders.map((f) => ({
    id: f.id,
    roleName: f.roleName,
    x: f.position.x,
    y: f.position.y,
  })),
};

const INITIAL_SESSION_STATS: PracticeSessionStats = {
  ballsFaced: 0,
  runsScored: 0,
  wicketsLost: 0,
  fours: 0,
  sixes: 0,
  middledShots: 0,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<CricketWorldScene | null>(null);
  const recordedOutcomeRef = useRef<boolean>(false);

  const [shellState, setShellState] = useState<GameShellState>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1' ? 'playing' : 'title';
  });

  const [telemetry, setTelemetry] = useState<LivePracticeTelemetry>(INITIAL_TELEMETRY);
  const [deliverySetup, setDeliverySetup] =
    useState<BowlingDeliverySetup>(INITIAL_DELIVERY_SETUP);
  const [footwork, setFootwork] = useState<FootworkType>('front_foot');
  const [shotIntent, setShotIntent] = useState<ShotIntentType>('stroke');
  const [aimAngleDeg, setAimAngleDeg] = useState<number>(35);
  const [handedness, setHandedness] = useState<BatterHandedness>('RHB');
  const [controlSwap, setControlSwap] = useState<boolean>(false);
  const [timingMode, setTimingMode] = useState<TimingModeOverride>('live');

  const [sessionStats, setSessionStats] =
    useState<PracticeSessionStats>(INITIAL_SESSION_STATS);

  const [activeFieldPreset, setActiveFieldPreset] =
    useState<FieldPreset['id']>('balanced');
  const [ballVariant, setBallVariant] = useState<BallColorVariant>('red');
  const [lightingPreset, setLightingPreset] =
    useState<LightingPresetId>('daylight');

  // Mirror shellState to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = shellState;
  }, [shellState]);

  // Mount Three.js CricketWorldScene once inside dedicated ref container
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const world = new CricketWorldScene(container, (nextTelemetry) => {
      setTelemetry(nextTelemetry);

      if (nextTelemetry.playPhase !== 'OUTCOME') {
        recordedOutcomeRef.current = false;
      } else if (nextTelemetry.latestOutcome && !recordedOutcomeRef.current) {
        recordedOutcomeRef.current = true;
        const out = nextTelemetry.latestOutcome;
        setSessionStats((prev) => ({
          ballsFaced: prev.ballsFaced + 1,
          runsScored: prev.runsScored + out.runsScored,
          wicketsLost: prev.wicketsLost + (out.isWicketBowled ? 1 : 0),
          fours: prev.fours + (out.isBoundaryFour ? 1 : 0),
          sixes: prev.sixes + (out.isBoundarySix ? 1 : 0),
          middledShots:
            prev.middledShots +
            (out.contactCategory === 'sweet_spot' || out.contactCategory === 'solid'
              ? 1
              : 0),
        }));
      }
    });

    worldRef.current = world;

    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  const handleStartWorld = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setShellState('playing');
  }, []);

  const handleUpdateDeliverySetup = useCallback(
    (partial: Partial<BowlingDeliverySetup>) => {
      setDeliverySetup((prev) => {
        const next = { ...prev, ...partial };
        worldRef.current?.setBowlingDeliverySetup(next);
        return next;
      });
    },
    [],
  );

  const handleSelectFootwork = useCallback((fw: FootworkType) => {
    setFootwork(fw);
    worldRef.current?.setBattingSelection({ footwork: fw });
  }, []);

  const handleSelectShotIntent = useCallback((intent: ShotIntentType) => {
    setShotIntent(intent);
    worldRef.current?.setBattingSelection({ shotIntent: intent });
  }, []);

  const handleSelectAimAngle = useCallback((angleDeg: number) => {
    const norm = Math.round(normalizeSignedAngleDeg(angleDeg));
    setAimAngleDeg(norm);
    worldRef.current?.setBattingSelection({ aimAngleDeg: norm });
  }, []);

  const handleToggleHandedness = useCallback(() => {
    setHandedness((prev) => {
      const next: BatterHandedness = prev === 'RHB' ? 'LHB' : 'RHB';
      const mirroredAngle = Math.round(normalizeSignedAngleDeg(-aimAngleDeg));
      setAimAngleDeg(mirroredAngle);
      worldRef.current?.setBattingSelection({
        handedness: next,
        aimAngleDeg: mirroredAngle,
      });
      worldRef.current?.resetToSetupState();
      return next;
    });
  }, [aimAngleDeg]);

  const handleToggleControlSwap = useCallback(() => {
    setControlSwap((prev) => !prev);
  }, []);

  const handleBowlDelivery = useCallback(() => {
    worldRef.current?.startBowlingDelivery();
  }, []);

  const handlePlayShot = useCallback(
    (intent: ShotIntentType, footworkOverride?: FootworkType) => {
      if (footworkOverride) {
        setFootwork(footworkOverride);
      } else if (footwork === 'leave') {
        setFootwork('front_foot');
      }
      setShotIntent(intent);

      const timingOffsetSec =
        timingMode === 'early'
          ? -0.041
          : timingMode === 'late'
            ? 0.041
            : timingMode === 'perfect'
              ? 0
              : undefined;

      worldRef.current?.triggerBattingShot(intent, footworkOverride, timingOffsetSec);
    },
    [footwork, timingMode],
  );

  const handleNextBall = useCallback(() => {
    worldRef.current?.resetToSetupState();
  }, []);

  const handleResetSession = useCallback(() => {
    setSessionStats(INITIAL_SESSION_STATS);
    worldRef.current?.resetToSetupState();
  }, []);

  const handleSelectFieldPreset = useCallback((presetId: FieldPreset['id']) => {
    setActiveFieldPreset(presetId);
    worldRef.current?.setFieldPreset(presetId);
  }, []);

  const handleSelectBallVariant = useCallback((variant: BallColorVariant) => {
    setBallVariant(variant);
    worldRef.current?.setBallVariant(variant);
  }, []);

  const handleSelectLighting = useCallback((preset: LightingPresetId) => {
    setLightingPreset(preset);
    worldRef.current?.setLightingPreset(preset);
  }, []);

  // Keyboard shortcuts for Title, Bowling, Footwork, 360° Aiming, Shot Intents, and Specs
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shellState === 'title' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleStartWorld();
        return;
      }

      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setShellState((prev) => (prev === 'paused' ? 'playing' : 'paused'));
        return;
      }

      if (shellState !== 'playing') return;

      if (e.key === ' ') {
        e.preventDefault();
        if (telemetry.playPhase === 'OUTCOME') {
          handleNextBall();
        } else if (telemetry.playPhase === 'SETUP') {
          handleBowlDelivery();
        }
        return;
      }

      const key = e.key.toLowerCase();
      if (key === '1' || key === 'z') {
        handleSelectFootwork('front_foot');
      } else if (key === '2' || key === 'x') {
        handleSelectFootwork('back_foot');
      } else if (key === '3' || key === 'c') {
        handleSelectFootwork('advance');
      } else if (key === '4' || key === 'v') {
        handleSelectFootwork('leave');
      } else if (key === 'a' || e.key === 'ArrowLeft') {
        handleSelectAimAngle(aimAngleDeg - 18);
      } else if (key === 'd' || e.key === 'ArrowRight') {
        handleSelectAimAngle(aimAngleDeg + 18);
      } else if (key === 'w' || e.key === 'ArrowUp') {
        handleSelectAimAngle(0);
      } else if (key === 's' || e.key === 'ArrowDown') {
        handleSelectAimAngle(handedness === 'RHB' ? -156 : 156);
      } else if (key === 'k') {
        handlePlayShot('push');
      } else if (key === 'j') {
        handlePlayShot('stroke');
      } else if (key === 'l') {
        handlePlayShot('loft');
      } else if (key === 'u') {
        handlePlayShot('special');
      } else if (key === 'h') {
        handleToggleHandedness();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    shellState,
    telemetry.playPhase,
    aimAngleDeg,
    handedness,
    handleStartWorld,
    handleNextBall,
    handleBowlDelivery,
    handleSelectFootwork,
    handleSelectAimAngle,
    handlePlayShot,
    handleToggleHandedness,
  ]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      {/* Full-viewport 3D WebGL Stadium & Pitch Canvas */}
      <div
        ref={canvasMountRef}
        className="fixed inset-0 z-0 w-full h-full"
        aria-label="Crease Clash 3D Cricket Ground Canvas"
      />

      {/* Title Screen Overlay */}
      {shellState === 'title' && (
        <TitleOverlay
          onStartWorld={handleStartWorld}
          onOpenSpecs={() => setShellState('paused')}
        />
      )}

      {/* Redesigned Authentic Mobile/Console Sports-Game HUD */}
      {shellState === 'playing' && (
        <StadiumHud
          telemetry={telemetry}
          deliverySetup={deliverySetup}
          footwork={footwork}
          shotIntent={shotIntent}
          aimAngleDeg={aimAngleDeg}
          handedness={handedness}
          controlSwap={controlSwap}
          timingMode={timingMode}
          sessionStats={sessionStats}
          activeFieldPreset={activeFieldPreset}
          ballVariant={ballVariant}
          lightingPreset={lightingPreset}
          onUpdateDeliverySetup={handleUpdateDeliverySetup}
          onSelectFootwork={handleSelectFootwork}
          onSelectShotIntent={handleSelectShotIntent}
          onSelectAimAngle={handleSelectAimAngle}
          onToggleHandedness={handleToggleHandedness}
          onToggleControlSwap={handleToggleControlSwap}
          onSelectTimingMode={setTimingMode}
          onBowlDelivery={handleBowlDelivery}
          onPlayShot={handlePlayShot}
          onNextBall={handleNextBall}
          onResetSession={handleResetSession}
          onSelectFieldPreset={handleSelectFieldPreset}
          onSelectBallVariant={handleSelectBallVariant}
          onSelectLighting={handleSelectLighting}
          onOpenSpecs={() => setShellState('paused')}
          onReturnToTitle={() => setShellState('title')}
        />
      )}

      {/* Technical Specs & Roadmap Modal */}
      {shellState === 'paused' && (
        <SpecsModal onClose={() => setShellState('playing')} />
      )}
    </main>
  );
}
