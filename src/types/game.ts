export type GameMode = 'f1' | 'casual';

export type VehicleCategory = 'f1' | 'supercar' | 'xuv' | 'bike';

export type VehicleId =
  | 'ferrari_f1'
  | 'mercedes_f1'
  | 'redbull_f1'
  | 'rolex_f1'
  | 'suhailll'
  | 'bmw_m4'
  | 'porsche_911_gt3rs'
  | 'valkyrie_rgt'
  | 'apex_stradale'
  | 'titan_xuv_r'
  | 'atlas_dakar'
  | 'ninja_z1000rr'
  | 'ducati_v4_corsa';

export type TrackId =
  | 'monaco'
  | 'silverstone'
  | 'monza'
  | 'coastal'
  | 'alpine'
  | 'midnight';

export type RimFinish = 'titanium' | 'forged_gold' | 'gloss_black' | 'bronze';

export type TireCompound = 'soft_f1' | 'medium_f1' | 'hard_f1' | 'street' | 'semi_slick' | 'drift' | 'all_terrain';

export type CameraMode = 'chase' | 'far_chase' | 't_cam' | 'hood' | 'bumper';

export type ReplayCameraMode = 'recorded' | 'tv_trackside' | CameraMode;

export type ControlScheme = 'buttons' | 'wheel' | 'slider' | 'tilt';

export interface ReplayOpponentSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
  speedKmh: number;
  steer: number;
  leanAngle: number;
  nitroActive: boolean;
  drsActive: boolean;
  braking: boolean;
}

export interface ReplayFrame {
  tMs: number;
  x: number;
  y: number;
  z: number;
  headingRad: number;
  speedKmh: number;
  rpm: number;
  maxRpm: number;
  gear: number;
  throttle: number;
  brake: number;
  steer: number;
  leanAngleRad: number;
  nitro: number;
  nitroActive: boolean;
  drsActive: boolean;
  drsAvailable: boolean;
  driftAngleDeg: number;
  isDrifting: boolean;
  offTrack: boolean;
  pitchRad: number;
  rollRad: number;
  lap: number;
  lapTimeMs: number;
  checkpointProgress: number;
  rank: number;
  totalRacers: number;
  camX: number;
  camY: number;
  camZ: number;
  camTargetX: number;
  camTargetY: number;
  camTargetZ: number;
  camFov: number;
  cameraMode: CameraMode;
  opponents: ReplayOpponentSnapshot[];
}

export interface ReplayStatus {
  active: boolean;
  playing: boolean;
  currentMs: number;
  durationMs: number;
  speed: 0.5 | 1 | 2;
  cameraMode: ReplayCameraMode;
  bestLapMs: number | null;
  lapNumber: number | null;
  hasBestLap: boolean;
  bufferSeconds: number;
}

export type CommentaryMode = 'mix' | 'hindi' | 'english' | 'off';

export type UpcomingTurnType =
  | 'straight'
  | 'left'
  | 'right'
  | 'sharp_left'
  | 'sharp_right'
  | 'hairpin_left'
  | 'hairpin_right';

export interface CommentaryCaption {
  id: string;
  speaker: 'english' | 'siddhu' | 'assistant';
  text: string;
}

