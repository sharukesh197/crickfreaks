import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CricketVec3,
  cricketToThree,
  computeCameraElevationAngleDeg,
} from '../../shared/coordinates';
import {
  PITCH_CONSTANTS,
  BoundaryConfig,
  DEFAULT_BOUNDARY_CONFIG,
  LOCKED_GAMEPLAY_CAMERA,
  CORE_ACTOR_POSITIONS,
  FIELD_PRESETS,
  FieldPreset,
  BallColorVariant,
  getBoundaryRadiusAtAngle,
} from '../../shared/constants';
import {
  BallSimulationState,
  BowlingDeliverySetup,
  createDeliverySimulation,
  DeliveryOutcomeSummary,
  stepDeliverySimulation,
} from '../../shared/ballPhysics';
import {
  BatterHandedness,
  BattingIntentInput,
  FootworkType,
  ResolvedShotSpec,
  ShotIntentType,
  resolveIntendedShot,
} from '../../shared/batCollision';
import { createProceduralTextures, ProceduralTextureBundle } from './proceduralMaterials';
import { createRegulationWicket, WicketHandle } from '../models/WicketModel';
import {
  animateBowlerDeliverySequence,
  animateFielderPosture,
  animateNonStrikerSequence,
  animateStrikerShotSequence,
  animateUmpireSequence,
  animateWicketkeeperSequence,
  applyCanonicalStrikerReadyStance,
  ArticulatedPlayerRig,
  BATTING_TEAM_PALETTE,
  BOWLING_TEAM_PALETTE,
  CricketBallVisualHandle,
  createBatterModel,
  createBowlerModel,
  createCricketBallModel,
  createFielderModel,
  createUmpireModel,
  createWicketkeeperModel,
} from '../models/CricketActors';

export type LightingPresetId = 'daylight' | 'late_afternoon' | 'floodlights';
export type PracticePlayPhase = 'SETUP' | 'RUNUP' | 'LIVE_BALL' | 'OUTCOME';

export interface RadarFielderPoint {
  id: string;
  roleName: string;
  x: number;
  y: number;
}

export interface LivePracticeTelemetry {
  playPhase: PracticePlayPhase;
  ballPhase: string;
  simTimeSec: number;
  idealSwingTriggerTimeSec: number;
  /** Normalized progress [0..1.35] toward ideal swing timing window for HUD timing bar */
  timingMeterProgress: number;
  ballPositionCricket: CricketVec3;
  cameraElevationDeg: number;
  latestOutcome: DeliveryOutcomeSummary | null;
  hasTriggeredSwing: boolean;
  resolvedIntendedShot: ResolvedShotSpec;
  fielderPositions: RadarFielderPoint[];
}

export class CricketWorldScene {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly isSoftwareGl: boolean;

  private readonly container: HTMLElement;
  private readonly textures: ProceduralTextureBundle;
  private readonly resizeObserver: ResizeObserver;

  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly rimLight: THREE.DirectionalLight;

  private readonly boundaryGroup: THREE.Group;
  private boundaryConfig: BoundaryConfig = DEFAULT_BOUNDARY_CONFIG;

  public readonly bowlerWicket: WicketHandle;
  public readonly strikerWicket: WicketHandle;

  public readonly bowlerRig: ArticulatedPlayerRig;
  public readonly strikerRig: ArticulatedPlayerRig;
  public readonly nonStrikerRig: ArticulatedPlayerRig;
  public readonly wicketkeeperRig: ArticulatedPlayerRig;
  public readonly umpireRig: ArticulatedPlayerRig;
  public readonly fielderRigs: Map<
    string,
    { rig: ArticulatedPlayerRig; roleName: string; targetPos: CricketVec3; currentPos: CricketVec3 }
  > = new Map();

  public readonly ballHandle: CricketBallVisualHandle;
  private readonly pitchTargetReticle: THREE.Group;
  private readonly strikerAimWedgeGroup: THREE.Group;
  private readonly pitchBounceRing: THREE.Mesh;
  private readonly ballTrailLine: THREE.Line;
  private readonly ballTrailPositions: Float32Array;

  // Authoritative Practice Nets Simulation State
  private playPhase: PracticePlayPhase = 'SETUP';
  private runupElapsedSec = 0;
  private readonly RUNUP_DURATION_SEC = 0.58;
  private followThroughElapsedSec = 0;
  private physicsAccumulatorSec = 0;

  private deliverySetup: BowlingDeliverySetup = {
    speedKmh: 136,
    targetLineX: 0.06,
    targetLengthY: 14.8,
    movementType: 'outswing',
    releaseX: -0.36,
  };

  private battingInput: BattingIntentInput = {
    footwork: 'front_foot',
    shotIntent: 'stroke',
    aimAngleDeg: 35,
    handedness: 'RHB',
    swingTriggerTimeSec: null,
    anticipatedLineX: 0.06,
    anticipatedHeightZ: 0.38,
  };

  private ballSimState: BallSimulationState | null = null;
  private latestOutcome: DeliveryOutcomeSummary | null = null;
  private onStateChangeCallback?: (telemetry: LivePracticeTelemetry) => void;

  private frameId = 0;
  private isDisposed = false;
  private lastTimestamp = 0;

