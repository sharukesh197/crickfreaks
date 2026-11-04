import React from 'react';

interface TitleOverlayProps {
  onStartWorld: () => void;
  onOpenSpecs: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({ onStartWorld, onOpenSpecs }) => {
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-none"
      style={{
        background:
          'linear-gradient(90deg, rgba(2, 6, 23, 0.90) 0%, rgba(2, 6, 23, 0.58) 44%, rgba(2, 6, 23, 0.10) 100%)',
      }}
    >
      {/* Top-left subtle game build stage label */}
      <div className="flex items-center justify-between w-full">
        <div className="text-xs font-medium tracking-wider text-emerald-400/90">
          Playable 3D Practice Nets · Locked Behind-Bowler Telephoto Camera · Cricket World (X, Y, Z)
        </div>
      </div>

      {/* Left-third negative-space Title Lockup & Primary Actions */}
      <div className="max-w-lg my-auto pointer-events-auto">
        <div className="flex items-center gap-4 mb-4">
          <svg
            viewBox="0 0 64 64"
            className="w-16 h-16 shrink-0"
            aria-hidden="true"
          >
            <path
              d="M32 4 L56 12 V30 C56 46 45 56 32 60 C19 56 8 46 8 30 V12 Z"
              fill="#064e3b"
              stroke="#fbbf24"
              strokeWidth="2.5"
            />
            <rect x="23" y="20" width="3" height="26" rx="1" fill="#fde68a" />
            <rect x="30.5" y="20" width="3" height="26" rx="1" fill="#fde68a" />
            <rect x="38" y="20" width="3" height="26" rx="1" fill="#fde68a" />
            <rect x="22.5" y="16.5" width="9" height="2.4" rx="1" fill="#fef3c7" />
            <rect x="32.5" y="16.5" width="9" height="2.4" rx="1" fill="#fef3c7" />
            <circle cx="44" cy="40" r="8" fill="#dc2626" stroke="#fef2f2" strokeWidth="1.5" />
            <path d="M38 36 Q44 40 50 44" stroke="#fef2f2" strokeWidth="1.5" strokeDasharray="2 2" fill="none" />
          </svg>

          <div>
            <h1
              className="font-display text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-none"
              style={{ textShadow: '0 4px 16px rgba(0,0,0,0.65)' }}
            >
              CREASE CLASH
            </h1>
            <p className="text-sm md:text-base font-medium text-amber-300/95 mt-1">
              Skill-Led 3D Cricket Simulation · Practice Nets
            </p>
          </div>
        </div>

        <p className="text-sm md:text-base text-slate-200 leading-relaxed mb-6 max-w-md">
          Choose your bowling pace, line, length, and swing. Step into the crease, select Front Foot,
          Back Foot, or Leave, and time your Drive or Defence with continuous 3D bat-ball physics.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStartWorld();
            }}
            className="px-6 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold text-base tracking-wide transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-lg"
          >
            Enter Practice Nets
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenSpecs();
            }}
            className="px-5 py-3.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-100 border border-slate-700 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Simulation & Physics Specs
          </button>
        </div>
      </div>

      {/* Bottom flat inline control hint */}
      <div className="text-xs text-slate-300/90 font-medium">
        Space Bowl / Next Ball · W/S/X Footwork · A/E/D Aim · J Play Drive · K Play Defence · P Specs
      </div>
    </div>
  );
};
