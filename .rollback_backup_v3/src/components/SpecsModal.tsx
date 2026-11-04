import React from 'react';
import {
  BALL_CONSTANTS,
  LOCKED_GAMEPLAY_CAMERA,
  PITCH_CONSTANTS,
  WICKET_CONSTANTS,
} from '../shared/constants';
import { computeCameraElevationAngleDeg } from '../shared/coordinates';

interface SpecsModalProps {
  onClose: () => void;
}

export const SpecsModal: React.FC<SpecsModalProps> = ({ onClose }) => {
  const camAngle = computeCameraElevationAngleDeg(
    LOCKED_GAMEPLAY_CAMERA.position,
    LOCKED_GAMEPLAY_CAMERA.lookAt,
  );

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(2, 6, 23, 0.84)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="specs-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div>
            <h2 id="specs-modal-title" className="font-display text-3xl font-bold tracking-wide text-white">
              CREASE CLASH — Simulation & Physics Specification
            </h2>
            <p className="text-xs text-emerald-400 font-medium mt-0.5">
              Verified Cricket World Coordinates, Telephoto Broadcast Camera & Continuous 3D Bat-Ball Physics
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
          >
            Resume Nets [Esc]
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono-tabular mb-5">
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
            <h3 className="text-sm font-bold text-amber-400 mb-2">1. Camera & Coordinate Bijection</h3>
            <ul className="space-y-1.5 text-slate-300">
              <li>Cricket World: (X across, Y pitch length, Z height)</li>
              <li>Three.js Mapping: Cricket (X, Y, Z) → Three.js (X, Z, -Y)</li>
              <li>Inverse Mapping: Three.js (Xt, Yt, Zt) → Cricket (Xt, -Zt, Yt)</li>
              <li>
                Locked Camera: ({LOCKED_GAMEPLAY_CAMERA.position.x}, {LOCKED_GAMEPLAY_CAMERA.position.y}m,{' '}
                {LOCKED_GAMEPLAY_CAMERA.position.z}m)
              </li>
              <li>
                LookAt Target: ({LOCKED_GAMEPLAY_CAMERA.lookAt.x}, {LOCKED_GAMEPLAY_CAMERA.lookAt.y}m,{' '}
                {LOCKED_GAMEPLAY_CAMERA.lookAt.z}m) · {camAngle.toFixed(2)}° · FOV {LOCKED_GAMEPLAY_CAMERA.fovDegrees}°
              </li>
            </ul>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
            <h3 className="text-sm font-bold text-emerald-400 mb-2">2. Continuous Collision & Wickets</h3>
            <ul className="space-y-1.5 text-slate-300">
              <li>
                Pitch Strip: {PITCH_CONSTANTS.LENGTH_METERS}m × {PITCH_CONSTANTS.WIDTH_METERS}m
              </li>
              <li>
                Wicket Envelope: {WICKET_CONSTANTS.STUMP_HEIGHT_Z}m high × {WICKET_CONSTANTS.TOTAL_WIDTH_X}m wide
              </li>
              <li>
                3 Stumps (Ø {WICKET_CONSTANTS.STUMP_DIAMETER_METERS}m) + 2 Separate Bails
              </li>
              <li>
                CCD Substeps: ≥20 micro-substeps per 1/120s step (zero tunneling at 150 km/h)
              </li>
              <li>
                3D OBB Bat Blade: {BALL_CONSTANTS.RADIUS_METERS.toFixed(4)}m sphere vs oriented willow blade
              </li>
            </ul>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs">
          <h3 className="text-sm font-bold text-white mb-2">Staged Engineering Roadmap (Honest Status)</h3>
          <div className="space-y-1.5 text-slate-300">
            <div>
              <span className="text-emerald-400 font-semibold">[COMPLETE] Milestone 1 & Practice Nets:</span> Locked
              26° broadcast camera, sculpted 3D players with side-on stance, 9-phase ball flight/bounce physics,
              20-substep 3D OBB bat-ball collision, Drive vs Defence physics, and Bowled bail dislodgement.
            </div>
            <div>
              <span className="text-slate-400 font-semibold">[PLANNED] Milestones 3–5:</span> Expanded 19-delivery &
              17-shot libraries, AI fielding interception/catching, live running between wickets, and 5-over rules engine.
            </div>
            <div>
              <span className="text-slate-400 font-semibold">[PLANNED] Milestones 6–7:</span> Server-authoritative
              Socket.IO 1v1 multiplayer and mobile audio/haptics polish.
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            data-start="true"
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs tracking-wide transition-colors cursor-pointer"
          >
            Back to Practice Nets
          </button>
        </div>
      </div>
    </div>
  );
};