  constructor(container: HTMLElement, onStateChange?: (telemetry: LivePracticeTelemetry) => void) {
    this.container = container;
    this.onStateChangeCallback = onStateChange;

    this.isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 240);
    this.renderer.setSize(width, height);
    this.renderer.domElement.className = 'block w-full h-full';
    this.renderer.domElement.setAttribute('data-testid', 'cricket-3d-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6da8e1);
    this.scene.fog = new THREE.FogExp2(0x6da8e1, 0.0028);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Locked Broadcast Behind-the-Bowler Camera
    this.camera = new THREE.PerspectiveCamera(
      LOCKED_GAMEPLAY_CAMERA.fovDegrees,
      width / height,
      LOCKED_GAMEPLAY_CAMERA.near,
      LOCKED_GAMEPLAY_CAMERA.far,
    );
    this.applyLockedCamera();

    // Studio 3-Point Warm/Cool Lighting
    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1a381a, 0.9);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    const sunThreePos = cricketToThree({ x: 28, y: -14, z: 38 });
    this.sunLight.position.set(sunThreePos.x, sunThreePos.y, sunThreePos.z);
    this.sunLight.castShadow = !this.isSoftwareGl;
    if (!this.isSoftwareGl) {
      this.sunLight.shadow.mapSize.set(1024, 1024);
      this.sunLight.shadow.camera.near = 5;
      this.sunLight.shadow.camera.far = 110;
      const d = 28;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight(0xbae6fd, 0.6);
    const rimThreePos = cricketToThree({ x: -24, y: 42, z: 18 });
    this.rimLight.position.set(rimThreePos.x, rimThreePos.y, rimThreePos.z);
    this.scene.add(this.rimLight);

    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAnisotropy);

    // Ground, Pitch, Creases & Stadium Bowl
    this.buildCricketOutfieldAndPitch();
    this.boundaryGroup = new THREE.Group();
    this.scene.add(this.boundaryGroup);
    this.rebuildBoundaryAndStadium(this.boundaryConfig);

    // Regulation Wickets at Both Ends
    this.bowlerWicket = createRegulationWicket(
      'bowler',
      PITCH_CONSTANTS.BOWLER_STUMPS_Y,
      this.textures.willowWoodMap,
      !this.isSoftwareGl,
    );
    this.strikerWicket = createRegulationWicket(
      'striker',
      PITCH_CONSTANTS.STRIKER_STUMPS_Y,
      this.textures.willowWoodMap,
      !this.isSoftwareGl,
    );
    this.scene.add(this.bowlerWicket.group);
    this.scene.add(this.strikerWicket.group);

    // On-Field Articulated Players with Canonical Orientations
    this.bowlerRig = createBowlerModel(BOWLING_TEAM_PALETTE, !this.isSoftwareGl);
    this.scene.add(this.bowlerRig.root);

    this.strikerRig = createBatterModel(
      'striker',
      BATTING_TEAM_PALETTE,
      this.textures.willowWoodMap,
      !this.isSoftwareGl,
    );
    applyCanonicalStrikerReadyStance(this.strikerRig, 0, 'RHB');
    this.scene.add(this.strikerRig.root);

    this.nonStrikerRig = createBatterModel(
      'non_striker',
      BATTING_TEAM_PALETTE,
      this.textures.willowWoodMap,
      !this.isSoftwareGl,
    );
    animateNonStrikerSequence(this.nonStrikerRig, 'SETUP', 0);
    this.scene.add(this.nonStrikerRig.root);

    this.wicketkeeperRig = createWicketkeeperModel(BOWLING_TEAM_PALETTE, !this.isSoftwareGl);
    animateWicketkeeperSequence(this.wicketkeeperRig, 'SETUP', undefined, this.deliverySetup.targetLineX);
    this.scene.add(this.wicketkeeperRig.root);

    this.umpireRig = createUmpireModel(!this.isSoftwareGl);
    animateUmpireSequence(this.umpireRig, 'SETUP', 'none', 0);
    this.scene.add(this.umpireRig.root);

    const initialPreset = FIELD_PRESETS[1]; // Balanced Powerplay
    for (const fSpec of initialPreset.fielders) {
      const rig = createFielderModel(fSpec.id, BOWLING_TEAM_PALETTE, !this.isSoftwareGl);
      animateFielderPosture(rig, fSpec.position, 'SETUP', 0, undefined, false);
      this.scene.add(rig.root);
      this.fielderRigs.set(fSpec.id, {
        rig,
        roleName: fSpec.roleName,
        currentPos: { ...fSpec.position },
        targetPos: { ...fSpec.position },
      });
    }

    // Interactive 3D Pitch Aiming Target Reticle
    this.pitchTargetReticle = this.createPitchTargetReticle();
    this.scene.add(this.pitchTargetReticle);
    this.updatePitchTargetReticlePosition();

    // Interactive 360° Ground Aiming Wedge at Striker's Crease
    this.strikerAimWedgeGroup = this.createStrikerAimWedge();
    this.scene.add(this.strikerAimWedgeGroup);
    this.updateStrikerAimWedge();

    // Pitch Bounce Impact Ring
    const bounceRingGeo = new THREE.RingGeometry(0.08, 0.16, 24);
    bounceRingGeo.rotateX(-Math.PI / 2);
    const bounceRingMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.pitchBounceRing = new THREE.Mesh(bounceRingGeo, bounceRingMat);
    this.pitchBounceRing.visible = false;
    this.scene.add(this.pitchBounceRing);

