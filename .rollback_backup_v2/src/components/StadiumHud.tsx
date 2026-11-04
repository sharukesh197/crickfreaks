import React, { useRef, useCallback } from 'react';
import {
  BallColorVariant,
  FIELD_PRESETS,
  FieldPreset,
  PITCH_CONSTANTS,
} from '../shared/constants';
import { BowlingDeliverySetup, MovementVariant } from '../shared/ballPhysics';
import {
  BatterHandedness,
  FootworkType,
  ShotIntentType,
  getFieldSectorLabel,
  joystickVectorToAimAngleDeg,
  normalizeSignedAngleDeg,
} from '../shared/batCollision';
import { LightingPresetId, LivePracticeTelemetry } from '../game/world/CricketScene';

export interface PracticeSessionStats {
  ballsFaced: number;
  runsScored: number;
  wicketsLost: number;
  fours: number;
  sixes: number;
  middledShots: number;
}

export type TimingModeOverride = 'live' | 'perfect' | 'early' | 'late';

interface StadiumHudProps {
  telemetry: LivePracticeTelemetry;
  deliverySetup: BowlingDeliverySetup;
  footwork: FootworkType;
  shotIntent: ShotIntentType;
  aimAngleDeg: number;
  handedness: BatterHandedness;
  controlSwap: boolean;
  timingMode: TimingModeOverride;
  sessionStats: PracticeSessionStats;
  activeFieldPreset: FieldPreset['id'];
  ballVariant: BallColorVariant;
  lightingPreset: LightingPresetId;
  onUpdateDeliverySetup: (partial: Partial<BowlingDeliverySetup>) => void;
  onSelectFootwork: (fw: FootworkType) => void;
  onSelectShotIntent: (intent: ShotIntentType) => void;
  onSelectAimAngle: (angleDeg: number) => void;
  onToggleHandedness: () => void;
  onToggleControlSwap: () => void;
  onSelectTimingMode: (mode: TimingModeOverride) => void;
  onBowlDelivery: () => void;
  onPlayShot: (intent: ShotIntentType, footworkOverride?: FootworkType) => void;
  onNextBall: () => void;
  onResetSession: () => void;
  onSelectFieldPreset: (presetId: FieldPreset['id']) => void;
  onSelectBallVariant: (variant: BallColorVariant) => void;
  onSelectLighting: (preset: LightingPresetId) => void;
  onOpenSpecs: () => void;
  onReturnToTitle: () => void;
}

const BOWLING_VARIATIONS: {
  id: MovementVariant;
  shortLabel: string;
  title: string;
  badge: string;
  defaultLengthY?: number;
  defaultSpeedKmh?: number;
}[] = [
  { id: 'seam_straight', shortLabel: 'STR', title: 'Straight Seam', badge: 'SEAM' },
  { id: 'outswing', shortLabel: 'OUT', title: 'Outswinger', badge: 'SWING' },
  { id: 'inswing', shortLabel: 'IN', title: 'Inswinger', badge: 'SWING' },
  { id: 'off_cutter', shortLabel: 'OCUT', title: 'Off-Cutter', badge: 'CUT' },
  { id: 'leg_cutter', shortLabel: 'LCUT', title: 'Leg-Cutter', badge: 'CUT' },
  { id: 'slower_ball', shortLabel: 'SLOW', title: 'Slower Dipper', badge: 'PACE', defaultSpeedKmh: 114 },
  { id: 'bouncer', shortLabel: 'BNCR', title: 'Short Bouncer', badge: 'SHORT', defaultLengthY: 8.8, defaultSpeedKmh: 144 },
  { id: 'off_spin', shortLabel: 'OSPN', title: 'Off-Break Spin', badge: 'SPIN', defaultSpeedKmh: 88, defaultLengthY: 15.2 },
  { id: 'leg_spin', shortLabel: 'LSPN', title: 'Leg-Break Googly', badge: 'SPIN', defaultSpeedKmh: 86, defaultLengthY: 15.0 },
];

const LENGTH_PRESETS: { label: string; y: number }[] = [
  { label: 'Bouncer', y: 8.8 },
  { label: 'Short', y: 10.6 },
  { label: 'Good', y: 14.8 },
  { label: 'Full', y: 17.2 },
  { label: 'Yorker', y: 18.4 },
];

