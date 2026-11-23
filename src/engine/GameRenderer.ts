import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { TRACK_MAP, VEHICLE_MAP, createDefaultTuning } from '../data/vehicles';
import {
  CameraMode,
  CommentaryCaption,
  InputControls,
  RemotePlayerState,
  ReplayCameraMode,
  ReplayOpponentSnapshot,
  ReplayStatus,
  TrackId,
  TuningConfig,
  VehicleId,
  VehicleTelemetry,
} from '../types/game';
import { EngineAudioSystem } from './audio';
import { RaceCommentarySystem } from './commentary';
import { VehiclePhysicsEngine } from './physics';
import { ReplayBufferManager, SavedReplayClip } from './replayBuffer';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import { BuiltTrack, buildTrackScene } from './tracks3d';
import { buildVehicleMesh, VehicleRig } from './vehicles3d';

export interface ProjectedLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  distance: number;
}

export interface RendererCallbacks {
  onTelemetry: (telemetry: VehicleTelemetry) => void;
  onLabelsUpdate: (labels: ProjectedLabel[]) => void;
  onLapComplete: (lapTimeMs: number, lapNumber: number, finished: boolean) => void;
  onCommentaryCaption?: (caption: CommentaryCaption | null) => void;
  onReplayStatus?: (status: ReplayStatus) => void;
  onContextLost?: (lost: boolean) => void;
}

interface RemoteRigEntry {
  rig: VehicleRig;
  vehicleId: VehicleId;
  tuningKey: string;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetHeading: number;
  currentX: number;
  currentY: number;
  currentZ: number;
  currentHeading: number;
  speedKmh: number;
  steer: number;
  leanAngle: number;
  nitroActive: boolean;
  drsActive: boolean;
  braking: boolean;
  name: string;
  lap: number;
  progress: number;
}

interface AiRivalEntry {
  rig: VehicleRig;
  name: string;
  progress: number;
  laneOffset: number;
  speedMs: number;
  lap: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

const _camPos = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _projVec = new THREE.Vector3();

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class GameRenderer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls;
  private textures: ProceduralTextureSet;
  private isSoftwareGl: boolean;

  private mode: 'showroom' | 'race' = 'showroom';
  private vehicleId: VehicleId = 'ferrari_f1';
  private trackId: TrackId = 'monaco';
  private tuning: TuningConfig;
  private cameraMode: CameraMode = 'chase';

  private showroomGroup = new THREE.Group();
  private raceGroup = new THREE.Group();
  private playerRig: VehicleRig | null = null;
  private builtTrack: BuiltTrack | null = null;
  private physics: VehiclePhysicsEngine;
  public audio: EngineAudioSystem;
  public commentary: RaceCommentarySystem;
  private prevRank = 99;
  private raceStartAnnounced = false;
  private prevSpeedMs = 0;
  private lastAssistTurn = 'straight';

  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;

  private remoteRigs = new Map<string, RemoteRigEntry>();
  private aiRivals: AiRivalEntry[] = [];
  private aiRivalsEnabled = true;

  private smokeGroup = new THREE.Group();
  private smokeParticles: {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    maxLife: number;
  }[] = [];
  private smokeIndex = 0;

