import * as THREE from 'three';
import { computeTunedStats, TRACK_MAP, VEHICLE_MAP } from '../data/vehicles';
import {
  InputControls,
  TrackId,
  TuningConfig,
  VehicleId,
  VehicleTelemetry,
} from '../types/game';
import { BuiltTrack } from './tracks3d';

export interface PhysicsCallbacks {
  onCollision?: (impactSpeed: number) => void;
  onGearShift?: (newGear: number, up: boolean) => void;
  onLapComplete?: (lapTimeMs: number, lapNumber: number, finished: boolean) => void;
}

export class VehiclePhysicsEngine {
  public x = 0;
  public y = 0;
  public z = 0;
  public vx = 0;
  public vz = 0;
  public heading = 0;
  public angularVel = 0;

  public gear = 1;
  public rpm = 1000;
  public nitro = 100;
  public nitroActive = false;
  public drsActive = false;
  public leanAngleRad = 0;
  public pitchRad = 0;
  public rollRad = 0;
  public smoothSteer = 0;

  public lap = 1;
  public lapTimeMs = 0;
  public totalRaceTimeMs = 0;
  public bestLapMs: number | null = null;
  public finished = false;
  public raceFrozen = false;

  private sectorTimesMs: [number | null, number | null, number | null] = [null, null, null];
  private sectorStartMs = 0;
  private currentSector: 1 | 2 | 3 = 1;

  private lastProgress = 0;
  private maxCheckpointSeen = 0;
  private prevForwardSpeed = 0;
  private prevLatAccel = 0;
  private shiftCooldown = 0;
  private manualTransmission = false;

  private vehicleId: VehicleId = 'ferrari_f1';
  private trackId: TrackId = 'monaco';
  private tuning: TuningConfig;

  constructor(vehicleId: VehicleId, trackId: TrackId, tuning: TuningConfig) {
    this.vehicleId = vehicleId;
    this.trackId = trackId;
    this.tuning = tuning;
  }

  public setManualTransmission(manual: boolean) {
    this.manualTransmission = manual;
  }

  public shiftUp() {
    const spec = VEHICLE_MAP[this.vehicleId];
    if (this.gear < spec.gears) {
      this.gear = this.gear <= 0 ? 1 : this.gear + 1;
    }
  }

  public shiftDown() {
    if (this.gear > -1) {
      this.gear = this.gear === 1 ? -1 : this.gear - 1;
    }
  }

  public configure(vehicleId: VehicleId, trackId: TrackId, tuning: TuningConfig) {
    this.vehicleId = vehicleId;
    this.trackId = trackId;
    this.tuning = tuning;
  }

  public resetToStart(track: BuiltTrack, slotIndex = 0) {
    const start = track.getStartTransform(slotIndex);
    this.x = start.x;
    this.y = start.y;
    this.z = start.z;
    this.heading = start.heading;
    this.vx = 0;
    this.vz = 0;
    this.angularVel = 0;
    this.gear = 1;
    this.rpm = VEHICLE_MAP[this.vehicleId].idleRpm;
    this.nitro = 100;
    this.nitroActive = false;
    this.drsActive = false;
    this.leanAngleRad = 0;
    this.pitchRad = 0;
    this.rollRad = 0;
    this.smoothSteer = 0;
    this.lap = 1;
    this.lapTimeMs = 0;
    this.totalRaceTimeMs = 0;
    this.bestLapMs = null;
    this.finished = false;
    this.lastProgress = 0.98;
    this.maxCheckpointSeen = 0;
    this.sectorTimesMs = [null, null, null];
    this.sectorStartMs = 0;
    this.currentSector = 1;
  }

  public step(
    dt: number,
    controls: InputControls,
    track: BuiltTrack,
    callbacks?: PhysicsCallbacks,
  ): VehicleTelemetry {
    const clampedDt = Math.min(dt, 0.05);
    const spec = VEHICLE_MAP[this.vehicleId];
    const trackDef = TRACK_MAP[this.trackId];
    const stats = computeTunedStats(spec, this.tuning);

    const sample = track.sampleAt(this.x, this.z);
    this.y = THREE.MathUtils.damp(this.y, sample.elevationY, 16, clampedDt);

    const offTrack = sample.distanceFromCenter > sample.roadHalfWidth + 1.2;
    const isXuv = spec.category === 'xuv';
    const isBike = spec.category === 'bike';
    const isF1 = spec.category === 'f1';

    this.smoothSteer = THREE.MathUtils.damp(this.smoothSteer, controls.steer, 12, clampedDt);

    const fwdX = -Math.sin(this.heading);
    const fwdZ = -Math.cos(this.heading);
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);

    let forwardSpeed = this.vx * fwdX + this.vz * fwdZ;
    let lateralSpeed = this.vx * rightX + this.vz * rightZ;
    const speedMs = Math.hypot(this.vx, this.vz);
    const speedKmh = speedMs * 3.6;