export interface TuningConfig {
  paintColor: string;
  paintFinish: 'metallic' | 'matte' | 'pearl';
  rimFinish: RimFinish;
  underglow: boolean;
  underglowColor: string;
  ecuStage: 0 | 1 | 2 | 3; // Stock, Stage 1, Stage 2, Pro Race
  gearRatioBias: number; // 0 (Acceleration) -> 100 (Top Speed)
  suspensionHeight: number; // -10 (Slammed) -> +10 (Lifted)
  suspensionStiffness: number; // 0 (Soft) -> 100 (Track Stiff)
  aeroDownforce: number; // 0 (Low Drag) -> 100 (Max Downforce)
  brakeBias: number; // 30 -> 70 (% front)
  tireCompound: TireCompound;
}

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  manufacturer: string;
  mode: GameMode;
  category: VehicleCategory;
  year: number;
  engineLabel: string;
  soundProfile:
    | 'suhailll_w16'
    | 'f1_v6_hybrid'
    | 'flat6_gt3'
    | 'inline6_bmw'
    | 'v12'
    | 'v10'
    | 'v8_turbo'
    | 'i4_bike'
    | 'v4_bike';
  f1Team?: 'ferrari' | 'mercedes' | 'redbull' | 'rolex';
  carNumber?: string;
  baseHp: number;
  baseWeightKg: number;
  baseTopSpeedKmh: number;
  baseZeroToHundred: number;
  maxRpm: number;
  idleRpm: number;
  gears: number;
  baseGrip: number;
  dragCoeff: number;
  wheelRadius: number;
  wheelBase: number;
  trackWidth: number;
  rideHeightBase: number;
  maxLeanDeg: number; // >0 for superbikes
  defaultPaint: string;
  paintSwatches: { name: string; hex: string }[];
  description: string;
}

export interface ComputedVehicleStats {
  hp: number;
  weightKg: number;
  topSpeedKmh: number;
  zeroToHundredSec: number;
  gripRating: number;
  brakingRating: number;
  handlingScore: number;
  accelerationForce: number;
  lateralGrip: number;
  downforceFactor: number;
  dragFactor: number;
  gearScale: number;
  rideHeightOffset: number;
  suspensionSpring: number;
  maxRpm: number;
  driftSlipFactor: number;
}

export interface TrackControlPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackDefinition {
  id: TrackId;
  name: string;
  subtitle: string;
  location: string;
  mode: GameMode;
  lengthKm: number;
  roadWidth: number;
  laps: number;
  surfaceType: string;
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogDensity: number;
  sunColor: string;
  sunPosition: [number, number, number];
  ambientSky: string;
  ambientGround: string;
  hasTunnel?: boolean;
  controlPoints: TrackControlPoint[];
}

export interface VehicleTelemetry {
  speedKmh: number;
  rpm: number;
  maxRpm: number;
  gear: number; // 0 = N, -1 = R, 1..8 = forward gears
  throttle: number;
  brake: number;
  steer: number;
  leanAngleRad: number;
  nitro: number; // 0..100 (ERS/NOS)
  nitroActive: boolean;
  drsActive: boolean;
  drsAvailable: boolean;
  driftAngleDeg: number;
  isDrifting: boolean;
  offTrack: boolean;
  lap: number;
  totalLaps: number;
  lapTimeMs: number;
  bestLapMs: number | null;
  totalRaceTimeMs: number;
  currentSector: 1 | 2 | 3;
  sectorTimesMs: [number | null, number | null, number | null];
  checkpointProgress: number; // 0..1 along spline
  positionX: number;
  positionY: number;
  positionZ: number;
  headingRad: number;
  rank: number;
  totalRacers: number;
  finished: boolean;
  upcomingTurn?: UpcomingTurnType;
  upcomingTurnDistM?: number;
  brakeRecommended?: boolean;
}

export interface InputControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (right) .. +1 (left)
  handbrake: boolean;
  nitro: boolean; // ERS / NOS
  drs: boolean;
  horn: boolean;
}

export interface RemotePlayerState {
  id: string;
  name: string;
  vehicleId: VehicleId;
  tuning: TuningConfig;
  x: number;
  y: number;
  z: number;
  heading: number;
  speedKmh: number;
  steer: number;
  leanAngle: number;
  nitroActive: boolean;
  drsActive?: boolean;
  braking: boolean;
  lap: number;
  progress: number;
  finished: boolean;
  finishTimeMs?: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  trackId: TrackId;
  mode: GameMode;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'countdown' | 'racing';
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  system?: boolean;
}

export interface LeaderboardEntry {
  id: string;
  playerName: string;
  vehicleId: VehicleId;
  vehicleName: string;
  category: VehicleCategory;
  trackId: TrackId;
  bestLapMs: number;
  topSpeedKmh: number;
  ecuStage: number;
  createdAt: number;
}