    // 3D Ball Flight Trail Line
    const maxTrailPoints = 96;
    this.ballTrailPositions = new Float32Array(maxTrailPoints * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.ballTrailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.85,
    });
    this.ballTrailLine = new THREE.Line(trailGeo, trailMat);
    this.ballTrailLine.frustumCulled = false;
    this.scene.add(this.ballTrailLine);

    // High-Visibility Leather Cricket Ball
    this.ballHandle = createCricketBallModel(this.textures.ballMaps, 'red');
    this.resetToSetupState();
    this.scene.add(this.ballHandle.root);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (this.isDisposed) return;
      const w = Math.max(this.container.clientWidth, 320);
      const h = Math.max(this.container.clientHeight, 240);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
    this.resizeObserver.observe(this.container);

    this.lastTimestamp = performance.now();
    this.tick();
  }

  public applyLockedCamera(): void {
    const camThree = cricketToThree(LOCKED_GAMEPLAY_CAMERA.position);
    const lookThree = cricketToThree(LOCKED_GAMEPLAY_CAMERA.lookAt);
    this.camera.position.set(camThree.x, camThree.y, camThree.z);
    this.camera.lookAt(lookThree.x, lookThree.y, lookThree.z);
    this.camera.updateProjectionMatrix();
  }

  private createPitchTargetReticle(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'pitch_target_reticle';

    const outerRingGeo = new THREE.RingGeometry(0.24, 0.34, 32);
    outerRingGeo.rotateX(-Math.PI / 2);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(outerRingGeo, outerRingMat));

    const innerDiscGeo = new THREE.CircleGeometry(0.11, 24);
    innerDiscGeo.rotateX(-Math.PI / 2);
    const innerDiscMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(innerDiscGeo, innerDiscMat));

    return group;
  }

  private createStrikerAimWedge(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'striker_360_aim_wedge';

    // Subtle circular compass ring around striker's crease
    const baseRingGeo = new THREE.RingGeometry(1.15, 1.24, 48);
    baseRingGeo.rotateX(-Math.PI / 2);
    const baseRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(baseRingGeo, baseRingMat));

    // Directional aiming cone wedge pointing along +Z in local space (rotated via rotation.y)
    // In Three.js: Cricket (0, -1, 0) [Straight down pitch] maps to Three.js (0, 0, +1).
    const wedgeSpreadRad = 0.34;
    const wedgeGeo = new THREE.RingGeometry(
      1.28,
      4.4,
      18,
      1,
      Math.PI / 2 - wedgeSpreadRad / 2,
      wedgeSpreadRad,
    );
    wedgeGeo.rotateX(Math.PI / 2);
    const wedgeMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wedgeMesh = new THREE.Mesh(wedgeGeo, wedgeMat);
    wedgeMesh.name = 'aim_wedge_cone';
    group.add(wedgeMesh);

    // Center direction arrow spear
    const arrowGeo = new THREE.PlaneGeometry(0.14, 3.6);
    arrowGeo.rotateX(-Math.PI / 2);
    arrowGeo.translate(0, 0, 2.8);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(arrowGeo, arrowMat));

    return group;
  }

  private updateStrikerAimWedge(): void {
    const threePos = cricketToThree({
      x: 0,
      y: CORE_ACTOR_POSITIONS.STRIKER_STANCE.y,
      z: 0.025,
    });
    this.strikerAimWedgeGroup.position.set(threePos.x, threePos.y, threePos.z);

    // Aim angle 0° is straight toward bowler (Cricket -Y => Three +Z).
    // Aim angle +90° is toward +X (Three +X), which is a +90° rotation around Three +Y.
    const aimRad = ((this.battingInput.aimAngleDeg ?? 0) * Math.PI) / 180;
    this.strikerAimWedgeGroup.rotation.y = aimRad;
    this.strikerAimWedgeGroup.visible =
      this.battingInput.footwork !== 'leave' &&
      (this.playPhase === 'SETUP' || this.playPhase === 'RUNUP');
  }

  private updatePitchTargetReticlePosition(): void {
    const threePos = cricketToThree({
      x: this.deliverySetup.targetLineX,
      y: this.deliverySetup.targetLengthY,
      z: 0.036,
    });
    this.pitchTargetReticle.position.set(threePos.x, threePos.y, threePos.z);
  }

  /**
   * Computes the batter's natural bat-path alignment from the bowler's release-to-bounce line
   * and selected footwork, leaving late swing/seam/spin deviation to genuinely challenge the
   * middle vs outside/inside edge of the bat.
   */
  private syncBatterAnticipationFromFlight(): void {
    const previewSim = createDeliverySimulation(this.deliverySetup);
    const arrival = previewSim.footworkExpectedArrival[this.battingInput.footwork];
    if (arrival) {
      this.battingInput.anticipatedLineX = arrival.ballX;
      this.battingInput.anticipatedHeightZ = arrival.ballZ;
    }
  }

  /**
   * Updates bowling setup parameters (Pace, Line X, Length Y, Movement) and updates the 3D pitch reticle.
   */
  public setBowlingDeliverySetup(partial: Partial<BowlingDeliverySetup>): void {
    this.deliverySetup = { ...this.deliverySetup, ...partial };
    this.updatePitchTargetReticlePosition();
    this.syncBatterAnticipationFromFlight();
    this.emitTelemetry();
  }

  public getBowlingDeliverySetup(): BowlingDeliverySetup {
    return { ...this.deliverySetup };
  }

  /**
   * Updates the batter's selected Footwork, Shot Intent, 360° Aim Angle, or Handedness.
   */
  public setBattingSelection(
    partial: Partial<
      Pick<BattingIntentInput, 'footwork' | 'shotIntent' | 'aimAngleDeg' | 'handedness'>
    >,
  ): void {
    this.battingInput = { ...this.battingInput, ...partial };
    this.syncBatterAnticipationFromFlight();
    this.updateStrikerAimWedge();

    if (this.playPhase === 'SETUP') {
      applyCanonicalStrikerReadyStance(
        this.strikerRig,
        0,
        this.battingInput.handedness ?? 'RHB',
      );
    }

    // If a pre-committed swing is already armed during SETUP/RUNUP and footwork changed,
    // re-align the armed trigger timestamp to the new footwork's ideal contact arrival.
    if (
      this.battingInput.swingTriggerTimeSec !== null &&
      (this.playPhase === 'SETUP' || this.playPhase === 'RUNUP')
    ) {
      const previewSim = createDeliverySimulation(this.deliverySetup);
      const fwArrival = previewSim.footworkExpectedArrival[this.battingInput.footwork];
      this.battingInput.swingTriggerTimeSec = fwArrival.idealSwingTriggerTimeSec;
    }

    this.emitTelemetry();
  }

  /**
   * Starts the bowler's run-up and delivery sequence (BOWL button action).
   */
  public startBowlingDelivery(): void {
    if (this.playPhase === 'RUNUP' || this.playPhase === 'LIVE_BALL') return;

    this.strikerWicket.resetWicket();
    this.bowlerWicket.resetWicket();
    this.pitchBounceRing.visible = false;
    this.ballTrailLine.geometry.setDrawRange(0, 0);
    this.latestOutcome = null;
    this.battingInput.swingTriggerTimeSec = null;
    this.syncBatterAnticipationFromFlight();

    this.playPhase = 'RUNUP';
    this.runupElapsedSec = 0;
    this.followThroughElapsedSec = 0;
    this.physicsAccumulatorSec = 0;
    this.updateStrikerAimWedge();
    this.emitTelemetry();
  }

  /**
   * Triggers the batter's shot swing (`PUSH`, `STROKE`, `LOFT`, or `SPECIAL`) at the current simulation instant.
   * Supports an optional `timingOffsetOverrideSec` (e.g., for testing or training mistimed early/late edges),
   * while live gameplay uses either pre-commit during RUNUP or real-time reflex timing during LIVE_BALL.
   */
  public triggerBattingShot(
    shotIntent: ShotIntentType,
    footworkOverride?: FootworkType,
    timingOffsetOverrideSec?: number,
  ): void {
    if (footworkOverride) {
      this.battingInput.footwork = footworkOverride;
    } else if (this.battingInput.footwork === 'leave') {
      this.battingInput.footwork = 'front_foot';
    }
    this.battingInput.shotIntent = shotIntent;
    this.syncBatterAnticipationFromFlight();
    this.updateStrikerAimWedge();

    const getIdealTriggerForCurrentFootwork = (sim: BallSimulationState): number => {
      return (
        sim.footworkExpectedArrival[this.battingInput.footwork]?.idealSwingTriggerTimeSec ??
        sim.idealSwingTriggerTimeSec
      );
    };

    if (this.playPhase === 'SETUP') {
      this.startBowlingDelivery();
      const previewSim = createDeliverySimulation(this.deliverySetup);
      const idealTrigger = getIdealTriggerForCurrentFootwork(previewSim);
      this.battingInput.swingTriggerTimeSec = idealTrigger + (timingOffsetOverrideSec ?? 0);
      this.emitTelemetry();
      return;
    }

    if (this.playPhase === 'RUNUP') {
      const previewSim = createDeliverySimulation(this.deliverySetup);
      const idealTrigger = getIdealTriggerForCurrentFootwork(previewSim);
      this.battingInput.swingTriggerTimeSec = idealTrigger + (timingOffsetOverrideSec ?? 0);
      this.emitTelemetry();
      return;
    }

    if (this.playPhase === 'LIVE_BALL' && this.ballSimState) {
      const idealTrigger = getIdealTriggerForCurrentFootwork(this.ballSimState);
      if (timingOffsetOverrideSec !== undefined) {
        this.battingInput.swingTriggerTimeSec = idealTrigger + timingOffsetOverrideSec;
        this.emitTelemetry();
        return;
      }

      if (this.battingInput.swingTriggerTimeSec === null) {
        const currentSimTime = this.ballSimState.simTimeSec;
        if (currentSimTime < idealTrigger - 0.042) {
          this.battingInput.swingTriggerTimeSec = idealTrigger - 0.022;
        } else {
          this.battingInput.swingTriggerTimeSec = currentSimTime;
        }
        this.emitTelemetry();
      }
    }
  }

  /**
   * Resets the scene back to the ready SETUP state for the next ball (NEXT BALL / RESET button).
   */
  public resetToSetupState(): void {
    this.playPhase = 'SETUP';
    this.runupElapsedSec = 0;
    this.followThroughElapsedSec = 0;
    this.ballSimState = null;
    this.latestOutcome = null;
    this.battingInput.swingTriggerTimeSec = null;

    this.strikerWicket.resetWicket();
    this.bowlerWicket.resetWicket();
    this.pitchBounceRing.visible = false;
    this.pitchTargetReticle.visible = true;
    this.ballTrailLine.geometry.setDrawRange(0, 0);
    this.updateStrikerAimWedge();

    const handedness: BatterHandedness = this.battingInput.handedness ?? 'RHB';

    animateBowlerDeliverySequence(this.bowlerRig, 'idle', 0, this.deliverySetup.releaseX ?? -0.36);
    applyCanonicalStrikerReadyStance(this.strikerRig, 0, handedness);
    animateNonStrikerSequence(this.nonStrikerRig, 'SETUP', 0);
    animateWicketkeeperSequence(
      this.wicketkeeperRig,
      'SETUP',
      undefined,
      this.deliverySetup.targetLineX,
    );
    animateUmpireSequence(this.umpireRig, 'SETUP', 'none', 0);

    // Place ball in bowler's hand at top of run-up
    this.ballHandle.setCricketPosition({ x: -0.32, y: -2.2, z: 1.15 }, 0);
    this.emitTelemetry();
  }

  public setFieldPreset(presetId: FieldPreset['id']): void {
    const preset = FIELD_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    for (const fSpec of preset.fielders) {
      const entry = this.fielderRigs.get(fSpec.id);
      if (entry) {
        entry.targetPos = { ...fSpec.position };
      }
    }
    this.emitTelemetry();
  }

  public setBallVariant(variant: BallColorVariant): void {
    this.ballHandle.setVariant(variant);
  }

  public setLightingPreset(preset: LightingPresetId): void {
    if (preset === 'daylight') {
      this.scene.background = new THREE.Color(0x6da8e1);
      this.scene.fog = new THREE.FogExp2(0x6da8e1, 0.0028);
      this.sunLight.color.setHex(0xfffbeb);
      this.sunLight.intensity = 2.2;
      this.hemiLight.color.setHex(0xe0f2fe);
      this.hemiLight.groundColor.setHex(0x1a381a);
    } else if (preset === 'late_afternoon') {
      this.scene.background = new THREE.Color(0xd99b66);
      this.scene.fog = new THREE.FogExp2(0xd99b66, 0.0032);
      this.sunLight.color.setHex(0xfde68a);
      this.sunLight.intensity = 2.3;
      this.hemiLight.color.setHex(0xfed7aa);
      this.hemiLight.groundColor.setHex(0x292524);
    } else {
      this.scene.background = new THREE.Color(0x0b1329);
      this.scene.fog = new THREE.FogExp2(0x0b1329, 0.0036);
      this.sunLight.color.setHex(0xe0f2fe);
      this.sunLight.intensity = 2.4;
      this.hemiLight.color.setHex(0x38bdf8);
      this.hemiLight.groundColor.setHex(0x0f172a);
    }
  }

  private buildCricketOutfieldAndPitch(): void {
    const turfGeo = new THREE.CircleGeometry(105, 64);
    turfGeo.rotateX(-Math.PI / 2);
    const turfMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.textures.outfieldMap,
      roughnessMap: this.textures.outfieldRoughnessMap,
      roughness: 0.86,
      metalness: 0.02,
    });
    const turfMesh = new THREE.Mesh(turfGeo, turfMat);
    const turfCenterThree = cricketToThree({ x: 0, y: PITCH_CONSTANTS.MIDPOINT_Y, z: 0 });
    turfMesh.position.set(turfCenterThree.x, turfCenterThree.y, turfCenterThree.z);
    turfMesh.receiveShadow = true;
    this.scene.add(turfMesh);

    // Concentric mowed turf rings for authentic stadium field depth
    for (const rRing of [18, 36, 52]) {
      const ringGeo = new THREE.RingGeometry(rRing, rRing + 4.5, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x3b8a3e,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(turfCenterThree.x, 0.004, turfCenterThree.z);
      this.scene.add(ringMesh);
    }

    // Prepared Cricket Pitch Strip (3.05m wide x 23.6m total bed)
    const pitchBedLength = PITCH_CONSTANTS.LENGTH_METERS + 3.4;
    const pitchGeo = new THREE.PlaneGeometry(PITCH_CONSTANTS.WIDTH_METERS, pitchBedLength);
    pitchGeo.rotateX(-Math.PI / 2);
    const pitchMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.textures.pitchMap,
      bumpMap: this.textures.pitchBumpMap,
      bumpScale: 0.018,
      roughness: 0.8,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
    const pitchCenterThree = cricketToThree({
      x: 0,
      y: PITCH_CONSTANTS.MIDPOINT_Y,
      z: 0.008,
    });
    pitchMesh.position.set(pitchCenterThree.x, pitchCenterThree.y, pitchCenterThree.z);
    pitchMesh.receiveShadow = true;
    this.scene.add(pitchMesh);

    const creaseMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.addEndCreaseMarkings('bowler', creaseMat);
    this.addEndCreaseMarkings('striker', creaseMat);

    // 30-Yard (27.43m) Inner Fielding Restriction Circle
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    });
    const circleRadius = 27.43;
    const dashCount = 48;
    for (let i = 0; i < dashCount; i++) {
      const a0 = (i / dashCount) * Math.PI * 2;
      const cx = Math.sin(a0) * circleRadius;
      const cy = PITCH_CONSTANTS.MIDPOINT_Y + Math.cos(a0) * circleRadius;
      const dashGeo = new THREE.PlaneGeometry(0.18, 1.4);
      dashGeo.rotateX(-Math.PI / 2);
      const dashMesh = new THREE.Mesh(dashGeo, innerRingMat);
      const threePos = cricketToThree({ x: cx, y: cy, z: 0.012 });
      dashMesh.position.set(threePos.x, threePos.y, threePos.z);
      dashMesh.rotation.y = -(a0 + Math.PI / 2);
      this.scene.add(dashMesh);
    }
  }

  private addEndCreaseMarkings(end: 'bowler' | 'striker', mat: THREE.Material): void {
    const dir = end === 'bowler' ? 1 : -1;
    const stumpY = end === 'bowler' ? PITCH_CONSTANTS.BOWLER_STUMPS_Y : PITCH_CONSTANTS.STRIKER_STUMPS_Y;
    const poppingY = stumpY + dir * PITCH_CONSTANTS.POPPING_CREASE_OFFSET;
    const backY = stumpY - dir * PITCH_CONSTANTS.RETURN_CREASE_BACK_EXTENSION;
    const lw = PITCH_CONSTANTS.LINE_WIDTH_METERS * 1.15;
    const zLine = 0.015;

    const addLineRect = (centerX: number, centerY: number, widthX: number, lengthY: number) => {
      const geo = new THREE.PlaneGeometry(widthX, lengthY);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      const threePos = cricketToThree({ x: centerX, y: centerY, z: zLine });
      mesh.position.set(threePos.x, threePos.y, threePos.z);
      this.scene.add(mesh);
    };

    addLineRect(0, stumpY, PITCH_CONSTANTS.BOWLING_CREASE_WIDTH_X, lw);
    addLineRect(0, poppingY, PITCH_CONSTANTS.POPPING_CREASE_WIDTH_X, lw);

    const returnLengthY = Math.abs(poppingY - backY);
    const returnMidY = (poppingY + backY) / 2;
    addLineRect(-PITCH_CONSTANTS.RETURN_CREASE_HALF_X, returnMidY, lw, returnLengthY);
    addLineRect(PITCH_CONSTANTS.RETURN_CREASE_HALF_X, returnMidY, lw, returnLengthY);

    const wideMidY = (stumpY + poppingY) / 2;
    addLineRect(-PITCH_CONSTANTS.WIDE_GUIDELINE_X, wideMidY, lw * 0.85, PITCH_CONSTANTS.POPPING_CREASE_OFFSET);
    addLineRect(PITCH_CONSTANTS.WIDE_GUIDELINE_X, wideMidY, lw * 0.85, PITCH_CONSTANTS.POPPING_CREASE_OFFSET);
  }

  public rebuildBoundaryAndStadium(config: BoundaryConfig): void {
    this.boundaryConfig = config;
    while (this.boundaryGroup.children.length > 0) {
      this.boundaryGroup.remove(this.boundaryGroup.children[0]);
    }

    const segments = 96;
    const ropePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const r = getBoundaryRadiusAtAngle(theta, config);
      const x = config.centerX + Math.sin(theta) * r;
      const y = config.centerY + Math.cos(theta) * r;
      const threePt = cricketToThree({ x, y, z: 0.06 });
      ropePoints.push(new THREE.Vector3(threePt.x, threePt.y, threePt.z));
    }

    const ropeCurve = new THREE.CatmullRomCurve3(ropePoints, true);
    const ropeGeo = new THREE.TubeGeometry(ropeCurve, 96, 0.065, 8, true);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    this.boundaryGroup.add(new THREE.Mesh(ropeGeo, ropeMat));

    const wallRx = config.squareBoundaryMeters + config.outfieldMarginMeters;
    const wallRy = config.straightBoundaryMeters + config.outfieldMarginMeters;

    // Championship LED Perimeter Advertising Hoardings
    const hoardingSegments = 64;
    const boardMatEven = new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.35 });
    const boardMatOdd = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.35 });
    const boardAccentMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3 });

    for (let i = 0; i < hoardingSegments; i++) {
      const theta = (i / hoardingSegments) * Math.PI * 2;
      const r = getBoundaryRadiusAtAngle(theta, config) + 2.8;
      const x = config.centerX + Math.sin(theta) * r;
      const y = config.centerY + Math.cos(theta) * r;
      const threePt = cricketToThree({ x, y, z: 0.52 });

      const board = new THREE.Mesh(
        new THREE.BoxGeometry(6.8, 1.04, 0.18),
        i % 3 === 0 ? boardAccentMat : i % 2 === 0 ? boardMatEven : boardMatOdd,
      );
      board.position.set(threePt.x, threePt.y, threePt.z);
      board.rotation.y = -theta;
      this.boundaryGroup.add(board);
    }

    // Far Sightscreen behind Striker's End
    const sightscreen = new THREE.Mesh(
      new THREE.BoxGeometry(15.5, 4.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 }),
    );
    const ssPos = cricketToThree({ x: 0, y: config.centerY + wallRy - 0.5, z: 2.4 });
    sightscreen.position.set(ssPos.x, ssPos.y, ssPos.z);
    this.boundaryGroup.add(sightscreen);

    // Multi-Tiered Grandstands with Colored Crowd Bands
    const standSegments = 48;
    const lowerWallMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const crowdMatA = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 });
    const crowdMatB = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.6 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.2 });

    for (let i = 0; i < standSegments; i++) {
      const theta = (i / standSegments) * Math.PI * 2;
      if (Math.abs(Math.sin(theta)) < 0.11 && Math.cos(theta) > 0) continue;

      const x = config.centerX + Math.sin(theta) * (wallRx + 2.5);
      const y = config.centerY + Math.cos(theta) * (wallRy + 2.5);
      const segGroup = new THREE.Group();
      const threePos = cricketToThree({ x, y, z: 0 });
      segGroup.position.set(threePos.x, threePos.y, threePos.z);
      segGroup.rotation.y = -theta;

      const barrier = new THREE.Mesh(new THREE.BoxGeometry(10.0, 1.5, 0.8), lowerWallMat);
      barrier.position.set(0, 0.75, 0);
      segGroup.add(barrier);

      const seating = new THREE.Mesh(new THREE.BoxGeometry(10.4, 5.2, 6.2), tierMat);
      seating.position.set(0, 3.0, -3.1);
      seating.rotation.x = 0.3;
      segGroup.add(seating);

      const crowdRow1 = new THREE.Mesh(
        new THREE.BoxGeometry(10.2, 0.85, 1.8),
        i % 2 === 0 ? crowdMatA : crowdMatB,
      );
      crowdRow1.position.set(0, 2.6, -1.6);
      segGroup.add(crowdRow1);

      const crowdRow2 = new THREE.Mesh(
        new THREE.BoxGeometry(10.2, 0.85, 1.8),
        i % 2 === 0 ? crowdMatB : crowdMatA,
      );
      crowdRow2.position.set(0, 4.1, -3.4);
      segGroup.add(crowdRow2);

      const canopy = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.42, 7.2), roofMat);
      canopy.position.set(0, 7.4, -2.6);
      canopy.rotation.x = -0.14;
      segGroup.add(canopy);

      this.boundaryGroup.add(segGroup);
    }
  }

  private updateBallTrailGeometry(points: CricketVec3[]): void {
    const count = Math.min(points.length, 96);
    for (let i = 0; i < count; i++) {
      const pt = points[points.length - count + i];
      const threePt = cricketToThree(pt);
      this.ballTrailPositions[i * 3] = threePt.x;
      this.ballTrailPositions[i * 3 + 1] = threePt.y;
      this.ballTrailPositions[i * 3 + 2] = threePt.z;
    }
    const attr = this.ballTrailLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.ballTrailLine.geometry.setDrawRange(0, count);
  }

  private emitTelemetry(): void {
    if (!this.onStateChangeCallback) return;

    const simTime = this.ballSimState?.simTimeSec ?? 0;
    const idealTime =
      this.ballSimState?.footworkExpectedArrival[this.battingInput.footwork]
        ?.idealSwingTriggerTimeSec ??
      this.ballSimState?.idealSwingTriggerTimeSec ??
      0.45;
    const timingProgress =
      this.playPhase === 'LIVE_BALL'
        ? Math.max(0, Math.min(1.35, simTime / Math.max(0.1, idealTime)))
        : 0;

    const resolvedIntendedShot = resolveIntendedShot(this.battingInput);
    const fielderPositions: RadarFielderPoint[] = [];
    for (const [id, entry] of this.fielderRigs.entries()) {
      fielderPositions.push({
        id,
        roleName: entry.roleName,
        x: Number(entry.currentPos.x.toFixed(1)),
        y: Number(entry.currentPos.y.toFixed(1)),
      });
    }

    this.onStateChangeCallback({
      playPhase: this.playPhase,
      ballPhase: this.ballSimState?.phase ?? 'READY',
      simTimeSec: Number(simTime.toFixed(2)),
      idealSwingTriggerTimeSec: Number(idealTime.toFixed(2)),
      timingMeterProgress: Number(timingProgress.toFixed(3)),
      ballPositionCricket: this.ballSimState
        ? { ...this.ballSimState.position }
        : { x: -0.36, y: -2.2, z: 1.15 },
      cameraElevationDeg: Number(
        computeCameraElevationAngleDeg(
          LOCKED_GAMEPLAY_CAMERA.position,
          LOCKED_GAMEPLAY_CAMERA.lookAt,
        ).toFixed(1),
      ),
      latestOutcome: this.latestOutcome,
      hasTriggeredSwing: this.battingInput.swingTriggerTimeSec !== null,
      resolvedIntendedShot,
      fielderPositions,
    });
  }

  private afterDraw(cb: () => void): void {
    const delayMs = this.playPhase === 'RUNUP' || this.playPhase === 'LIVE_BALL' ? 24 : 75;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, delayMs);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.isDisposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 4);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, delayMs);
      }
    };
    this.frameId = window.setTimeout(poll, 4);
  }

  private tick = (): void => {
    if (this.isDisposed) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastTimestamp) / 1000, this.isSoftwareGl ? 0.55 : 0.085);
    this.lastTimestamp = now;

    this.updateSceneKinematics(dt, now * 0.001);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private updateSceneKinematics(dt: number, elapsedSec: number): void {
    const dampFactor = 1 - Math.exp(-6.5 * dt);
    const hasBatContact = Boolean(this.ballSimState?.batCollision?.collided);
    const liveBallPos = this.ballSimState?.position;
    const runupProgress =
      this.playPhase === 'RUNUP'
        ? Math.min(1, this.runupElapsedSec / this.RUNUP_DURATION_SEC)
        : 0;

    // 1. Smoothly damp AI fielders toward their preset positions and orient them canonically
    for (const entry of this.fielderRigs.values()) {
      const dx = entry.targetPos.x - entry.currentPos.x;
      const dy = entry.targetPos.y - entry.currentPos.y;
      if (Math.hypot(dx, dy) > 0.01) {
        entry.currentPos.x += dx * dampFactor;
        entry.currentPos.y += dy * dampFactor;
      }
      animateFielderPosture(
        entry.rig,
        entry.currentPos,
        this.playPhase,
        runupProgress,
        liveBallPos,
        hasBatContact,
      );
    }

    const resolvedShot = resolveIntendedShot(this.battingInput);
    const handedness: BatterHandedness = this.battingInput.handedness ?? 'RHB';

    // 2. State Machine Execution: SETUP -> RUNUP -> LIVE_BALL -> OUTCOME
    if (this.playPhase === 'SETUP') {
      animateBowlerDeliverySequence(
        this.bowlerRig,
        'idle',
        0,
        this.deliverySetup.releaseX ?? -0.36,
        elapsedSec * 2.2,
      );
      animateStrikerShotSequence(
        this.strikerRig,
        CORE_ACTOR_POSITIONS.STRIKER_STANCE,
        this.battingInput.footwork,
        resolvedShot,
        handedness,
        0,
        false,
        0,
      );
      animateNonStrikerSequence(this.nonStrikerRig, 'SETUP', 0);
      animateWicketkeeperSequence(
        this.wicketkeeperRig,
        'SETUP',
        undefined,
        this.deliverySetup.targetLineX,
      );
      animateUmpireSequence(this.umpireRig, 'SETUP', 'none', 0);
      this.ballHandle.setCricketPosition({ x: -0.32, y: -2.2, z: 1.15 }, elapsedSec * 1.5);
      return;
    }

    if (this.playPhase === 'RUNUP') {
      this.runupElapsedSec += dt;
      const u = Math.min(1, this.runupElapsedSec / this.RUNUP_DURATION_SEC);
      animateBowlerDeliverySequence(
        this.bowlerRig,
        'runup',
        u,
        this.deliverySetup.releaseX ?? -0.36,
      );

      // Move ball with bowler's hand during run-up
      const handY = -2.4 + u * (1.15 - -2.4);
      const handZ = u < 0.72 ? 1.18 : 1.18 + ((u - 0.72) / 0.28) * 0.9;
      this.ballHandle.setCricketPosition(
        { x: this.deliverySetup.releaseX ?? -0.36, y: handY, z: handZ },
        u * 12,
      );

      animateStrikerShotSequence(
        this.strikerRig,
        CORE_ACTOR_POSITIONS.STRIKER_STANCE,
        this.battingInput.footwork,
        resolvedShot,
        handedness,
        0,
        false,
        u,
      );
      animateNonStrikerSequence(this.nonStrikerRig, 'RUNUP', u);
      animateWicketkeeperSequence(
        this.wicketkeeperRig,
        'RUNUP',
        undefined,
        this.deliverySetup.targetLineX,
      );
      animateUmpireSequence(this.umpireRig, 'RUNUP', 'none', 0);

      if (this.runupElapsedSec >= this.RUNUP_DURATION_SEC) {
        // Release the ball!
        this.playPhase = 'LIVE_BALL';
        this.ballSimState = createDeliverySimulation(this.deliverySetup);
        this.pitchTargetReticle.visible = false;
        this.strikerAimWedgeGroup.visible = false;
        this.emitTelemetry();
      }
      return;
    }

    if (this.playPhase === 'LIVE_BALL' && this.ballSimState) {
      this.followThroughElapsedSec += dt;
      animateBowlerDeliverySequence(
        this.bowlerRig,
        'follow_through',
        Math.min(1, this.followThroughElapsedSec / 0.65),
        this.deliverySetup.releaseX ?? -0.36,
      );

      // Step fixed-timestep 1/120s authoritative ball & bat collision simulation
      const fixedDt = 1 / 120;
      const postContactScale =
        this.ballSimState.phase === 'POST_CONTACT_FLIGHT_OR_ROLL' ||
        this.ballSimState.phase === 'FIELDING_OR_WICKET_RESOLUTION'
          ? this.isSoftwareGl
            ? 5.5
            : 2.0
          : this.isSoftwareGl
            ? 1.8
            : 1.0;
      this.physicsAccumulatorSec += dt * postContactScale;
      while (this.physicsAccumulatorSec >= fixedDt && this.ballSimState.phase !== 'DEAD_BALL') {
        this.physicsAccumulatorSec -= fixedDt;
        this.ballSimState = stepDeliverySimulation(
          this.ballSimState,
          fixedDt,
          this.deliverySetup,
          this.battingInput,
          this.boundaryConfig,
        );
      }

      // Update 3D Ball & Flight Trail
      this.ballHandle.setCricketPosition(
        this.ballSimState.position,
        this.ballSimState.simTimeSec * 28,
      );
      this.updateBallTrailGeometry(this.ballSimState.trailPoints);

      // Show Pitch Bounce Impact Ring once ball pitches
      if (this.ballSimState.pitchBouncePoint && !this.pitchBounceRing.visible) {
        const bp = cricketToThree({
          x: this.ballSimState.pitchBouncePoint.x,
          y: this.ballSimState.pitchBouncePoint.y,
          z: 0.036,
        });
        this.pitchBounceRing.position.set(bp.x, bp.y, bp.z);
        this.pitchBounceRing.visible = true;
      }

      // Animate Striker Footwork & Bat Swing
      const isSwinging =
        this.battingInput.swingTriggerTimeSec !== null &&
        this.ballSimState.simTimeSec >= this.battingInput.swingTriggerTimeSec - 0.02;
      const swingProgress = isSwinging
        ? Math.max(
            0,
            Math.min(
              1,
              (this.ballSimState.simTimeSec - this.battingInput.swingTriggerTimeSec!) / 0.28,
            ),
          )
        : 0;

      animateStrikerShotSequence(
        this.strikerRig,
        CORE_ACTOR_POSITIONS.STRIKER_STANCE,
        this.battingInput.footwork,
        resolvedShot,
        handedness,
        swingProgress,
        isSwinging,
        1.0,
      );
      animateNonStrikerSequence(
        this.nonStrikerRig,
        'LIVE_BALL',
        this.followThroughElapsedSec,
        this.ballSimState.position,
      );
      animateWicketkeeperSequence(
        this.wicketkeeperRig,
        'LIVE_BALL',
        this.ballSimState.position,
        this.deliverySetup.targetLineX,
      );
      animateUmpireSequence(this.umpireRig, 'LIVE_BALL', 'none', 0);

      // Animate Stump Tilt & Flying Bails if BOWLED!
      if (this.ballSimState.stumpCollision.struck) {
        const struckId = this.ballSimState.stumpCollision.stumpId ?? 'middle';
        const stumpGroup = this.strikerWicket.stumpMeshes[struckId];
        if (stumpGroup) {
          stumpGroup.rotation.x = -0.68;
        }
        const postHitSec = Math.max(0.05, this.followThroughElapsedSec - 0.35);
        this.strikerWicket.setBailDislodged(
          'leg_middle',
          { x: -0.14 * postHitSec, y: 0.85 * postHitSec, z: 0.28 * postHitSec },
          new THREE.Euler(postHitSec * 6, postHitSec * 4, -postHitSec * 5),
        );
        this.strikerWicket.setBailDislodged(
          'middle_off',
          { x: 0.18 * postHitSec, y: 0.95 * postHitSec, z: 0.32 * postHitSec },
          new THREE.Euler(-postHitSec * 5, -postHitSec * 3, postHitSec * 6),
        );
      }

      // Transition to OUTCOME when ball reaches DEAD_BALL
      if (this.ballSimState.phase === 'DEAD_BALL') {
        this.playPhase = 'OUTCOME';
        this.latestOutcome = this.ballSimState.outcome;
      }

      this.emitTelemetry();
      return;
    }

    if (this.playPhase === 'OUTCOME') {
      const outcome = this.latestOutcome;
      const umpireSignal = outcome?.isWicketBowled
        ? 'out'
        : outcome?.isBoundarySix
          ? 'six'
          : outcome?.isBoundaryFour
            ? 'four'
            : 'none';
      animateUmpireSequence(this.umpireRig, 'OUTCOME', umpireSignal, elapsedSec);
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