    if (this.raceFrozen) {
      const targetIdle = spec.idleRpm + controls.throttle * (stats.maxRpm - spec.idleRpm) * 0.85;
      this.rpm = THREE.MathUtils.damp(this.rpm, targetIdle, 10, clampedDt);
      return {
        speedKmh: 0,
        rpm: Math.round(this.rpm),
        maxRpm: stats.maxRpm,
        gear: 1,
        throttle: controls.throttle,
        brake: controls.brake,
        steer: this.smoothSteer,
        leanAngleRad: 0,
        nitro: this.nitro,
        nitroActive: false,
        drsActive: false,
        drsAvailable: false,
        driftAngleDeg: 0,
        isDrifting: false,
        offTrack: false,
        lap: this.lap,
        totalLaps: trackDef.laps,
        lapTimeMs: 0,
        bestLapMs: this.bestLapMs,
        totalRaceTimeMs: 0,
        currentSector: 1,
        sectorTimesMs: this.sectorTimesMs,
        checkpointProgress: sample.progress,
        positionX: this.x,
        positionY: this.y,
        positionZ: this.z,
        headingRad: this.heading,
        rank: 1,
        totalRacers: 1,
        finished: false,
      };
    }

    if (!this.finished) {
      this.lapTimeMs += clampedDt * 1000;
      this.totalRaceTimeMs += clampedDt * 1000;
    }

    // F1 DRS activation (cuts aero drag on high-speed straights, auto-closes on braking)
    const drsAvailable = (isF1 || spec.id === 'suhailll') && speedKmh > 125 && controls.brake < 0.1;
    if (drsAvailable && controls.drs && controls.throttle > 0.3) {
      this.drsActive = true;
    } else {
      this.drsActive = false;
    }

    // ERS / Nitrous boost management (ERS also harvests under braking!)
    if (controls.nitro && this.nitro > 4 && controls.throttle > 0.1) {
      this.nitroActive = true;
      this.nitro = Math.max(0, this.nitro - clampedDt * 23);
    } else {
      this.nitroActive = false;
      const harvestRate =
        controls.brake > 0.2 ? 15 : controls.handbrake ? 11 : 4.8;
      this.nitro = Math.min(100, this.nitro + clampedDt * harvestRate);
    }