const LINE_PRESETS: { label: string; x: number }[] = [
  { label: 'Wide Off', x: 0.34 },
  { label: 'Off Stump', x: 0.11 },
  { label: 'Middle', x: 0.0 },
  { label: 'Leg Stump', x: -0.12 },
];

const SECTOR_HOTSPOTS: { id: string; label: string; angleRHB: number }[] = [
  { id: 'straight', label: 'STR', angleRHB: 0 },
  { id: 'cover', label: 'COV', angleRHB: 42 },
  { id: 'point', label: 'PNT', angleRHB: 88 },
  { id: 'third_man', label: '3RD', angleRHB: 136 },
  { id: 'behind', label: 'RMP', angleRHB: -156 },
  { id: 'fine_leg', label: 'FIN', angleRHB: -135 },
  { id: 'square_leg', label: 'SQR', angleRHB: -88 },
  { id: 'midwicket', label: 'MDW', angleRHB: -42 },
];

export const StadiumHud: React.FC<StadiumHudProps> = ({
  telemetry,
  deliverySetup,
  footwork,
  shotIntent,
  aimAngleDeg,
  handedness,
  controlSwap,
  timingMode,
  sessionStats,
  activeFieldPreset,
  ballVariant,
  lightingPreset,
  onUpdateDeliverySetup,
  onSelectFootwork,
  onSelectShotIntent,
  onSelectAimAngle,
  onToggleHandedness,
  onToggleControlSwap,
  onSelectTimingMode,
  onBowlDelivery,
  onPlayShot,
  onNextBall,
  onResetSession,
  onSelectFieldPreset,
  onSelectBallVariant,
  onSelectLighting,
  onOpenSpecs,
  onReturnToTitle,
}) => {
  const isSetup = telemetry.playPhase === 'SETUP';
  const isLiveOrRunup =
    telemetry.playPhase === 'RUNUP' || telemetry.playPhase === 'LIVE_BALL';
  const isOutcome = telemetry.playPhase === 'OUTCOME';
  const outcome = telemetry.latestOutcome;
  const resolvedShot = telemetry.resolvedIntendedShot;

  const joystickRef = useRef<HTMLDivElement | null>(null);
  const isDraggingJoystickRef = useRef<boolean>(false);

  const updateAimFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = joystickRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (clientX - cx) / (rect.width / 2);
      const dy = (clientY - cy) / (rect.height / 2); // -1 is up (toward bowler), +1 is down (toward keeper)
      const nextAngle = joystickVectorToAimAngleDeg(dx, dy, aimAngleDeg);
      onSelectAimAngle(Math.round(nextAngle));
    },
    [aimAngleDeg, onSelectAimAngle],
  );

  const handleJoystickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingJoystickRef.current = true;
    updateAimFromClientPoint(e.clientX, e.clientY);
  };

  const handleJoystickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingJoystickRef.current) return;
    updateAimFromClientPoint(e.clientX, e.clientY);
  };

  const handleJoystickPointerUp = () => {
    isDraggingJoystickRef.current = false;
  };

  // Compute joystick knob visual offset in [-34px, +34px]
  const aimRad = (normalizeSignedAngleDeg(aimAngleDeg) * Math.PI) / 180;
  const knobRadiusPx = 30;
  const knobOffsetX = Math.sin(aimRad) * knobRadiusPx;
  const knobOffsetY = -Math.cos(aimRad) * knobRadiusPx;

  const currentSectorLabel = getFieldSectorLabel(aimAngleDeg, handedness);
  const oversBowled = `${Math.floor(sessionStats.ballsFaced / 6)}.${sessionStats.ballsFaced % 6}`;

  // Timing bar marker percentage [0..100%]
  // Ideal trigger is at timingMeterProgress = 1.0 -> mapped to 68% along the bar (center of green PERFECT zone)
  const timingMarkerPercent = Math.max(
    4,
    Math.min(96, telemetry.timingMeterProgress * 68),
  );

  // Render the 360° Directional Joystick Module
  const renderDirectionalJoystick = () => (
    <div
      data-testid="batting-joystick-cluster"
      className="pointer-events-auto flex flex-col items-center gap-1.5"
    >
      {/* Active Sector & Resolved Shot Pill */}
      <div className="px-2.5 py-1 rounded-full bg-slate-950/90 border border-emerald-500/40 shadow-lg text-center">
        <div
          data-testid="active-sector-readout"
          className="text-[10px] font-black uppercase tracking-wider text-emerald-400 leading-tight"
        >
          {currentSectorLabel} • {aimAngleDeg > 0 ? `+${aimAngleDeg}°` : `${aimAngleDeg}°`}
        </div>
        <div
          data-testid="resolved-shot-readout"
          className="text-[11px] font-bold text-white leading-tight"
        >
          {resolvedShot.shotName}
        </div>
      </div>

      {/* Circular 360° Analog Pad + Quick Sector Ring */}
      <div className="relative w-28 h-28 lg:w-36 lg:h-36 flex items-center justify-center">
        <div
          ref={joystickRef}
          data-testid="aim-joystick-pad"
          onPointerDown={handleJoystickPointerDown}
          onPointerMove={handleJoystickPointerMove}
          onPointerUp={handleJoystickPointerUp}
          onPointerCancel={handleJoystickPointerUp}
          className="relative w-20 h-20 lg:w-28 lg:h-28 rounded-full bg-slate-950/88 border-2 border-slate-600/80 shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
        >
          {/* SVG Compass & Aim Wedge inside Joystick */}
          <svg
            viewBox="-50 -50 100 100"
            className="w-full h-full pointer-events-none"
          >
            <circle cx="0" cy="0" r="44" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx="0" cy="0" r="24" fill="none" stroke="#1e293b" strokeWidth="1" />
            <line x1="-44" y1="0" x2="44" y2="0" stroke="#1e293b" strokeWidth="1" />
            <line x1="0" y1="-44" x2="0" y2="44" stroke="#1e293b" strokeWidth="1" />
            {/* Aiming Ray */}
            <line
              x1="0"
              y1="0"
              x2={Math.sin(aimRad) * 40}
              y2={-Math.cos(aimRad) * 40}
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>

          {/* Off / Leg Side Labels */}
          <span className="absolute top-1 text-[8px] font-black uppercase tracking-widest text-slate-400 pointer-events-none">
            STR
          </span>
          <span className="absolute bottom-1 text-[8px] font-black uppercase tracking-widest text-amber-400/80 pointer-events-none">
            WK
          </span>
          <span className="absolute left-1.5 text-[8px] font-black uppercase text-slate-400 pointer-events-none">
            {handedness === 'RHB' ? 'LEG' : 'OFF'}
          </span>
          <span className="absolute right-1.5 text-[8px] font-black uppercase text-slate-400 pointer-events-none">
            {handedness === 'RHB' ? 'OFF' : 'LEG'}
          </span>

          {/* Draggable Thumbstick Knob */}
          <div
            style={{
              transform: `translate(${knobOffsetX}px, ${knobOffsetY}px)`,
            }}
            className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 border-2 border-white shadow-lg flex items-center justify-center pointer-events-none transition-transform duration-75"
          >
            <div className="w-2.5 h-2.5 rounded-full bg-white/90" />
          </div>
        </div>

        {/* 8 Quick-Tap Sector Nodes around the outer ring for instant precision */}
        {SECTOR_HOTSPOTS.map((spot) => {
          const handSign = handedness === 'LHB' ? -1 : 1;
          const targetAngle = normalizeSignedAngleDeg(spot.angleRHB * handSign);
          const rad = (targetAngle * Math.PI) / 180;
          const rPct = 46;
          const leftPct = 50 + Math.sin(rad) * rPct;
          const topPct = 50 - Math.cos(rad) * rPct;
          const isSelected = Math.abs(normalizeSignedAngleDeg(aimAngleDeg - targetAngle)) <= 18;
          return (
            <button
              key={spot.id}
              type="button"
              data-testid={`sector-btn-${spot.id}`}
              onClick={() => onSelectAimAngle(targetAngle)}
              style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              className={`-translate-x-1/2 -translate-y-1/2 absolute px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter border transition-all cursor-pointer ${
                isSelected
                  ? 'bg-emerald-500 text-slate-950 border-white scale-110 shadow-md z-10'
                  : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:border-slate-400'
              }`}
              title={`Aim ${spot.id} (${targetAngle}°)`}
            >
              {spot.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Render the 4 Shot Intent Circular Action Buttons + 4 Compact Footwork Buttons
  const renderShotAndFootworkCluster = () => {
    const intents: {
      id: ShotIntentType;
      label: string;
      sub: string;
      hotkey: string;
      ringColor: string;
      activeBg: string;
    }[] = [
      {
        id: 'push',
        label: 'PUSH',
        sub: 'Defend / Nurdle',
        hotkey: 'K',
        ringColor: 'border-sky-400/70',
        activeBg: 'bg-sky-500 text-slate-950 border-white shadow-sky-500/30',
      },
      {
        id: 'stroke',
        label: 'STROKE',
        sub: 'Power Ground',
        hotkey: 'J',
        ringColor: 'border-emerald-400/80',
        activeBg: 'bg-emerald-500 text-slate-950 border-white shadow-emerald-500/30',
      },
      {
        id: 'loft',
        label: 'LOFT',
        sub: 'Aerial Six',
        hotkey: 'L',
        ringColor: 'border-amber-400/80',
        activeBg: 'bg-amber-400 text-slate-950 border-white shadow-amber-400/30',
      },
      {
        id: 'special',
        label: 'SPECIAL',
        sub: 'Sweep / Scoop',
        hotkey: 'U',
        ringColor: 'border-fuchsia-400/80',
        activeBg: 'bg-fuchsia-500 text-white border-white shadow-fuchsia-500/30',
      },
    ];

    const footworks: { id: FootworkType; label: string; short: string; keyHint: string }[] = [
      { id: 'front_foot', label: 'Front Foot', short: 'FRONT', keyHint: '1' },
      { id: 'back_foot', label: 'Back Foot', short: 'BACK', keyHint: '2' },
      { id: 'advance', label: 'Advance', short: 'ADVANCE', keyHint: '3' },
      { id: 'leave', label: 'Leave Ball', short: 'LEAVE', keyHint: '4' },
    ];

    return (
      <div
        data-testid="batting-action-cluster"
        className="pointer-events-auto flex flex-col items-end gap-2"
      >
        {/* 2x2 Circular Arcade Shot Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          {intents.map((item) => {
            const isSelected = shotIntent === item.id && footwork !== 'leave';
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`shot-intent-${item.id}`}
                onClick={() => {
                  onSelectShotIntent(item.id);
                  if (isLiveOrRunup) {
                    onPlayShot(item.id);
                  }
                }}
                className={`w-12 h-12 lg:w-[68px] lg:h-[68px] rounded-full border-2 flex flex-col items-center justify-center transition-all cursor-pointer shadow-xl active:scale-95 ${
                  isSelected
                    ? `${item.activeBg} scale-105`
                    : `bg-slate-950/90 text-white ${item.ringColor} hover:bg-slate-900`
                }`}
              >
                <span className="text-[10px] lg:text-[11px] font-black tracking-wider leading-none">
                  {item.label}
                </span>
                <span
                  className={`hidden lg:block text-[8px] font-bold mt-0.5 leading-none ${
                    isSelected ? ' opacity-90' : 'text-slate-400'
                  }`}
                >
                  {item.sub}
                </span>
                <span
                  className={`text-[7px] lg:text-[8px] font-mono mt-0.5 px-1 rounded ${
                    isSelected ? 'bg-black/20' : 'text-slate-400'
                  }`}
                >
                  [{item.hotkey}]
                </span>
              </button>
            );
          })}
        </div>

        {/* Dedicated Strike / Swing Trigger Button during SETUP or LIVE_BALL */}
        <button
          type="button"
          data-testid="execute-shot-btn"
          onClick={() => onPlayShot(shotIntent)}
          className="w-full py-1.5 px-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-[11px] uppercase tracking-wider shadow-lg border border-white/60 transition-transform active:scale-95 cursor-pointer"
        >
          {isLiveOrRunup
            ? telemetry.hasTriggeredSwing
              ? 'SWING LOCKED!'
              : `SWING NOW (${shotIntent.toUpperCase()})`
            : `BOWL & PLAY ${shotIntent.toUpperCase()}`}
        </button>

        {/* Compact 4-Footwork Pill Selector */}
        <div className="flex items-center gap-1 bg-slate-950/92 p-1 rounded-full border border-slate-700/80 shadow-xl">
          {footworks.map((fw) => {
            const active = footwork === fw.id;
            return (
              <button
                key={fw.id}
                type="button"
                data-testid={`footwork-${fw.id}`}
                onClick={() => onSelectFootwork(fw.id)}
                className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  active
                    ? fw.id === 'leave'
                      ? 'bg-amber-400 text-slate-950 shadow'
                      : 'bg-sky-400 text-slate-950 shadow'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
                title={`${fw.label} [${fw.keyHint}]`}
              >
                {fw.short}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="stadium-hud-root"
      className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-3.5 select-none"
    >
      {/* ==================== TOP ROW: UPPER-LEFT RADAR & UPPER-RIGHT TIMING METER ==================== */}
      <div className="flex items-start justify-between gap-2 w-full">
        {/* UPPER-LEFT: Circular 2D Field Radar + Field Preset Pill */}
        <div className="pointer-events-auto flex flex-col items-center gap-1.5">
          <div
            data-testid="circular-field-radar"
            className="relative w-24 h-24 lg:w-32 lg:h-32 rounded-full bg-slate-950/90 border-2 border-emerald-500/50 shadow-2xl overflow-hidden flex items-center justify-center"
          >
            <svg viewBox="-75 -75 150 150" className="w-full h-full">
              {/* Outfield Grass Circle */}
              <circle cx="0" cy="0" r="70" fill="#064e3b" stroke="#10b981" strokeWidth="1.5" />
              {/* 30-Yard Inner Ring */}
              <circle
                cx="0"
                cy="0"
                r="30"
                fill="none"
                stroke="#34d399"
                strokeWidth="0.9"
                strokeDasharray="3 2"
                opacity="0.65"
              />
              {/* Batter 360° Aiming Wedge on Radar (Origin at Striker Crease y = +9 in radar coords) */}
              {footwork !== 'leave' && (
                <g transform="translate(0, 9)">
                  <line
                    x1="0"
                    y1="0"
                    x2={Math.sin(aimRad) * 58}
                    y2={-Math.cos(aimRad) * 58}
                    stroke="#34d399"
                    strokeWidth="2"
                    strokeDasharray="2 2"
                  />
                </g>
              )}
              {/* Pitch Strip */}
              <rect x="-2.4" y="-11" width="4.8" height="22" rx="1" fill="#d6b88a" />
              {/* Bowler & Wicketkeeper Dots */}
              <circle cx="0" cy="-12" r="2.5" fill="#38bdf8" />
              <circle cx="0" cy="14" r="2.5" fill="#fbbf24" />
              {/* Striker Dot */}
              <circle cx="0" cy="9" r="2.8" fill="#10b981" stroke="#ffffff" strokeWidth="0.8" />
              {/* 9 Live AI Fielders */}
              {telemetry.fielderPositions.map((f) => {
                // Convert Cricket (X, Y) around midpoint (0, 10.06) to Radar SVG (-70..+70)
                // In our camera view: Bowler is at bottom/near (-Y), Striker is at top/far (+Y),
                // or in standard radar where Striker is at top/center: let's match joystick orientation
                // where UP (-Y in SVG) is Straight Down the Pitch toward Bowler (Cricket -Y)!
                const rx = Math.max(-66, Math.min(66, f.x));
                const ry = Math.max(-66, Math.min(66, f.y - PITCH_CONSTANTS.MIDPOINT_Y));
                return (
                  <circle
                    key={f.id}
                    cx={rx}
                    cy={ry}
                    r="2.8"
                    fill="#60a5fa"
                    stroke="#0f172a"
                    strokeWidth="0.8"
                  >
                    <title>{f.roleName}</title>
                  </circle>
                );
              })}
              {/* Live Ball Position on Radar */}
              {telemetry.playPhase !== 'SETUP' && (
                <circle
                  cx={Math.max(-68, Math.min(68, telemetry.ballPositionCricket.x))}
                  cy={Math.max(
                    -68,
                    Math.min(68, telemetry.ballPositionCricket.y - PITCH_CONSTANTS.MIDPOINT_Y),
                  )}
                  r="3.4"
                  fill="#fde047"
                  stroke="#dc2626"
                  strokeWidth="1.1"
                />
              )}
            </svg>
            <span className="absolute bottom-1 text-[8px] font-black uppercase tracking-widest text-emerald-300/90 bg-slate-950/80 px-1.5 rounded">
              RADAR
            </span>
          </div>

          {/* Compact Field Preset Cycler Pill */}
          <div className="flex items-center gap-0.5 bg-slate-950/90 border border-slate-700/80 rounded-full p-0.5 shadow-lg">
            {FIELD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-testid={`field-preset-${preset.id}`}
                onClick={() => onSelectFieldPreset(preset.id)}
                className={`px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase transition-colors cursor-pointer ${
                  activeFieldPreset === preset.id
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={preset.name}
              >
                {preset.id.slice(0, 3).toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* UPPER-RIGHT: Dynamic Timing Meter & Compact Utility Strip */}
        <div className="pointer-events-auto flex flex-col items-end gap-1.5 max-w-[330px]">
          {/* Compact Utility & Handedness Strip */}
          <div className="flex flex-wrap items-center justify-end gap-1 bg-slate-950/90 border border-slate-700/80 rounded-full px-2 py-1 shadow-xl">
            <button
              type="button"
              data-testid="toggle-handedness-btn"
              onClick={onToggleHandedness}
              className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 cursor-pointer"
              title="Switch Right-Handed (RHB) / Left-Handed (LHB) Batter"
            >
              {handedness}
            </button>
            <button
              type="button"
              data-testid="toggle-layout-swap-btn"
              onClick={onToggleControlSwap}
              className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border cursor-pointer ${
                controlSwap
                  ? 'bg-sky-500 text-slate-950 border-white'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
              title="Swap Joystick & Shot Buttons Left/Right"
            >
              FLIP UI
            </button>

            {/* Timing Mode Selector (Live / Perfect / Early / Late) */}
            {(['live', 'perfect', 'early', 'late'] as TimingModeOverride[]).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`timing-mode-${m}`}
                onClick={() => onSelectTimingMode(m)}
                className={`px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase cursor-pointer ${
                  timingMode === m
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={`Timing Mode: ${m.toUpperCase()}`}
              >
                {m === 'live' ? 'LIVE' : m === 'perfect' ? 'PERF' : m.toUpperCase()}
              </button>
            ))}

            <span className="text-slate-700">|</span>

            {(['red', 'white', 'pink'] as BallColorVariant[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onSelectBallVariant(v)}
                className={`w-3.5 h-3.5 rounded-full border cursor-pointer ${
                  v === 'red'
                    ? 'bg-red-600'
                    : v === 'white'
                      ? 'bg-slate-100'
                      : 'bg-pink-500'
                } ${ballVariant === v ? 'ring-2 ring-amber-400 border-white' : 'border-slate-600 opacity-70'}`}
                title={`${v.toUpperCase()} Ball`}
              />
            ))}

            {(['daylight', 'late_afternoon', 'floodlights'] as LightingPresetId[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onSelectLighting(l)}
                className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase cursor-pointer ${
                  lightingPreset === l
                    ? 'bg-sky-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {l === 'daylight' ? 'DAY' : l === 'late_afternoon' ? 'DUSK' : 'NIGHT'}
              </button>
            ))}

            <button
              type="button"
              onClick={onOpenSpecs}
              className="px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase text-slate-300 hover:text-white bg-slate-800/80 cursor-pointer"
            >
              SPECS
            </button>
            <button
              type="button"
              onClick={onReturnToTitle}
              className="px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase text-rose-300 hover:text-white bg-rose-950/60 cursor-pointer"
            >
              EXIT
            </button>
          </div>

          {/* Dynamic Timing Meter Bar (Early -> Good -> Perfect -> Late) */}
          <div
            data-testid="hud-timing-meter"
            className="w-60 sm:w-68 bg-slate-950/92 border border-slate-700/80 rounded-xl px-3 py-1.5 shadow-2xl"
          >
            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider mb-1">
              <span className="text-slate-400">SHOT TIMING METER</span>
              <span
                data-testid="timing-meter-status"
                className={
                  outcome
                    ? outcome.timingRating === 'perfect'
                      ? 'text-emerald-400'
                      : outcome.timingRating === 'good'
                        ? 'text-sky-400'
                        : 'text-amber-400'
                    : 'text-emerald-300'
                }
              >
                {outcome
                  ? `${outcome.timingRating.toUpperCase()} • ${outcome.contactCategory.replace('_', ' ').toUpperCase()}`
                  : isLiveOrRunup
                    ? telemetry.hasTriggeredSwing
                      ? 'SWING TRIGGERED'
                      : 'TAP SHOT AT GREEN ZONE'
                    : `${resolvedShot.shotName.toUpperCase()}`}
              </span>
            </div>

            {/* Segmented Color Bar */}
            <div className="relative h-2.5 w-full rounded-full overflow-hidden flex bg-slate-900 border border-slate-700">
              <div className="w-[38%] h-full bg-amber-500/70" title="Early Zone" />
              <div className="w-[18%] h-full bg-sky-400/80" title="Good Zone" />
              <div className="w-[20%] h-full bg-emerald-400" title="Perfect Sweet-Spot Window" />
              <div className="w-[12%] h-full bg-sky-400/80" title="Good Zone" />
              <div className="w-[12%] h-full bg-rose-500/80" title="Late Zone" />

              {/* Moving Timing Indicator Needle */}
              {(isLiveOrRunup || isOutcome) && (
                <div
                  style={{ left: `${timingMarkerPercent}%` }}
                  className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-white shadow-[0_0_8px_#fff] rounded-full transition-all duration-75"
                />
              )}
            </div>

            <div className="flex justify-between text-[8px] font-bold uppercase text-slate-400 mt-0.5">
              <span>EARLY</span>
              <span>GOOD</span>
              <span className="text-emerald-400 font-black">PERFECT</span>
              <span>LATE</span>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== FLOATING CONTEXTUAL BOWLING DOCK (SETUP) & OUTCOME BANNER ==================== */}
      {isSetup && (
        <div
          data-testid="contextual-bowling-dock"
          className="pointer-events-auto fixed left-[112px] top-2.5 lg:left-auto lg:right-3.5 lg:top-1/2 lg:-translate-y-1/2 flex flex-col items-end gap-1 bg-slate-950/90 border border-slate-700/80 rounded-2xl p-2 shadow-2xl w-[205px] lg:w-[252px] z-20 scale-90 origin-top-left lg:scale-100 lg:origin-center"
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-[9px] font-black uppercase tracking-widest text-sky-400">
              BOWLING VARIATION
            </span>
            <span className="text-[10px] font-black font-mono text-white">
              {deliverySetup.speedKmh} km/h
            </span>
          </div>

          {/* 9 Circular/Capsule Bowling Variation Buttons */}
          <div className="grid grid-cols-3 gap-1 w-full">
            {BOWLING_VARIATIONS.map((v) => {
              const active = deliverySetup.movementType === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  data-testid={`bowl-variation-${v.id}`}
                  onClick={() =>
                    onUpdateDeliverySetup({
                      movementType: v.id,
                      ...(v.defaultLengthY ? { targetLengthY: v.defaultLengthY } : {}),
                      ...(v.defaultSpeedKmh ? { speedKmh: v.defaultSpeedKmh } : {}),
                    })
                  }
                  className={`px-1.5 py-0.5 rounded-lg border text-center transition-all cursor-pointer ${
                    active
                      ? 'bg-sky-500 text-slate-950 border-white font-black shadow'
                      : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:border-slate-500 font-bold'
                  }`}
                  title={v.title}
                >
                  <div className="text-[9px] leading-tight">{v.shortLabel}</div>
                  <div
                    className={`text-[7px] uppercase leading-none ${
                      active ? 'text-slate-900' : 'text-slate-400'
                    }`}
                  >
                    {v.badge}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Compact Pace Slider */}
          <div className="w-full flex items-center gap-2">
            <span className="text-[8px] font-bold uppercase text-slate-400">PACE</span>
            <input
              type="range"
              aria-label="Delivery Pace km/h"
              min={82}
              max={150}
              step={2}
              value={deliverySetup.speedKmh}
              onChange={(e) =>
                onUpdateDeliverySetup({ speedKmh: Number(e.target.value) })
              }
              className="w-full accent-sky-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Compact Pitch Length & Line Quick-Chips */}
          <div className="w-full flex flex-wrap gap-1">
            {LENGTH_PRESETS.map((len) => {
              const active = Math.abs(deliverySetup.targetLengthY - len.y) < 0.7;
              return (
                <button
                  key={len.label}
                  type="button"
                  data-testid={`length-preset-${len.label.toLowerCase()}`}
                  onClick={() => onUpdateDeliverySetup({ targetLengthY: len.y })}
                  className={`flex-1 py-0.5 px-1 rounded text-[8px] font-black uppercase border cursor-pointer ${
                    active
                      ? 'bg-emerald-500 text-slate-950 border-white'
                      : 'bg-slate-900 text-slate-300 border-slate-700'
                  }`}
                >
                  {len.label}
                </button>
              );
            })}
          </div>

          <div className="w-full flex gap-1">
            {LINE_PRESETS.map((ln) => {
              const active = Math.abs(deliverySetup.targetLineX - ln.x) < 0.06;
              return (
                <button
                  key={ln.label}
                  type="button"
                  data-testid={`line-preset-${ln.label.toLowerCase().replace(' ', '_')}`}
                  onClick={() => onUpdateDeliverySetup({ targetLineX: ln.x })}
                  className={`flex-1 py-0.5 px-1 rounded text-[8px] font-bold uppercase border cursor-pointer ${
                    active
                      ? 'bg-amber-400 text-slate-950 border-white font-black'
                      : 'bg-slate-900 text-slate-300 border-slate-700'
                  }`}
                >
                  {ln.label.split(' ')[0]}
                </button>
              );
            })}
          </div>

          {/* Prominent BOWL Action Button */}
          <button
            type="button"
            data-testid="bowl-delivery-btn"
            onClick={onBowlDelivery}
            className="w-full py-1 rounded-xl bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-300 hover:to-blue-400 text-slate-950 font-black text-[11px] uppercase tracking-wider shadow-lg border border-white/60 transition-transform active:scale-95 cursor-pointer"
          >
            BOWL DELIVERY [SPACE]
          </button>
        </div>
      )}

      {/* Compact Broadcast Outcome Toast Banner when Ball finishes */}
      {isOutcome && outcome && (
        <div
          data-testid="outcome-banner"
          className="pointer-events-auto fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-950/94 border-2 border-emerald-500/60 rounded-2xl px-5 py-3 shadow-2xl text-center max-w-md z-30"
        >
          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
            {outcome.resolvedShotName} • {outcome.footworkLabel} • {outcome.outgoingSectorLabel}
          </div>
          <div className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
            {outcome.headline}
          </div>
          <div className="text-xs text-slate-300 mt-0.5">{outcome.subheadline}</div>

          <div className="flex items-center justify-center gap-2 mt-2 text-[10px] font-mono text-slate-300">
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">
              TIMING: {outcome.timingRating.toUpperCase()} ({outcome.timingDeltaMs >= 0 ? `+${outcome.timingDeltaMs}` : outcome.timingDeltaMs}ms)
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">
              EXIT: {outcome.exitSpeedKmh} km/h • {outcome.shotDistanceMeters}m
            </span>
          </div>

          <button
            type="button"
            data-testid="next-ball-btn"
            onClick={onNextBall}
            className="mt-2.5 px-6 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg cursor-pointer"
          >
            NEXT BALL [SPACE]
          </button>
        </div>
      )}

      {/* ==================== BOTTOM ROW: ERGONOMIC DUAL-THUMB BATTING CONTROLS & BROADCAST SCOREBOARD ==================== */}
      <div className="flex flex-col gap-1 w-full mt-auto">
        {/* Dual-Thumb Controls Row (Left & Right Corners, central pitch completely clear) */}
        <div className="flex items-end justify-between w-full">
          {controlSwap ? renderShotAndFootworkCluster() : renderDirectionalJoystick()}
          {controlSwap ? renderDirectionalJoystick() : renderShotAndFootworkCluster()}
        </div>

        {/* Sleek Broadcast Scoreboard Ticker */}
        <div
          data-testid="broadcast-scoreboard-bar"
          className="pointer-events-auto mx-auto w-full max-w-3xl bg-slate-950/92 border border-slate-700/80 rounded-full px-4 py-1 flex flex-wrap items-center justify-between gap-2 shadow-2xl text-[11px]"
        >
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 font-black text-[10px] tracking-wider">
              CREASE CLASH
            </span>
            <span className="font-black text-white text-xs">
              {sessionStats.runsScored}/{sessionStats.wicketsLost}
            </span>
            <span className="text-slate-400 font-mono text-[10px]">
              ({oversBowled} OV)
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-300">
            <span>
              STRIKER ({handedness}):{' '}
              <strong className="text-emerald-400">{resolvedShot.shotName}</strong>
            </span>
            <span className="hidden sm:inline text-slate-600">•</span>
            <span className="hidden sm:inline">
              BOWLER:{' '}
              <strong className="text-sky-400">
                {deliverySetup.speedKmh} KMH {deliverySetup.movementType.replace('_', ' ').toUpperCase()}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-emerald-400">4s: {sessionStats.fours}</span>
            <span className="text-amber-400">6s: {sessionStats.sixes}</span>
            <button
              type="button"
              onClick={onResetSession}
              className="text-[9px] font-bold uppercase text-slate-400 hover:text-white underline cursor-pointer ml-1"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