  private controlsState: InputControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
    drs: false,
    horn: false,
  };

  private frameId = 0;
  private disposed = false;
  private lastTime = performance.now();
  private telemetryAcc = 0;
  private replayStatusAcc = 0;
  private replayBuffer = new ReplayBufferManager();
  private replayClip: SavedReplayClip | null = null;
  private replayActive = false;
  private replayPlaying = true;
  private replayElapsedMs = 0;
  private replaySpeed: 0.5 | 1 | 2 = 1;
  private replayCamera: ReplayCameraMode = 'recorded';
  private pendingBestLapCapture: { lapTimeMs: number; lapNumber: number } | null = null;
  private lastLiveTelemetry: VehicleTelemetry | null = null;
  private callbacks: RendererCallbacks;

  constructor(
    container: HTMLElement,
    initialVehicle: VehicleId,
    initialTrack: TrackId,
    initialTuning: TuningConfig,
    callbacks: RendererCallbacks,
  ) {
    this.container = container;
    this.vehicleId = initialVehicle;
    this.trackId = initialTrack;
    this.tuning = initialTuning;
    this.callbacks = callbacks;

    this.isSoftwareGl = detectSoftwareGl();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    const w = container.clientWidth || 1280;
    const h = container.clientHeight || 720;
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.callbacks.onContextLost?.(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.callbacks.onContextLost?.(false);
    });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#090b10');
    this.scene.fog = new THREE.FogExp2('#090b10', 0.012);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.25, 2600);
    this.camera.position.set(4.5, 2.0, 5.2);

    // Subtle HDR bloom on real GPUs only
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.34, 0.35, 0.88);
      this.composer.addPass(this.bloomPass);
    }

    this.orbitControls = new OrbitControls(this.camera, canvas);
    this.orbitControls.enableDamping = !this.isSoftwareGl;
    this.orbitControls.dampingFactor = 0.06;
    this.orbitControls.enablePan = false;
    this.orbitControls.minDistance = 3.0;
    this.orbitControls.maxDistance = 9.5;
    this.orbitControls.minPolarAngle = 0.22;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.orbitControls.target.set(0, 0.58, 0);
    this.orbitControls.autoRotate = !this.isSoftwareGl;
    this.orbitControls.autoRotateSpeed = 0.9;

    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.audio = new EngineAudioSystem();
    this.audio.setProfile(VEHICLE_MAP[initialVehicle].soundProfile);
    this.commentary = new RaceCommentarySystem(this.audio, (cap) =>
      this.callbacks.onCommentaryCaption?.(cap),
    );

    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.92);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.keyLight.position.set(8, 14, 10);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    const d = 16;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 1.15);
    this.rimLight.position.set(-10, 6, -10);
    this.scene.add(this.rimLight);

    this.buildShowroomEnvironment();
    this.initSmokePool();

    this.scene.add(this.showroomGroup);
    this.scene.add(this.raceGroup);
    this.raceGroup.visible = false;

    this.physics = new VehiclePhysicsEngine(initialVehicle, initialTrack, initialTuning);

    this.rebuildPlayerVehicle();
    this.setupShowroomMode();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('resize', this.handleResize);
    this.startLoop();
  }

  private buildShowroomEnvironment() {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(7.8, 8.2, 0.16, 48),
      new THREE.MeshStandardMaterial({
        map: this.textures.showroomFloor,
        roughness: 0.26,
        metalness: 0.45,
      }),
    );
    disc.position.y = -0.08;
    disc.receiveShadow = true;
    this.showroomGroup.add(disc);

    const floorGeo = new THREE.PlaneGeometry(140, 140);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(
      floorGeo,
      new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.85, metalness: 0.1 }),
    );
    floor.position.y = -0.17;
    floor.receiveShadow = true;
    this.showroomGroup.add(floor);

    const ringGeo = new THREE.TorusGeometry(4.2, 0.055, 12, 48);
    ringGeo.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
    ring.position.y = 4.6;
    this.showroomGroup.add(ring);

    if (!this.isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const softbox1 = new THREE.RectAreaLight(0xffffff, 4.6, 6, 2.5);
      softbox1.position.set(0, 4.5, 0);
      softbox1.lookAt(0, 0, 0);
      this.showroomGroup.add(softbox1);

      const softbox2 = new THREE.RectAreaLight(0x38bdf8, 2.4, 5, 1.5);
      softbox2.position.set(-5, 2.2, -4);
      softbox2.lookAt(0, 0.5, 0);
      this.showroomGroup.add(softbox2);
    }
  }

  private initSmokePool() {
    const geo = new THREE.SphereGeometry(0.28, 7, 7);
    for (let i = 0; i < 36; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.smokeGroup.add(mesh);
      this.smokeParticles.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.6 });
    }
    this.raceGroup.add(this.smokeGroup);
  }

  private spawnSmoke(x: number, y: number, z: number) {
    const p = this.smokeParticles[this.smokeIndex];
    this.smokeIndex = (this.smokeIndex + 1) % this.smokeParticles.length;
    p.mesh.position.set(x + (Math.random() - 0.5) * 0.4, y + 0.15, z + (Math.random() - 0.5) * 0.4);
    p.mesh.scale.setScalar(0.5);
    p.mesh.visible = true;
    p.vx = (Math.random() - 0.5) * 1.4;
    p.vy = 0.8 + Math.random() * 1.1;
    p.vz = (Math.random() - 0.5) * 1.4;
    p.life = 0;
    p.maxLife = 0.45 + Math.random() * 0.25;
  }

  public rebuildPlayerVehicle() {
    if (this.playerRig) {
      this.showroomGroup.remove(this.playerRig.root);
      this.raceGroup.remove(this.playerRig.root);
      this.playerRig.dispose();
    }
    this.playerRig = buildVehicleMesh(this.vehicleId, this.tuning, this.textures, this.isSoftwareGl);
    this.playerRig.applyTuning(this.tuning);
    this.audio.setProfile(VEHICLE_MAP[this.vehicleId].soundProfile);

    if (this.mode === 'showroom') {
      this.playerRig.root.position.set(0, 0, 0);
      this.playerRig.root.rotation.set(0, 0, 0);
      this.showroomGroup.add(this.playerRig.root);
    } else {
      this.raceGroup.add(this.playerRig.root);
    }
  }

  public setVehicle(vehicleId: VehicleId, tuning: TuningConfig) {
    const changed = this.vehicleId !== vehicleId;
    this.vehicleId = vehicleId;
    this.tuning = tuning;
    this.physics.configure(vehicleId, this.trackId, tuning);
    if (changed || !this.playerRig) {
      this.rebuildPlayerVehicle();
    } else {
      this.playerRig.applyTuning(tuning);
    }
  }

  public updateTuning(tuning: TuningConfig) {
    this.tuning = tuning;
    this.physics.configure(this.vehicleId, this.trackId, tuning);
    this.playerRig?.applyTuning(tuning);
  }

  public setTrack(trackId: TrackId) {
    this.trackId = trackId;
    this.physics.configure(this.vehicleId, trackId, this.tuning);
    if (this.mode === 'race') {
      this.rebuildTrack();
    }
  }

  public setCameraMode(cam: CameraMode) {
    this.cameraMode = cam;
  }

  public setManualTransmission(manual: boolean) {
    this.physics.setManualTransmission(manual);
  }

  public shiftGear(up: boolean) {
    if (up) this.physics.shiftUp();
    else this.physics.shiftDown();
    this.audio.playShiftBlip();
  }

  public setAiRivalsEnabled(enabled: boolean) {
    this.aiRivalsEnabled = enabled;
    if (this.mode === 'race') {
      this.syncAiRivals();
    }
  }

  public setRaceFrozen(frozen: boolean) {
    const wasFrozen = this.physics.raceFrozen;
    this.physics.raceFrozen = frozen;
    if (!frozen && wasFrozen && this.mode === 'race' && !this.raceStartAnnounced) {
      this.raceStartAnnounced = true;
      void this.commentary.trigger('start', true);
    }
  }

  public setStartLights(litCount: number) {
    this.builtTrack?.setStartLights(litCount);
  }

  public setControls(controls: InputControls) {
    this.controlsState = controls;
  }

  public setupShowroomMode() {
    this.mode = 'showroom';
    this.replayActive = false;
    this.replayClip = null;
    this.pendingBestLapCapture = null;
    this.lastLiveTelemetry = null;
    this.replayBuffer.reset();
    this.emitReplayStatus();

    this.showroomGroup.visible = true;
    this.raceGroup.visible = false;
    this.orbitControls.enabled = true;
    this.orbitControls.autoRotate = !this.isSoftwareGl;
    this.audio.setEngineActive(false);
    this.audio.setCrowdActive(false);
    this.commentary.stop();

    this.scene.background = new THREE.Color('#090b10');
    this.scene.fog = new THREE.FogExp2('#090b10', 0.014);
    this.hemiLight.color.set('#93c5fd');
    this.hemiLight.groundColor.set('#1e293b');
    this.hemiLight.intensity = 0.92;
    this.keyLight.color.set('#fff1d6');
    this.keyLight.position.set(8, 14, 10);
    this.keyLight.target.position.set(0, 0, 0);

    this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(4.5, 2.0, 5.2);
    this.orbitControls.target.set(0, 0.58, 0);
    this.orbitControls.update();

    if (this.playerRig) {
      this.raceGroup.remove(this.playerRig.root);
      this.playerRig.root.position.set(0, 0, 0);
      this.playerRig.root.rotation.set(0, 0, 0);
      this.playerRig.bikeLeanPivot.rotation.set(0, 0, 0);
      this.playerRig.chassisGroup.rotation.set(0, 0, 0);
      this.showroomGroup.add(this.playerRig.root);
    }
    this.callbacks.onLabelsUpdate([]);
  }

  public setupRaceMode(trackId: TrackId, slotIndex = 0) {
    this.mode = 'race';
    this.trackId = trackId;
    this.replayActive = false;
    this.replayClip = null;
    this.replayPlaying = true;
    this.replayElapsedMs = 0;
    this.replaySpeed = 1;
    this.replayCamera = 'recorded';
    this.pendingBestLapCapture = null;
    this.lastLiveTelemetry = null;
    this.replayBuffer.reset();
    this.emitReplayStatus();

    this.showroomGroup.visible = false;
    this.raceGroup.visible = true;
    this.orbitControls.enabled = false;
    this.orbitControls.autoRotate = false;

    const trackDef = TRACK_MAP[trackId];
    this.scene.background = new THREE.Color(trackDef.skyHorizon);
    this.scene.fog = null;
    this.hemiLight.color.set(trackDef.ambientSky);
    this.hemiLight.groundColor.set(trackDef.ambientGround);
    this.hemiLight.intensity = trackId === 'midnight' ? 0.9 : 1.15;
    this.keyLight.color.set(trackDef.sunColor);
    this.keyLight.intensity = trackId === 'midnight' ? 1.5 : 2.35;

    this.rebuildTrack();
    if (this.playerRig) {
      this.showroomGroup.remove(this.playerRig.root);
      this.raceGroup.add(this.playerRig.root);
    }

    if (this.builtTrack) {
      this.physics.configure(this.vehicleId, trackId, this.tuning);
      this.physics.resetToStart(this.builtTrack, slotIndex);
      this.playerRig?.root.position.set(this.physics.x, this.physics.y, this.physics.z);
      this.playerRig?.root.rotation.set(0, this.physics.heading, 0);

      const fwdX = -Math.sin(this.physics.heading);
      const fwdZ = -Math.cos(this.physics.heading);
      this.camera.position.set(
        this.physics.x - fwdX * 7.0,
        this.physics.y + 2.8,
        this.physics.z - fwdZ * 7.0,
      );
      this.camera.lookAt(
        this.physics.x + fwdX * 10,
        this.physics.y + 1.0,
        this.physics.z + fwdZ * 10,
      );
    }

    this.syncAiRivals();
    this.audio.init();
    this.audio.setEngineActive(true);
    this.audio.setCrowdActive(true);
    this.prevRank = 99;
    this.prevSpeedMs = 0;
    this.lastAssistTurn = 'straight';
    this.raceStartAnnounced = false;
    this.commentary.setGameMode(trackDef.mode);
    this.commentary.preloadRaceLines();
    if (trackDef.mode === 'casual') {
      this.raceStartAnnounced = true;
      window.setTimeout(() => {
        if (this.mode === 'race') {
          void this.commentary.trigger('start', true);
        }
      }, 650);
    }
  }

  private rebuildTrack() {
    if (this.builtTrack) {
      this.raceGroup.remove(this.builtTrack.group);
      this.builtTrack.dispose();
      this.builtTrack = null;
    }
    const trackDef = TRACK_MAP[this.trackId];
    this.builtTrack = buildTrackScene(trackDef, this.textures, this.isSoftwareGl);
    this.raceGroup.add(this.builtTrack.group);
    this.syncAiRivals();
  }

  private syncAiRivals() {
    for (const r of this.aiRivals) {
      this.raceGroup.remove(r.rig.root);
      r.rig.dispose();
    }
    this.aiRivals = [];

    if (!this.aiRivalsEnabled || !this.builtTrack || this.remoteRigs.size > 0) return;

    const isF1Track = TRACK_MAP[this.trackId].mode === 'f1';
    const f1Rivals: {
      name: string;
      vehicleId: VehicleId;
      color: string;
      speedMs: number;
      lane: number;
      prog: number;
    }[] = [
      { name: 'C. Leclerc (#16)', vehicleId: 'ferrari_f1', color: '#dc0000', speedMs: 74, lane: -3.4, prog: 0.014 },
      { name: 'L. Hamilton (#44)', vehicleId: 'mercedes_f1', color: '#111827', speedMs: 73, lane: 3.4, prog: 0.022 },
      { name: 'M. Verstappen (#1)', vehicleId: 'redbull_f1', color: '#172554', speedMs: 75, lane: -3.2, prog: 0.03 },
      { name: 'Rolex Pace F1', vehicleId: 'rolex_f1', color: '#065f46', speedMs: 71, lane: 3.2, prog: 0.008 },
    ];
    const casualRivals: typeof f1Rivals = [
      { name: 'SUHAILLL Works', vehicleId: 'suhailll', color: '#f59e0b', speedMs: 72, lane: -3.5, prog: 0.018 },
      { name: '911 GT3 RS Cup', vehicleId: 'porsche_911_gt3rs', color: '#e2e8f0', speedMs: 63, lane: 3.5, prog: 0.025 },
      { name: 'M4 Competition', vehicleId: 'bmw_m4', color: '#047857', speedMs: 59, lane: -2.8, prog: 0.009 },
    ];
    const rivalSpecs = (isF1Track ? f1Rivals : casualRivals).filter(
      (r) => r.vehicleId !== this.vehicleId,
    );

    rivalSpecs.forEach((rv) => {
      const tuning = createDefaultTuning(rv.vehicleId);
      tuning.paintColor = rv.color;
      const rig = buildVehicleMesh(rv.vehicleId, tuning, this.textures, this.isSoftwareGl);
      rig.applyTuning(tuning);
      this.raceGroup.add(rig.root);
      this.aiRivals.push({
        rig,
        name: rv.name,
        progress: rv.prog,
        laneOffset: rv.lane,
        speedMs: rv.speedMs,
        lap: 1,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
      });
    });
  }

  public syncRemotePlayers(players: RemotePlayerState[], localId: string) {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === localId) continue;
      seen.add(p.id);

      const tuningKey = `${p.tuning.paintColor}-${p.tuning.paintFinish}-${p.tuning.rimFinish}-${p.tuning.underglow}`;
      const existing = this.remoteRigs.get(p.id);
      if (!existing || existing.vehicleId !== p.vehicleId) {
        if (existing) {
          this.raceGroup.remove(existing.rig.root);
          existing.rig.dispose();
        }
        const rig = buildVehicleMesh(p.vehicleId, p.tuning, this.textures, this.isSoftwareGl);
        rig.applyTuning(p.tuning);
        rig.root.position.set(p.x, p.y, p.z);
        rig.root.rotation.y = p.heading;
        this.raceGroup.add(rig.root);

        this.remoteRigs.set(p.id, {
          rig,
          vehicleId: p.vehicleId,
          tuningKey,
          targetX: p.x,
          targetY: p.y,
          targetZ: p.z,
          targetHeading: p.heading,
          currentX: p.x,
          currentY: p.y,
          currentZ: p.z,
          currentHeading: p.heading,
          speedKmh: p.speedKmh,
          steer: p.steer,
          leanAngle: p.leanAngle,
          nitroActive: p.nitroActive,
          drsActive: Boolean(p.drsActive),
          braking: p.braking,
          name: p.name,
          lap: p.lap,
          progress: p.progress,
        });
      } else {
        if (existing.tuningKey !== tuningKey) {
          existing.rig.applyTuning(p.tuning);
          existing.tuningKey = tuningKey;
        }
        existing.targetX = p.x;
        existing.targetY = p.y;
        existing.targetZ = p.z;
        existing.targetHeading = p.heading;
        existing.speedKmh = p.speedKmh;
        existing.steer = p.steer;
        existing.leanAngle = p.leanAngle;
        existing.nitroActive = p.nitroActive;
        existing.drsActive = Boolean(p.drsActive);
        existing.braking = p.braking;
        existing.name = p.name;
        existing.lap = p.lap;
        existing.progress = p.progress;
      }
    }

    for (const [id, entry] of this.remoteRigs.entries()) {
      if (!seen.has(id)) {
        this.raceGroup.remove(entry.rig.root);
        entry.rig.dispose();
        this.remoteRigs.delete(id);
      }
    }

    if (this.remoteRigs.size > 0 && this.aiRivals.length > 0) {
      this.syncAiRivals();
    } else if (
      this.remoteRigs.size === 0 &&
      this.aiRivalsEnabled &&
      this.aiRivals.length === 0 &&
      this.mode === 'race'
    ) {
      this.syncAiRivals();
    }
  }

  public getMinimapPoints(): { x: number; z: number }[] {
    return this.builtTrack?.minimapPoints ?? [];
  }

  public getOpponentPositions(): { x: number; z: number; name: string }[] {
    const out: { x: number; z: number; name: string }[] = [];
    this.remoteRigs.forEach((r) => out.push({ x: r.currentX, z: r.currentZ, name: r.name }));
    this.aiRivals.forEach((a) => out.push({ x: a.x, z: a.z, name: a.name }));
    return out;
  }

  public getReplayStatus(): ReplayStatus {
    const clip = this.replayClip ?? this.replayBuffer.getBestLapClip();
    return {
      active: this.replayActive,
      playing: this.replayPlaying,
      currentMs: Math.round(this.replayElapsedMs),
      durationMs: clip ? clip.durationMs : 0,
      speed: this.replaySpeed,
      cameraMode: this.replayCamera,
      bestLapMs: clip ? clip.lapTimeMs : null,
      lapNumber: clip ? clip.lapNumber : null,
      hasBestLap: this.replayBuffer.getBestLapClip() !== null,
      bufferSeconds: this.replayBuffer.getRollingDurationSeconds(),
    };
  }

  private emitReplayStatus() {
    this.callbacks.onReplayStatus?.(this.getReplayStatus());
  }

  public startBestLapReplay(): boolean {
    if (this.mode !== 'race') return false;
    const clip = this.replayBuffer.getBestLapClip();
    if (!clip) return false;
    this.replayClip = clip;
    this.replayActive = true;
    this.replayPlaying = true;
    this.replayElapsedMs = 0;
    this.replaySpeed = 1;
    this.replayCamera = 'recorded';
    this.commentary.stop();
    this.audio.setEngineActive(true);
    this.audio.setCrowdActive(true);
    this.applyReplaySample(0, 0.016, true);
    this.emitReplayStatus();
    return true;
  }

  public exitReplay() {
    if (!this.replayActive) return;
    this.replayActive = false;
    this.replayPlaying = false;

    if (this.playerRig) {
      this.playerRig.root.position.set(this.physics.x, this.physics.y, this.physics.z);
      this.playerRig.root.rotation.set(0, this.physics.heading, 0);
    }
    this.aiRivals.forEach((ai) => {
      ai.rig.root.position.set(ai.x, ai.y, ai.z);
      ai.rig.root.rotation.set(0, ai.heading, 0);
    });
    this.remoteRigs.forEach((entry) => {
      entry.rig.root.position.set(entry.currentX, entry.currentY, entry.currentZ);
      entry.rig.root.rotation.set(0, entry.currentHeading, 0);
    });

    if (this.lastLiveTelemetry) {
      this.applyPlayerCamera(
        this.cameraMode,
        this.lastLiveTelemetry.positionX,
        this.lastLiveTelemetry.positionY,
        this.lastLiveTelemetry.positionZ,
        this.lastLiveTelemetry.headingRad,
        this.lastLiveTelemetry.speedKmh,
        this.lastLiveTelemetry.nitroActive || this.lastLiveTelemetry.drsActive,
        0.016,
        true,
      );
      this.callbacks.onTelemetry(this.lastLiveTelemetry);
      this.audio.setEngineActive(!this.lastLiveTelemetry.finished);
      this.audio.setCrowdActive(!this.lastLiveTelemetry.finished);
    }
    this.emitReplayStatus();
  }

  public toggleReplayPlay() {
    if (!this.replayActive || !this.replayClip) return;
    if (!this.replayPlaying && this.replayElapsedMs >= this.replayClip.durationMs - 20) {
      this.replayElapsedMs = 0;
    }
    this.replayPlaying = !this.replayPlaying;
    this.audio.setEngineActive(this.replayPlaying);
    this.emitReplayStatus();
  }

  public seekReplay(ms: number) {
    if (!this.replayActive || !this.replayClip) return;
    this.replayElapsedMs = THREE.MathUtils.clamp(ms, 0, this.replayClip.durationMs);
    this.applyReplaySample(this.replayElapsedMs, 0.016, true);
    this.emitReplayStatus();
  }

  public cycleReplaySpeed() {
    if (!this.replayActive) return;
    const order: (0.5 | 1 | 2)[] = [0.5, 1, 2];
    this.replaySpeed = order[(order.indexOf(this.replaySpeed) + 1) % order.length];
    this.emitReplayStatus();
  }

  public cycleReplayCamera() {
    if (!this.replayActive) return;
    const order: ReplayCameraMode[] = [
      'recorded',
      'tv_trackside',
      'chase',
      'far_chase',
      't_cam',
      'hood',
      'bumper',
    ];
    this.replayCamera = order[(order.indexOf(this.replayCamera) + 1) % order.length];
    this.applyReplaySample(this.replayElapsedMs, 0.016, true);
    this.emitReplayStatus();
  }

  private handleResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  };

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
      this.lastTime = now;

      this.updateFrame(dt);
      if (this.isSoftwareGl || !this.composer) {
        this.renderer.render(this.scene, this.camera);
      } else {
        this.composer.render();
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void) {
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state =
          sync && gl.getSyncParameter ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync && gl.deleteSync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } catch {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private updateFrame(dt: number) {
    if (this.mode === 'showroom') {
      this.orbitControls.update();
      return;
    }

    if (!this.builtTrack || !this.playerRig) return;

    if (this.replayActive) {
      this.updateReplayFrame(dt);
      return;
    }

    const telemetry = this.physics.step(dt, this.controlsState, this.builtTrack, {
      onCollision: (impact) => {
        this.audio.playCollision(impact);
        if (impact > 3.2) {
          void this.commentary.trigger('wall_hit', impact > 9);
        }
      },
      onGearShift: () => this.audio.playShiftBlip(),
      onLapComplete: (lapTimeMs, lapNum, finished) => {
        this.pendingBestLapCapture = { lapTimeMs, lapNumber: lapNum };
        this.callbacks.onLapComplete(lapTimeMs, lapNum, finished);
        void this.commentary.trigger(finished ? 'finish' : 'lap', finished);
      },
    });
    this.lastLiveTelemetry = telemetry;

    this.playerRig.root.position.set(telemetry.positionX, telemetry.positionY, telemetry.positionZ);
    this.playerRig.root.rotation.set(0, telemetry.headingRad, 0);
    this.playerRig.updateVisuals({
      speedKmh: telemetry.speedKmh,
      steer: telemetry.steer,
      leanAngleRad: telemetry.leanAngleRad,
      throttle: telemetry.throttle,
      braking: telemetry.brake > 0.1 || this.controlsState.handbrake,
      nitroActive: telemetry.nitroActive,
      drsActive: telemetry.drsActive,
      pitchRad: this.physics.pitchRad,
      rollRad: this.physics.rollRad,
      dt,
    });

    if (telemetry.isDrifting || (telemetry.offTrack && telemetry.speedKmh > 40)) {
      if (Math.random() < 0.55) {
        this.spawnSmoke(telemetry.positionX, telemetry.positionY, telemetry.positionZ);
      }
    }

    for (let i = 0; i < this.smokeParticles.length; i++) {
      const p = this.smokeParticles[i];
      if (!p.mesh.visible) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.mesh.visible = false;
      } else {
        const t = p.life / p.maxLife;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.scale.setScalar(0.5 + t * 2.4);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.35;
      }
    }

    this.audio.update({
      rpm: telemetry.rpm,
      maxRpm: telemetry.maxRpm,
      throttle: telemetry.throttle,
      speedKmh: telemetry.speedKmh,
      driftAngleDeg: telemetry.driftAngleDeg,
      nitroActive: telemetry.nitroActive || telemetry.drsActive,
      ecuStage: this.tuning.ecuStage,
      dt,
    });
    this.audio.updateCrowd({
      speedKmh: telemetry.speedKmh,
      rank: telemetry.rank,
      nearGrandstand: telemetry.checkpointProgress < 0.08 || telemetry.checkpointProgress > 0.92,
      drsOrNitro: telemetry.drsActive || telemetry.nitroActive,
      dt,
    });

    const trackLenM = this.builtTrack.curve.getLength();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.aiRivals.length; i++) {
      const ai = this.aiRivals[i];
      if (!this.physics.raceFrozen) {
        ai.progress += (ai.speedMs * dt) / trackLenM;
        if (ai.progress >= 1) {
          ai.progress -= 1;
          ai.lap += 1;
        }
      }
      const pt = this.builtTrack.curve.getPointAt(ai.progress);
      const tan = this.builtTrack.curve.getTangentAt(ai.progress).normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      const pos = pt.clone().addScaledVector(right, ai.laneOffset);
      ai.x = pos.x;
      ai.y = pos.y;
      ai.z = pos.z;
      ai.heading = Math.atan2(-tan.x, -tan.z);
      ai.rig.root.position.set(ai.x, ai.y, ai.z);
      ai.rig.root.rotation.set(0, ai.heading, 0);
      ai.rig.updateVisuals({
        speedKmh: this.physics.raceFrozen ? 0 : ai.speedMs * 3.6,
        steer: 0,
        leanAngleRad: 0,
        throttle: 1,
        braking: false,
        nitroActive: false,
        dt,
      });
    }

    this.remoteRigs.forEach((entry) => {
      entry.currentX = THREE.MathUtils.damp(entry.currentX, entry.targetX, 14, dt);
      entry.currentY = THREE.MathUtils.damp(entry.currentY, entry.targetY, 14, dt);
      entry.currentZ = THREE.MathUtils.damp(entry.currentZ, entry.targetZ, 14, dt);
      let diff = entry.targetHeading - entry.currentHeading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      entry.currentHeading += diff * (1 - Math.exp(-14 * dt));

      entry.rig.root.position.set(entry.currentX, entry.currentY, entry.currentZ);
      entry.rig.root.rotation.set(0, entry.currentHeading, 0);
      entry.rig.updateVisuals({
        speedKmh: entry.speedKmh,
        steer: entry.steer,
        leanAngleRad: entry.leanAngle,
        throttle: entry.speedKmh > 10 ? 0.8 : 0,
        braking: entry.braking,
        nitroActive: entry.nitroActive,
        drsActive: entry.drsActive,
        dt,
      });
    });

    const localScore = telemetry.lap + telemetry.checkpointProgress;
    let rank = 1;
    let totalRacers = 1;
    this.remoteRigs.forEach((r) => {
      totalRacers += 1;
      if (r.lap + r.progress > localScore) rank += 1;
    });
    this.aiRivals.forEach((a) => {
      totalRacers += 1;
      if (a.lap + a.progress > localScore) rank += 1;
    });
    telemetry.rank = rank;
    telemetry.totalRacers = totalRacers;

    const speedMs = telemetry.speedKmh / 3.6;
    const longAccelMs2 = (speedMs - this.prevSpeedMs) / Math.max(0.008, dt);
    this.prevSpeedMs = speedMs;

    const turnInfo = this.builtTrack.predictUpcomingTurn(telemetry.checkpointProgress, speedMs);
    telemetry.upcomingTurn = turnInfo.turn;
    telemetry.upcomingTurnDistM = turnInfo.distanceM;
    telemetry.brakeRecommended = turnInfo.brakeRecommended;

    if (!this.physics.raceFrozen && !telemetry.finished) {
      if (rank === 1 && this.prevRank > 1 && this.prevRank < 90 && totalRacers > 1) {
        void this.commentary.trigger('p1');
      } else if (
        turnInfo.brakeRecommended &&
        turnInfo.turn !== this.lastAssistTurn &&
        turnInfo.distanceM <= 115
      ) {
        if (turnInfo.turn === 'hairpin_left' || turnInfo.turn === 'hairpin_right') {
          void this.commentary.trigger('assist_brake');
        } else if (turnInfo.turn === 'sharp_left') {
          void this.commentary.trigger('assist_left');
        } else if (turnInfo.turn === 'sharp_right') {
          void this.commentary.trigger('assist_right');
        }
        this.lastAssistTurn = turnInfo.turn;
      } else if (
        telemetry.throttle > 0.85 &&
        (longAccelMs2 > 9.5 || telemetry.nitroActive) &&
        telemetry.speedKmh > 25 &&
        telemetry.speedKmh < 245
      ) {
        void this.commentary.trigger('high_accel');
      } else if (
        turnInfo.turn === 'straight' &&
        this.lastAssistTurn !== 'straight' &&
        telemetry.speedKmh > 125 &&
        telemetry.throttle > 0.7
      ) {
        void this.commentary.trigger('assist_straight');
        this.lastAssistTurn = 'straight';
      } else if (telemetry.drsActive) {
        void this.commentary.trigger('drs');
      } else if (telemetry.speedKmh > 255) {
        void this.commentary.trigger('speed');
      } else if (telemetry.isDrifting && telemetry.speedKmh > 75) {
        void this.commentary.trigger('corner');
      }
      if (turnInfo.turn === 'straight' && !turnInfo.brakeRecommended) {
        this.lastAssistTurn = 'straight';
      }
      this.prevRank = rank;
    }

    const trackDef = TRACK_MAP[this.trackId];
    this.keyLight.position.set(
      telemetry.positionX + trackDef.sunPosition[0] * 0.3,
      telemetry.positionY + 45,
      telemetry.positionZ + trackDef.sunPosition[2] * 0.3,
    );
    this.keyLight.target.position.set(telemetry.positionX, telemetry.positionY, telemetry.positionZ);

    this.applyPlayerCamera(
      this.cameraMode,
      telemetry.positionX,
      telemetry.positionY,
      telemetry.positionZ,
      telemetry.headingRad,
      telemetry.speedKmh,
      telemetry.nitroActive || telemetry.drsActive,
      dt,
      false,
    );

    if (!this.physics.raceFrozen && (!telemetry.finished || this.pendingBestLapCapture !== null)) {
      const oppSnaps: ReplayOpponentSnapshot[] = [];
      this.remoteRigs.forEach((r) => {
        oppSnaps.push({
          x: r.currentX,
          y: r.currentY,
          z: r.currentZ,
          heading: r.currentHeading,
          speedKmh: r.speedKmh,
          steer: r.steer,
          leanAngle: r.leanAngle,
          nitroActive: r.nitroActive,
          drsActive: r.drsActive,
          braking: r.braking,
        });
      });
      this.aiRivals.forEach((a) => {
        oppSnaps.push({
          x: a.x,
          y: a.y,
          z: a.z,
          heading: a.heading,
          speedKmh: this.physics.raceFrozen ? 0 : a.speedMs * 3.6,
          steer: 0,
          leanAngle: 0,
          nitroActive: false,
          drsActive: false,
          braking: false,
        });
      });

      this.replayBuffer.recordFrame({
        tMs: telemetry.totalRaceTimeMs,
        x: telemetry.positionX,
        y: telemetry.positionY,
        z: telemetry.positionZ,
        headingRad: telemetry.headingRad,
        speedKmh: telemetry.speedKmh,
        rpm: telemetry.rpm,
        maxRpm: telemetry.maxRpm,
        gear: telemetry.gear,
        throttle: telemetry.throttle,
        brake: telemetry.brake,
        steer: telemetry.steer,
        leanAngleRad: telemetry.leanAngleRad,
        nitro: telemetry.nitro,
        nitroActive: telemetry.nitroActive,
        drsActive: telemetry.drsActive,
        drsAvailable: telemetry.drsAvailable,
        driftAngleDeg: telemetry.driftAngleDeg,
        isDrifting: telemetry.isDrifting,
        offTrack: telemetry.offTrack,
        pitchRad: this.physics.pitchRad,
        rollRad: this.physics.rollRad,
        lap: telemetry.lap,
        lapTimeMs: telemetry.lapTimeMs,
        checkpointProgress: telemetry.checkpointProgress,
        rank: telemetry.rank,
        totalRacers: telemetry.totalRacers,
        camX: this.camera.position.x,
        camY: this.camera.position.y,
        camZ: this.camera.position.z,
        camTargetX: _camTarget.x,
        camTargetY: _camTarget.y,
        camTargetZ: _camTarget.z,
        camFov: this.camera.fov,
        cameraMode: this.cameraMode,
        opponents: oppSnaps,
      });
    }

    if (this.pendingBestLapCapture) {
      const { lapTimeMs, lapNumber } = this.pendingBestLapCapture;
      this.pendingBestLapCapture = null;
      if (this.replayBuffer.captureBestLapIfFaster(lapTimeMs, lapNumber)) {
        this.emitReplayStatus();
      }
    }

    this.telemetryAcc += dt;
    if (this.telemetryAcc >= 0.05) {
      this.telemetryAcc = 0;
      this.callbacks.onTelemetry(telemetry);
      this.emitProjectedLabels();
    }

    this.replayStatusAcc += dt;
    if (this.replayStatusAcc >= 0.25) {
      this.replayStatusAcc = 0;
      this.emitReplayStatus();
    }
  }

  private applyPlayerCamera(
    camMode: CameraMode,
    posX: number,
    posY: number,
    posZ: number,
    headingRad: number,
    speedKmh: number,
    boostActive: boolean,
    dt: number,
    snap: boolean,
  ) {
    const fwdX = -Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);

    const baseFov =
      camMode === 't_cam' || camMode === 'hood' || camMode === 'bumper' ? 64 : 52;
    const targetFov = baseFov + Math.min(18, speedKmh * 0.042) + (boostActive ? 6 : 0);
    this.camera.fov = snap ? targetFov : THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
    this.camera.updateProjectionMatrix();

    if (camMode === 'chase') {
      _camPos.set(posX - fwdX * 6.8, posY + 2.55, posZ - fwdZ * 6.8);
      _camTarget.set(posX + fwdX * 9.5, posY + 1.0, posZ + fwdZ * 9.5);
      if (snap) this.camera.position.copy(_camPos);
      else this.camera.position.lerp(_camPos, 1 - Math.exp(-10 * dt));
      this.camera.lookAt(_camTarget);
    } else if (camMode === 'far_chase') {
      _camPos.set(posX - fwdX * 9.6, posY + 3.7, posZ - fwdZ * 9.6);
      _camTarget.set(posX + fwdX * 11.0, posY + 1.1, posZ + fwdZ * 11.0);
      if (snap) this.camera.position.copy(_camPos);
      else this.camera.position.lerp(_camPos, 1 - Math.exp(-8.5 * dt));
      this.camera.lookAt(_camTarget);
    } else if (camMode === 't_cam') {
      _camPos.set(posX - fwdX * 0.48, posY + 1.24, posZ - fwdZ * 0.48);
      _camTarget.set(posX + fwdX * 22, posY + 0.72, posZ + fwdZ * 22);
      this.camera.position.copy(_camPos);
      this.camera.lookAt(_camTarget);
    } else if (camMode === 'hood') {
      _camPos.set(
        posX + fwdX * 0.35,
        posY + (this.playerRig?.isBike ? 1.28 : 1.18),
        posZ + fwdZ * 0.35,
      );
      _camTarget.set(posX + fwdX * 22, posY + 1.0, posZ + fwdZ * 22);
      this.camera.position.copy(_camPos);
      this.camera.lookAt(_camTarget);
    } else {
      _camPos.set(posX + fwdX * 2.15, posY + 0.6, posZ + fwdZ * 2.15);
      _camTarget.set(posX + fwdX * 24, posY + 0.56, posZ + fwdZ * 24);
      this.camera.position.copy(_camPos);
      this.camera.lookAt(_camTarget);
    }
  }

  private updateReplayFrame(dt: number) {
    if (!this.replayClip) return;

    if (this.replayPlaying) {
      this.replayElapsedMs += dt * 1000 * this.replaySpeed;
      if (this.replayElapsedMs >= this.replayClip.durationMs) {
        this.replayElapsedMs = this.replayClip.durationMs;
        this.replayPlaying = false;
        this.audio.setEngineActive(false);
        this.emitReplayStatus();
      }
    }

    this.applyReplaySample(this.replayElapsedMs, dt, false);

    this.replayStatusAcc += dt;
    if (this.replayStatusAcc >= 0.08) {
      this.replayStatusAcc = 0;
      this.emitReplayStatus();
    }
  }

  private applyReplaySample(elapsedMs: number, dt: number, snapCamera: boolean) {
    if (!this.replayClip || !this.playerRig || !this.builtTrack) return;
    const frame = this.replayBuffer.sampleClipAt(this.replayClip, elapsedMs);
    if (!frame) return;

    const animDt = this.replayPlaying ? dt * this.replaySpeed : 0;
    this.playerRig.root.position.set(frame.x, frame.y, frame.z);
    this.playerRig.root.rotation.set(0, frame.headingRad, 0);
    this.playerRig.updateVisuals({
      speedKmh: frame.speedKmh,
      steer: frame.steer,
      leanAngleRad: frame.leanAngleRad,
      throttle: frame.throttle,
      braking: frame.brake > 0.1,
      nitroActive: frame.nitroActive,
      drsActive: frame.drsActive,
      pitchRad: frame.pitchRad,
      rollRad: frame.rollRad,
      dt: animDt,
    });

    // Apply opponent snapshots in deterministic order (remote rigs, then AI rivals)
    let oppIdx = 0;
    this.remoteRigs.forEach((entry) => {
      const snap = frame.opponents[oppIdx++];
      if (!snap) return;
      entry.rig.root.position.set(snap.x, snap.y, snap.z);
      entry.rig.root.rotation.set(0, snap.heading, 0);
      entry.rig.updateVisuals({
        speedKmh: snap.speedKmh,
        steer: snap.steer,
        leanAngleRad: snap.leanAngle,
        throttle: snap.speedKmh > 10 ? 0.8 : 0,
        braking: snap.braking,
        nitroActive: snap.nitroActive,
        drsActive: snap.drsActive,
        dt: animDt,
      });
    });
    for (let i = 0; i < this.aiRivals.length; i++) {
      const ai = this.aiRivals[i];
      const snap = frame.opponents[oppIdx++];
      if (!snap) continue;
      ai.rig.root.position.set(snap.x, snap.y, snap.z);
      ai.rig.root.rotation.set(0, snap.heading, 0);
      ai.rig.updateVisuals({
        speedKmh: snap.speedKmh,
        steer: snap.steer,
        leanAngleRad: snap.leanAngle,
        throttle: 1,
        braking: snap.braking,
        nitroActive: snap.nitroActive,
        drsActive: snap.drsActive,
        dt: animDt,
      });
    }

    const trackDef = TRACK_MAP[this.trackId];
    this.keyLight.position.set(
      frame.x + trackDef.sunPosition[0] * 0.3,
      frame.y + 45,
      frame.z + trackDef.sunPosition[2] * 0.3,
    );
    this.keyLight.target.position.set(frame.x, frame.y, frame.z);

    if (this.replayCamera === 'recorded') {
      this.camera.fov = frame.camFov;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(frame.camX, frame.camY, frame.camZ);
      this.camera.lookAt(frame.camTargetX, frame.camTargetY, frame.camTargetZ);
    } else if (this.replayCamera === 'tv_trackside') {
      const anchorProg =
        (Math.floor(((frame.checkpointProgress + 0.03) % 1) / 0.08) * 0.08 + 0.05) % 1;
      const pt = this.builtTrack.curve.getPointAt(anchorProg);
      const tan = this.builtTrack.curve.getTangentAt(anchorProg).normalize();
      const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
      const sideSign = Math.floor(anchorProg * 12) % 2 === 0 ? 1 : -1;
      const lateral = (trackDef.roadWidth * 0.5 + 7.5) * sideSign;
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(pt.x + right.x * lateral, pt.y + 5.8, pt.z + right.z * lateral);
      this.camera.lookAt(frame.x, frame.y + 0.85, frame.z);
    } else {
      this.applyPlayerCamera(
        this.replayCamera,
        frame.x,
        frame.y,
        frame.z,
        frame.headingRad,
        frame.speedKmh,
        frame.nitroActive || frame.drsActive,
        dt,
        snapCamera,
      );
    }

    if (this.replayPlaying) {
      this.audio.update({
        rpm: frame.rpm,
        maxRpm: frame.maxRpm,
        throttle: frame.throttle,
        speedKmh: frame.speedKmh,
        driftAngleDeg: frame.driftAngleDeg,
        nitroActive: frame.nitroActive || frame.drsActive,
        ecuStage: this.tuning.ecuStage,
        dt,
      });
      this.audio.updateCrowd({
        speedKmh: frame.speedKmh,
        rank: frame.rank,
        nearGrandstand: frame.checkpointProgress < 0.08 || frame.checkpointProgress > 0.92,
        drsOrNitro: frame.drsActive || frame.nitroActive,
        dt,
      });
    }

    this.telemetryAcc += dt;
    if (this.telemetryAcc >= 0.05 || snapCamera) {
      this.telemetryAcc = 0;
      const sector: 1 | 2 | 3 =
        frame.checkpointProgress < 0.33 ? 1 : frame.checkpointProgress < 0.66 ? 2 : 3;
      this.callbacks.onTelemetry({
        speedKmh: frame.speedKmh,
        rpm: frame.rpm,
        maxRpm: frame.maxRpm,
        gear: frame.gear,
        throttle: frame.throttle,
        brake: frame.brake,
        steer: frame.steer,
        leanAngleRad: frame.leanAngleRad,
        nitro: frame.nitro,
        nitroActive: frame.nitroActive,
        drsActive: frame.drsActive,
        drsAvailable: frame.drsAvailable,
        driftAngleDeg: frame.driftAngleDeg,
        isDrifting: frame.isDrifting,
        offTrack: frame.offTrack,
        lap: frame.lap,
        totalLaps: trackDef.laps,
        lapTimeMs: frame.lapTimeMs,
        bestLapMs: this.replayClip.lapTimeMs,
        totalRaceTimeMs: this.lastLiveTelemetry?.totalRaceTimeMs ?? frame.tMs,
        currentSector: sector,
        sectorTimesMs: [null, null, null],
        checkpointProgress: frame.checkpointProgress,
        positionX: frame.x,
        positionY: frame.y,
        positionZ: frame.z,
        headingRad: frame.headingRad,
        rank: frame.rank,
        totalRacers: frame.totalRacers,
        finished: false,
      });
      this.callbacks.onLabelsUpdate([]);
    }
  }

  private emitProjectedLabels() {
    const w = this.container.clientWidth || 1280;
    const h = this.container.clientHeight || 720;
    const labels: ProjectedLabel[] = [];

    const projectOne = (id: string, name: string, x: number, y: number, z: number) => {
      _projVec.set(x, y + 2.25, z);
      const dist = _projVec.distanceTo(this.camera.position);
      if (dist > 140) return;
      _projVec.project(this.camera);
      if (_projVec.z > 1) return;
      const sx = (_projVec.x * 0.5 + 0.5) * w;
      const sy = (-_projVec.y * 0.5 + 0.5) * h;
      if (sx < 0 || sx > w || sy < 0 || sy > h) return;
      labels.push({ id, name, x: sx, y: sy, distance: Math.round(dist) });
    };

    this.remoteRigs.forEach((r, id) => projectOne(id, r.name, r.currentX, r.currentY, r.currentZ));
    this.aiRivals.forEach((a, idx) => projectOne(`ai-${idx}`, a.name, a.x, a.y, a.z));

    this.callbacks.onLabelsUpdate(labels);
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    this.orbitControls.dispose();
    this.playerRig?.dispose();
    this.builtTrack?.dispose();
    this.remoteRigs.forEach((r) => r.rig.dispose());
    this.aiRivals.forEach((a) => a.rig.dispose());
    this.textures.dispose();
    this.commentary.stop();
    this.audio.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