    const topSpeedMs =
      (stats.topSpeedKmh / 3.6) *
      (this.nitroActive ? 1.11 : 1.0) *
      (this.drsActive ? 1.08 : 1.0);
    const gearCount = spec.gears;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - clampedDt);

    let reversing = false;
    if (!this.manualTransmission) {
      if (controls.brake > 0.25 && forwardSpeed < 1.8 && controls.throttle < 0.1) {
        this.gear = -1;
        reversing = true;
      } else if (this.gear === -1 && controls.throttle > 0.2 && forwardSpeed > -1.5) {
        this.gear = 1;
      }
    } else if (this.gear === -1) {
      reversing = true;
    }

    const gearSpan = topSpeedMs / gearCount;
    const currentGearMaxSpeed = Math.max(12, Math.abs(this.gear) * gearSpan * stats.gearScale);
    const prevGearMinSpeed = Math.max(0, (Math.abs(this.gear) - 1) * gearSpan * 0.6 * stats.gearScale);

    if (!this.manualTransmission && this.gear > 0 && this.shiftCooldown <= 0) {
      const normalizedInGear =
        (Math.abs(forwardSpeed) - prevGearMinSpeed) / Math.max(8, currentGearMaxSpeed - prevGearMinSpeed);
      if (normalizedInGear > 0.94 && this.gear < gearCount && controls.throttle > 0.2) {
        this.gear += 1;
        this.shiftCooldown = 0.24;
        callbacks?.onGearShift?.(this.gear, true);
      } else if (normalizedInGear < 0.14 && this.gear > 1) {
        this.gear -= 1;
        this.shiftCooldown = 0.24;
        callbacks?.onGearShift?.(this.gear, false);
      }
    }

    const effectiveThrottle = controls.throttle > 0 ? Math.pow(controls.throttle, 0.85) : 0;

    const speedRatioInGear = THREE.MathUtils.clamp(
      (Math.abs(forwardSpeed) - prevGearMinSpeed * 0.5) /
        Math.max(10, currentGearMaxSpeed - prevGearMinSpeed * 0.5),
      0,
      1.12,
    );
    const targetRpm =
      spec.idleRpm +
      THREE.MathUtils.clamp(
        speedRatioInGear * (stats.maxRpm - spec.idleRpm) + effectiveThrottle * 780,
        0,
        stats.maxRpm - spec.idleRpm,
      );
    this.rpm = THREE.MathUtils.damp(this.rpm, targetRpm, 16, clampedDt);

    const rpmNorm = (this.rpm - spec.idleRpm) / (stats.maxRpm - spec.idleRpm);
    const torqueCurve = 0.88 + 0.26 * Math.sin(THREE.MathUtils.clamp(rpmNorm, 0, 1) * Math.PI * 0.85);
    const gearMult = this.gear > 0 ? 1 + (gearCount - this.gear) * 0.115 : 0.78;
    const lowEndLaunchBoost =
      forwardSpeed >= 0 && forwardSpeed < 34 ? 1 + 0.28 * Math.exp(-forwardSpeed / 15) : 1;

    let longAccel = 0;
    if (reversing) {
      longAccel = -controls.brake * 13.5;
      if (effectiveThrottle > 0.15) {
        longAccel += effectiveThrottle * 20;
      }
    } else {
      const throttleDrive =
        effectiveThrottle * stats.accelerationForce * torqueCurve * gearMult * lowEndLaunchBoost;
      const nitroBoost = this.nitroActive ? 15.5 : 0;
      const drsBoost = this.drsActive ? 5.5 : 0;
      const brakeDecel = controls.brake * (24 + stats.brakingRating * 0.16);

      if (forwardSpeed >= -0.5) {
        longAccel = throttleDrive + nitroBoost + drsBoost - brakeDecel;
      } else {
        longAccel = throttleDrive;
      }
    }

    const surfaceGripMult = offTrack ? (isXuv ? 0.88 : 0.6) : 1.0;
    const surfaceDragMult = offTrack ? (isXuv ? 0.015 : 0.07) : 0.008;

    const effectiveDrag = stats.dragFactor * (this.drsActive ? 0.68 : 1.0);
    const aeroDrag = effectiveDrag * 0.0036 * forwardSpeed * Math.abs(forwardSpeed);
    const rollingDrag = forwardSpeed * (0.1 + surfaceDragMult * 4.0);
    longAccel -= aeroDrag + rollingDrag;

    if (forwardSpeed > topSpeedMs && longAccel > 0) {
      longAccel *= 0.08;
    }
    if (forwardSpeed < -22 && longAccel < 0) {
      longAccel = 0;
    }

    forwardSpeed += longAccel * clampedDt;

    const speedFactor = THREE.MathUtils.clamp(speedMs / 5.5, 0.08, 1.0);
    const reverseSign = forwardSpeed >= -0.5 ? 1 : -1;
    const handbrakeDrift = controls.handbrake && speedMs > 6;

    const steerRate =
      (isF1 ? 2.48 : isBike ? 2.58 : isXuv ? 1.9 : 2.22) *
      (1 / (1 + speedMs * 0.0115)) *
      speedFactor *
      reverseSign;

    const targetYawRate = this.smoothSteer * steerRate * (handbrakeDrift ? 1.48 : 1.0);
    this.angularVel = THREE.MathUtils.damp(this.angularVel, targetYawRate, 13, clampedDt);
    this.heading += this.angularVel * clampedDt;

    const newFwdX = -Math.sin(this.heading);
    const newFwdZ = -Math.cos(this.heading);
    const newRightX = Math.cos(this.heading);
    const newRightZ = -Math.sin(this.heading);

    const downforceGrip = 1 + (speedMs / 85) * stats.downforceFactor * (this.drsActive ? 0.18 : 0.3);
    const lowSpeedTraction = speedMs < 24 && !handbrakeDrift ? 1.22 : 1.0;
    const driftReduction = handbrakeDrift ? 0.28 : 1.0;
    const lateralDamp =
      (6.2 * stats.lateralGrip * surfaceGripMult * downforceGrip * lowSpeedTraction * driftReduction) /
      stats.driftSlipFactor;

    const prevLat = lateralSpeed;
    lateralSpeed = THREE.MathUtils.damp(lateralSpeed, 0, lateralDamp, clampedDt);

    this.vx = newFwdX * forwardSpeed + newRightX * lateralSpeed;
    this.vz = newFwdZ * forwardSpeed + newRightZ * lateralSpeed;

    this.x += this.vx * clampedDt;
    this.z += this.vz * clampedDt;

    const barrierLimit = sample.roadHalfWidth + 3.4;
    if (sample.distanceFromCenter > barrierLimit) {
      const toCenterX = sample.closestPoint.x - this.x;
      const toCenterZ = sample.closestPoint.z - this.z;
      const len = Math.hypot(toCenterX, toCenterZ) || 1;
      const nx = toCenterX / len;
      const nz = toCenterZ / len;

      const excess = sample.distanceFromCenter - barrierLimit;
      this.x += nx * excess;
      this.z += nz * excess;

      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        const impact = Math.abs(vn);
        this.vx -= 1.35 * vn * nx;
        this.vz -= 1.35 * vn * nz;
        this.vx *= 0.85;
        this.vz *= 0.85;
        if (impact > 4) {
          callbacks?.onCollision?.(impact);
        }
      }
    }

    const dv = (forwardSpeed - this.prevForwardSpeed) / Math.max(0.001, clampedDt);
    this.prevForwardSpeed = forwardSpeed;
    const latA = (lateralSpeed - prevLat) / Math.max(0.001, clampedDt) + this.angularVel * forwardSpeed;
    this.prevLatAccel = THREE.MathUtils.damp(this.prevLatAccel, latA, 8, clampedDt);

    const softFactor = 1.2 - stats.suspensionSpring * 0.58;
    this.pitchRad = THREE.MathUtils.clamp(-dv * 0.0024 * softFactor, -0.07, 0.07);
    this.rollRad = THREE.MathUtils.clamp(-this.prevLatAccel * 0.0032 * softFactor, -0.09, 0.09);

    if (isBike) {
      const maxLeanRad = THREE.MathUtils.degToRad(spec.maxLeanDeg);
      const targetLean = THREE.MathUtils.clamp(
        this.smoothSteer * THREE.MathUtils.clamp(speedMs / 22, 0.05, 1.0) * maxLeanRad,
        -maxLeanRad,
        maxLeanRad,
      );
      this.leanAngleRad = THREE.MathUtils.damp(this.leanAngleRad, targetLean, 9, clampedDt);
    } else {
      this.leanAngleRad = 0;
    }

    const driftAngleDeg =
      speedMs > 4
        ? Math.abs(THREE.MathUtils.radToDeg(Math.atan2(lateralSpeed, Math.max(1, Math.abs(forwardSpeed)))))
        : 0;
    const isDrifting = driftAngleDeg > 11 && speedKmh > 35;

    // Sector splits & valid lap progression
    const prog = sample.progress;
    if (prog > 0.33 && this.currentSector === 1 && this.maxCheckpointSeen >= 1) {
      this.sectorTimesMs[0] = this.lapTimeMs - this.sectorStartMs;
      this.sectorStartMs = this.lapTimeMs;
      this.currentSector = 2;
    }
    if (prog > 0.66 && this.currentSector === 2 && this.maxCheckpointSeen >= 2) {
      this.sectorTimesMs[1] = this.lapTimeMs - this.sectorStartMs;
      this.sectorStartMs = this.lapTimeMs;
      this.currentSector = 3;
    }

    if (prog > 0.2 && prog < 0.45 && this.maxCheckpointSeen === 0) this.maxCheckpointSeen = 1;
    if (prog > 0.48 && prog < 0.72 && this.maxCheckpointSeen === 1) this.maxCheckpointSeen = 2;
    if (prog > 0.74 && prog < 0.95 && this.maxCheckpointSeen === 2) this.maxCheckpointSeen = 3;

    if (this.lastProgress > 0.85 && prog < 0.15 && this.maxCheckpointSeen >= 2) {
      this.sectorTimesMs[2] = this.lapTimeMs - this.sectorStartMs;
      const completedTime = this.lapTimeMs;
      if (this.bestLapMs === null || completedTime < this.bestLapMs) {
        this.bestLapMs = completedTime;
      }
      const justFinished = this.lap >= trackDef.laps;
      callbacks?.onLapComplete?.(completedTime, this.lap, justFinished);
      if (justFinished) {
        this.finished = true;
      } else {
        this.lap += 1;
        this.lapTimeMs = 0;
        this.sectorStartMs = 0;
        this.currentSector = 1;
        this.maxCheckpointSeen = 0;
      }
    }
    this.lastProgress = prog;

    return {
      speedKmh: Math.round(speedKmh),
      rpm: Math.round(this.rpm),
      maxRpm: stats.maxRpm,
      gear: this.gear,
      throttle: controls.throttle,
      brake: controls.brake,
      steer: this.smoothSteer,
      leanAngleRad: this.leanAngleRad,
      nitro: Math.round(this.nitro),
      nitroActive: this.nitroActive,
      drsActive: this.drsActive,
      drsAvailable,
      driftAngleDeg: Math.round(driftAngleDeg),
      isDrifting,
      offTrack,
      lap: this.lap,
      totalLaps: trackDef.laps,
      lapTimeMs: this.lapTimeMs,
      bestLapMs: this.bestLapMs,
      totalRaceTimeMs: this.totalRaceTimeMs,
      currentSector: this.currentSector,
      sectorTimesMs: [...this.sectorTimesMs] as [number | null, number | null, number | null],
      checkpointProgress: prog,
      positionX: this.x,
      positionY: this.y,
      positionZ: this.z,
      headingRad: this.heading,
      rank: 1,
      totalRacers: 1,
      finished: this.finished,
    };
  }
}
