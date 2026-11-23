import * as THREE from 'three';
import { ReplayFrame, ReplayOpponentSnapshot } from '../types/game';

export const REPLAY_WINDOW_MS = 30_000;
const SAMPLE_INTERVAL_MS = 33; // ~30 Hz

export interface SavedReplayClip {
  lapTimeMs: number;
  lapNumber: number;
  durationMs: number;
  frames: ReplayFrame[];
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class ReplayBufferManager {
  private rollingFrames: ReplayFrame[] = [];
  private lastSampledAtMs = -Infinity;
  private bestLapClip: SavedReplayClip | null = null;

  public reset() {
    this.rollingFrames = [];
    this.lastSampledAtMs = -Infinity;
    this.bestLapClip = null;
  }

  public recordFrame(frame: ReplayFrame) {
    if (
      this.rollingFrames.length > 0 &&
      frame.tMs - this.lastSampledAtMs < SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    this.lastSampledAtMs = frame.tMs;
    this.rollingFrames.push(frame);

    const cutoff = frame.tMs - REPLAY_WINDOW_MS;
    while (this.rollingFrames.length > 2 && this.rollingFrames[0].tMs < cutoff) {
      this.rollingFrames.shift();
    }
  }

  public captureBestLapIfFaster(lapTimeMs: number, lapNumber: number): boolean {
    if (this.rollingFrames.length < 2) return false;
    if (this.bestLapClip !== null && lapTimeMs >= this.bestLapClip.lapTimeMs) {
      return false;
    }

    const baseT = this.rollingFrames[0].tMs;
    const clonedFrames: ReplayFrame[] = this.rollingFrames.map((f) => ({
      ...f,
      tMs: Math.max(0, f.tMs - baseT),
      opponents: f.opponents.map((o) => ({ ...o })),
    }));
    const durationMs = clonedFrames[clonedFrames.length - 1].tMs;

    this.bestLapClip = {
      lapTimeMs,
      lapNumber,
      durationMs: Math.max(100, durationMs),
      frames: clonedFrames,
    };
    return true;
  }

  public getBestLapClip(): SavedReplayClip | null {
    return this.bestLapClip;
  }

  public getRollingDurationSeconds(): number {
    if (this.rollingFrames.length < 2) return 0;
    const spanMs =
      this.rollingFrames[this.rollingFrames.length - 1].tMs - this.rollingFrames[0].tMs;
    return Math.min(30, Math.max(0, Number((spanMs / 1000).toFixed(1))));
  }

  public sampleClipAt(clip: SavedReplayClip, elapsedMs: number): ReplayFrame | null {
    const frames = clip.frames;
    if (frames.length === 0) return null;
    if (frames.length === 1 || elapsedMs <= 0) return frames[0];
    if (elapsedMs >= clip.durationMs) return frames[frames.length - 1];

    // Binary search for bracketing frames
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].tMs <= elapsedMs) lo = mid;
      else hi = mid;
    }

    const a = frames[lo];
    const b = frames[hi];
    const span = Math.max(1, b.tMs - a.tMs);
    const alpha = THREE.MathUtils.clamp((elapsedMs - a.tMs) / span, 0, 1);

    const oppCount = Math.min(a.opponents.length, b.opponents.length);
    const opponents: ReplayOpponentSnapshot[] = [];
    for (let i = 0; i < oppCount; i++) {
      const oa = a.opponents[i];
      const ob = b.opponents[i];
      opponents.push({
        x: THREE.MathUtils.lerp(oa.x, ob.x, alpha),
        y: THREE.MathUtils.lerp(oa.y, ob.y, alpha),
        z: THREE.MathUtils.lerp(oa.z, ob.z, alpha),
        heading: lerpAngle(oa.heading, ob.heading, alpha),
        speedKmh: THREE.MathUtils.lerp(oa.speedKmh, ob.speedKmh, alpha),
        steer: THREE.MathUtils.lerp(oa.steer, ob.steer, alpha),
        leanAngle: THREE.MathUtils.lerp(oa.leanAngle, ob.leanAngle, alpha),
        nitroActive: alpha < 0.5 ? oa.nitroActive : ob.nitroActive,
        drsActive: alpha < 0.5 ? oa.drsActive : ob.drsActive,
        braking: alpha < 0.5 ? oa.braking : ob.braking,
      });
    }

    return {
      ...a,
      tMs: elapsedMs,
      x: THREE.MathUtils.lerp(a.x, b.x, alpha),
      y: THREE.MathUtils.lerp(a.y, b.y, alpha),
      z: THREE.MathUtils.lerp(a.z, b.z, alpha),
      headingRad: lerpAngle(a.headingRad, b.headingRad, alpha),
      speedKmh: Math.round(THREE.MathUtils.lerp(a.speedKmh, b.speedKmh, alpha)),
      rpm: Math.round(THREE.MathUtils.lerp(a.rpm, b.rpm, alpha)),
      gear: alpha < 0.5 ? a.gear : b.gear,
      throttle: THREE.MathUtils.lerp(a.throttle, b.throttle, alpha),
      brake: THREE.MathUtils.lerp(a.brake, b.brake, alpha),
      steer: THREE.MathUtils.lerp(a.steer, b.steer, alpha),
      leanAngleRad: THREE.MathUtils.lerp(a.leanAngleRad, b.leanAngleRad, alpha),
      nitro: THREE.MathUtils.lerp(a.nitro, b.nitro, alpha),
      nitroActive: alpha < 0.5 ? a.nitroActive : b.nitroActive,
      drsActive: alpha < 0.5 ? a.drsActive : b.drsActive,
      driftAngleDeg: Math.round(THREE.MathUtils.lerp(a.driftAngleDeg, b.driftAngleDeg, alpha)),
      isDrifting: alpha < 0.5 ? a.isDrifting : b.isDrifting,
      offTrack: alpha < 0.5 ? a.offTrack : b.offTrack,
      pitchRad: THREE.MathUtils.lerp(a.pitchRad, b.pitchRad, alpha),
      rollRad: THREE.MathUtils.lerp(a.rollRad, b.rollRad, alpha),
      lapTimeMs: THREE.MathUtils.lerp(a.lapTimeMs, b.lapTimeMs, alpha),
      checkpointProgress:
        Math.abs(b.checkpointProgress - a.checkpointProgress) > 0.5
          ? a.checkpointProgress
          : THREE.MathUtils.lerp(a.checkpointProgress, b.checkpointProgress, alpha),
      camX: THREE.MathUtils.lerp(a.camX, b.camX, alpha),
      camY: THREE.MathUtils.lerp(a.camY, b.camY, alpha),
      camZ: THREE.MathUtils.lerp(a.camZ, b.camZ, alpha),
      camTargetX: THREE.MathUtils.lerp(a.camTargetX, b.camTargetX, alpha),
      camTargetY: THREE.MathUtils.lerp(a.camTargetY, b.camTargetY, alpha),
      camTargetZ: THREE.MathUtils.lerp(a.camTargetZ, b.camTargetZ, alpha),
      camFov: THREE.MathUtils.lerp(a.camFov, b.camFov, alpha),
      opponents,
    };
  }
}
