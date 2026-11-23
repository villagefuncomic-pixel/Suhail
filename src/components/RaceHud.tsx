import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Compass,
  Film,
  Flame,
  Gamepad2,
  Home,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
  Trophy,
  Volume2,
  VolumeX,
  Wind,
  X,
} from 'lucide-react';
import { ProjectedLabel } from '../engine/GameRenderer';
import {
  CameraMode,
  CommentaryCaption,
  CommentaryMode,
  ControlScheme,
  GameMode,
  InputControls,
  ReplayCameraMode,
  ReplayStatus,
  VehicleTelemetry,
} from '../types/game';
import { formatLapTime } from './LeaderboardModal';

interface RaceHudProps {
  gameMode: GameMode;
  telemetry: VehicleTelemetry;
  labels: ProjectedLabel[];
  minimapPoints: { x: number; z: number }[];
  opponents: { x: number; z: number; name: string }[];
  cameraMode: CameraMode;
  onCycleCamera: () => void;
  muted: boolean;
  onToggleMute: () => void;
  commentaryMode: CommentaryMode;
  onCycleCommentaryMode: () => void;
  commentaryCaption: CommentaryCaption | null;
  manualGearbox: boolean;
  onToggleGearbox: () => void;
  onShiftGear: (up: boolean) => void;
  onHorn: () => void;
  onExitToGarage: () => void;
  onRestartRace: () => void;
  countdownText: string | null;
  startLightsCount: number | null;
  touchEnabled: boolean;
  onToggleTouch: () => void;
  controlScheme: ControlScheme;
  onToggleControlScheme: () => void;
  onToggleTiltQuick: () => void;
  onControlsChange: (patch: Partial<InputControls>) => void;
  onSubmitLeaderboard: () => Promise<{ rank: number } | null>;
  isMultiplayer: boolean;
  replayStatus: ReplayStatus;
  onStartReplay: () => void;
  onExitReplay: () => void;
  onToggleReplayPlay: () => void;
  onSeekReplay: (ms: number) => void;
  onCycleReplaySpeed: () => void;
  onCycleReplayCamera: () => void;
}

const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: 'Chase',
  far_chase: 'Far',
  t_cam: 'T-Cam',
  hood: 'Hood',
  bumper: 'Bumper',
};

const REPLAY_CAMERA_LABEL: Record<ReplayCameraMode, string> = {
  recorded: 'Recorded',
  tv_trackside: 'Trackside TV',
  chase: 'Chase',
  far_chase: 'Far',
  t_cam: 'T-Cam',
  hood: 'Hood',
  bumper: 'Bumper',
};

const SCHEME_LABEL: Record<ControlScheme, string> = {
  buttons: 'Pads',
  slider: 'Slider',
  wheel: 'Wheel',
  tilt: 'Tilt',
};

const COMMENTARY_LABEL: Record<CommentaryMode, string> = {
  mix: 'EN + Siddhu',
  hindi: 'Siddhu HI',
  english: 'EN Race',
  off: 'Comm Off',
};

export const RaceHud: React.FC<RaceHudProps> = ({
  gameMode,
  telemetry,
  labels,
  minimapPoints,
  opponents,
  cameraMode,
  onCycleCamera,
  muted,
  onToggleMute,
  commentaryMode,
  onCycleCommentaryMode,
  commentaryCaption,
  manualGearbox,
  onToggleGearbox,
  onShiftGear,
  onHorn,
  onExitToGarage,
  onRestartRace,
  countdownText,
  startLightsCount,
  touchEnabled,
  onToggleTouch,
  controlScheme,
  onToggleControlScheme,
  onToggleTiltQuick,
  onControlsChange,
  onSubmitLeaderboard,
  isMultiplayer,
  replayStatus,
  onStartReplay,
  onExitReplay,
  onToggleReplayPlay,
  onSeekReplay,
  onCycleReplaySpeed,
  onCycleReplayCamera,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [submittedRank, setSubmittedRank] = useState<number | null>(null);
  const [wheelAngleDeg, setWheelAngleDeg] = useState(0);
  const [sliderNorm, setSliderNorm] = useState(0); // -1 (right) .. +1 (left)
  const [tiltSteer, setTiltSteer] = useState(0); // -1 (right) .. +1 (left)
  const [tiltDeg, setTiltDeg] = useState(0);
  const [tiltNeedsPermission, setTiltNeedsPermission] = useState(false);
  const [tiltSensorActive, setTiltSensorActive] = useState(false);
  const [drsLatched, setDrsLatched] = useState(false);
  const [isPortraitNarrow, setIsPortraitNarrow] = useState(false);
  const [dismissedRotateHint, setDismissedRotateHint] = useState(false);

  const wheelRef = useRef<HTMLDivElement | null>(null);
  const wheelPointerId = useRef<number | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const sliderPointerId = useRef<number | null>(null);
  const tiltBarRef = useRef<HTMLDivElement | null>(null);
  const tiltPointerId = useRef<number | null>(null);
  const tiltCenterDegRef = useRef<number | null>(null);
  const latestRawTiltDegRef = useRef<number>(0);

  const readScreenTiltAngle = useCallback((ev: DeviceOrientationEvent): number | null => {
    const orientAngle =
      typeof window.screen?.orientation?.angle === 'number'
        ? window.screen.orientation.angle
        : typeof (window as unknown as { orientation?: number }).orientation === 'number'
        ? ((window as unknown as { orientation: number }).orientation ?? 0)
        : window.innerWidth > window.innerHeight
        ? 90
        : 0;

    if (orientAngle === 90) {
      return typeof ev.beta === 'number' ? ev.beta : null;
    }
    if (orientAngle === -90 || orientAngle === 270) {
      return typeof ev.beta === 'number' ? -ev.beta : null;
    }
    if (orientAngle === 180) {
      return typeof ev.gamma === 'number' ? -ev.gamma : null;
    }
    return typeof ev.gamma === 'number' ? ev.gamma : null;
  }, []);

  const requestTiltPermission = useCallback(async () => {
    try {
      const DOE = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (DOE && typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res === 'granted') {
          setTiltNeedsPermission(false);
          setTiltSensorActive(true);
        }
      } else {
        setTiltNeedsPermission(false);
        setTiltSensorActive(true);
      }
    } catch {
      setTiltNeedsPermission(true);
    }
  }, []);

  useEffect(() => {
    if (controlScheme !== 'tilt') {
      tiltCenterDegRef.current = null;
      setTiltSteer(0);
      setTiltDeg(0);
      setTiltSensorActive(false);
      onControlsChange({ steer: 0 });
      return;
    }

    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const needsExplicitPerm = Boolean(DOE && typeof DOE.requestPermission === 'function');
    if (needsExplicitPerm && !tiltSensorActive) {
      setTiltNeedsPermission(true);
    }

    const onOrientation = (ev: DeviceOrientationEvent) => {
      const raw = readScreenTiltAngle(ev);
      if (raw === null || Number.isNaN(raw)) return;
      latestRawTiltDegRef.current = raw;
      if (tiltCenterDegRef.current === null) {
        tiltCenterDegRef.current = raw;
      }
      setTiltSensorActive(true);
      setTiltNeedsPermission(false);

      const relDeg = raw - tiltCenterDegRef.current;
      setTiltDeg(Math.round(relDeg));

      // Deadzone 2.5 deg, full lock at 28 deg; tilting left (negative relDeg) -> positive steer (+1)
      const deadzone = 2.5;
      const maxAngle = 28;
      const absRel = Math.abs(relDeg);
      let steerVal = 0;
      if (absRel > deadzone) {
        const norm = Math.min(1, (absRel - deadzone) / (maxAngle - deadzone));
        const curved = Math.pow(norm, 1.15);
        steerVal = relDeg < 0 ? curved : -curved;
      }
      setTiltSteer(steerVal);
      onControlsChange({ steer: steerVal });
    };

    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [controlScheme, tiltSensorActive, readScreenTiltAngle, onControlsChange]);

  useEffect(() => {
    const checkOrientation = () => {
      setIsPortraitNarrow(window.innerHeight > window.innerWidth && window.innerWidth < 680);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Auto-disarm DRS when braking for realistic F1 behavior
  useEffect(() => {
    if (drsLatched && telemetry.brake > 0.12) {
      setDrsLatched(false);
      onControlsChange({ drs: false });
    }
  }, [drsLatched, telemetry.brake, onControlsChange]);

  const minimapData = useMemo(() => {
    if (minimapPoints.length < 3) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of minimapPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const pad = 12;
    const size = 100;
    const scale = (size - pad * 2) / span;
    const offsetX = (size - (maxX - minX) * scale) / 2;
    const offsetY = (size - (maxZ - minZ) * scale) / 2;

    const toSvg = (wx: number, wz: number) => ({
      sx: (wx - minX) * scale + offsetX,
      sy: (wz - minZ) * scale + offsetY,
    });

    const pts = minimapPoints.map((p) => {
      const { sx, sy } = toSvg(p.x, p.z);
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    });

    return { pointsAttr: pts.join(' '), toSvg };
  }, [minimapPoints]);

  const rpmPercent = Math.min(100, Math.max(0, (telemetry.rpm / telemetry.maxRpm) * 100));

  const updateWheelFromPointer = (clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    let angle = Math.atan2(dx, -dy);
    angle = Math.max(-1.35, Math.min(1.35, angle));
    const normSteer = -angle / 1.35;
    setWheelAngleDeg((angle * 180) / Math.PI);
    onControlsChange({ steer: normSteer });
  };

  const updateSliderFromPointer = (clientX: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rel = ((clientX - rect.left) / rect.width) * 2 - 1; // -1 left .. +1 right
    const clamped = Math.max(-1, Math.min(1, rel));
    const steerVal = -clamped; // +1 steer left when thumb slides left
    setSliderNorm(steerVal);
    onControlsChange({ steer: steerVal });
  };

  const updateTiltBarFromPointer = (clientX: number) => {
    const el = tiltBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rel = ((clientX - rect.left) / rect.width) * 2 - 1;
    const clamped = Math.max(-1, Math.min(1, rel));
    const steerVal = -clamped;
    setTiltSteer(steerVal);
    setTiltDeg(Math.round(clamped * 28));
    onControlsChange({ steer: steerVal });
  };

  const handleToggleDrs = () => {
    const next = !drsLatched;
    setDrsLatched(next);
    onControlsChange({ drs: next });
  };

  const handleSubmitScore = async () => {
    setSubmitting(true);
    try {
      const res = await onSubmitLeaderboard();
      if (res) setSubmittedRank(res.rank);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 pointer-events-none touch-none-game">
      {/* 3D Projected Opponent Nameplates */}
      {labels.map((lbl) => (
        <div
          key={lbl.id}
          style={{
            transform: `translate3d(${lbl.x}px, ${lbl.y}px, 0) translate(-50%, -100%)`,
          }}
          className="fixed top-0 left-0 px-2 py-0.5 rounded bg-[#090b10]/85 border border-white/20 text-[11px] font-medium text-white whitespace-nowrap pointer-events-none"
        >
          <span>{lbl.name}</span>
          <span className="text-slate-400 ml-1 font-mono-nums">{lbl.distance}m</span>
        </div>
      ))}

      {/* Non-blocking Horizontal Landscape Hint on Narrow Portrait Viewports */}
      {isPortraitNarrow && !dismissedRotateHint && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold shadow-lg">
          <Smartphone className="w-4 h-4 rotate-90 shrink-0" />
          <span className="whitespace-nowrap">Rotate horizontally for comfortable thumb driving</span>
          <button
            type="button"
            onClick={() => setDismissedRotateHint(true)}
            aria-label="Dismiss rotate tip"
            className="p-0.5 rounded hover:bg-black/15"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Compact HUD Bar */}
      <div className="flex items-start justify-between gap-2.5 p-2.5 sm:p-4">
        {/* Top-Left: Position, Lap & F1 Sector Splits */}
        <div className="pointer-events-auto flex items-center gap-3 px-3 py-2 rounded-xl bg-[#0d1017]/90 border border-white/15">
          <div className="pr-2.5 border-r border-white/10">
            <div className="text-[10px] text-slate-400">Pos</div>
            <div className="font-display font-bold text-base sm:text-lg text-amber-400 font-mono-nums leading-tight">
              P{telemetry.rank}
              <span className="text-xs text-slate-400 font-normal">/{telemetry.totalRacers}</span>
            </div>
          </div>
          <div className="pr-2.5 border-r border-white/10">
            <div className="text-[10px] text-slate-400">Lap</div>
            <div className="font-display font-bold text-base sm:text-lg text-white font-mono-nums leading-tight">
              {telemetry.lap}
              <span className="text-xs text-slate-400 font-normal">/{telemetry.totalLaps}</span>
            </div>
          </div>
          <div className="font-mono-nums">
            <div className="text-xs font-bold text-white">{formatLapTime(telemetry.lapTimeMs)}</div>
            <div className="text-[10px] text-slate-400">
              Best {telemetry.bestLapMs ? formatLapTime(telemetry.bestLapMs) : '--:--.---'}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-1.5 pl-2.5 border-l border-white/10 font-mono-nums text-[10px]">
            {([0, 1, 2] as const).map((idx) => {
              const sNum = idx + 1;
              const recorded = telemetry.sectorTimesMs[idx];
              const active = telemetry.currentSector === sNum;
              return (
                <div
                  key={sNum}
                  className={`px-1.5 py-0.5 rounded border ${
                    active
                      ? 'border-amber-400/60 bg-amber-500/15 text-amber-300'
                      : recorded
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                      : 'border-white/10 text-slate-500'
                  }`}
                >
                  S{sNum} {recorded ? `${(recorded / 1000).toFixed(1)}s` : ''}
                </div>
              );
            })}
          </div>
        </div>

        {/* Top-Center: Mini-Circuit SVG Radar */}
        {minimapData && (
          <div className="flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 rounded-xl bg-[#0d1017]/85 border border-white/15 p-1 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
              <polygon
                points={minimapData.pointsAttr}
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="4.2"
                strokeLinejoin="round"
              />
              {opponents.map((opp, idx) => {
                const pt = minimapData.toSvg(opp.x, opp.z);
                return (
                  <circle
                    key={idx}
                    cx={pt.sx}
                    cy={pt.sy}
                    r="3.2"
                    fill="#38bdf8"
                  />
                );
              })}
              {(() => {
                const me = minimapData.toSvg(telemetry.positionX, telemetry.positionZ);
                return (
                  <circle
                    cx={me.sx}
                    cy={me.sy}
                    r="4.2"
                    fill={gameMode === 'f1' ? '#ef4444' : '#f59e0b'}
                    stroke="#090b10"
                    strokeWidth="1.5"
                  />
                );
              })()}
            </svg>
          </div>
        )}

        {/* Top-Right: Quick Action Strip */}
        <div className="pointer-events-auto flex items-center gap-1.5 flex-wrap justify-end">
          {replayStatus.active ? (
            <>
              <button
                type="button"
                onClick={onCycleReplayCamera}
                title="Switch Replay Camera (C)"
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#0d1017]/90 border border-sky-400/40 text-xs font-medium text-sky-200 hover:text-white min-h-[38px]"
              >
                <Camera className="w-4 h-4 text-sky-400" />
                <span>{REPLAY_CAMERA_LABEL[replayStatus.cameraMode]}</span>
              </button>

              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                className="p-2 rounded-xl bg-[#0d1017]/90 border border-white/15 text-slate-200 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
              >
                {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={onExitReplay}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-display font-bold text-slate-950 min-h-[38px]"
              >
                <X className="w-4 h-4" />
                <span>Exit Replay</span>
              </button>
            </>
          ) : (
            <>
              {replayStatus.hasBestLap && (
                <button
                  type="button"
                  onClick={onStartReplay}
                  title="Watch 30s Best Lap Replay"
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/50 text-xs font-display font-bold text-sky-200 min-h-[38px]"
                >
                  <Film className="w-4 h-4 text-sky-400" />
                  <span className="hidden sm:inline">Replay Best</span>
                </button>
              )}

              <button
                type="button"
                onClick={onCycleCamera}
                title="Switch Camera (C)"
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#0d1017]/90 border border-white/15 text-xs font-medium text-slate-200 hover:text-white min-h-[38px]"
              >
                <Camera className="w-4 h-4 text-sky-400" />
                <span className="hidden md:inline">{CAMERA_LABEL[cameraMode]}</span>
              </button>

              <button
                type="button"
                onClick={onToggleGearbox}
                className="px-2.5 py-2 rounded-xl bg-[#0d1017]/90 border border-white/15 text-xs font-mono-nums font-bold text-slate-200 hover:text-white min-h-[38px]"
              >
                {manualGearbox ? 'MAN' : 'AUTO'}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (controlScheme !== 'tilt') {
                    void requestTiltPermission();
                  }
                  onToggleTiltQuick();
                }}
                title="Phone Tilt Steering"
                className={`flex items-center gap-1 px-2.5 py-2 rounded-xl border text-xs font-medium min-h-[38px] ${
                  touchEnabled && controlScheme === 'tilt'
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-semibold'
                    : 'bg-[#0d1017]/90 border-white/15 text-slate-200 hover:text-white'
                }`}
              >
                <Compass className="w-4 h-4" />
                <span className="hidden sm:inline">Tilt</span>
              </button>

              <button
                type="button"
                onClick={onToggleTouch}
                title="Toggle Multi-Touch Controls"
                className={`flex items-center gap-1 px-2.5 py-2 rounded-xl border text-xs font-medium min-h-[38px] ${
                  touchEnabled
                    ? 'bg-amber-500 text-slate-950 border-amber-500 font-semibold'
                    : 'bg-[#0d1017]/90 border-white/15 text-slate-200'
                }`}
              >
                <Gamepad2 className="w-4 h-4" />
                <span className="hidden md:inline">Touch</span>
              </button>

              {touchEnabled && (
                <button
                  type="button"
                  onClick={onToggleControlScheme}
                  className="px-2.5 py-2 rounded-xl bg-[#0d1017]/90 border border-white/15 text-xs font-medium text-slate-200 min-h-[38px]"
                >
                  {SCHEME_LABEL[controlScheme]}
                </button>
              )}

              <button
                type="button"
                onClick={onCycleCommentaryMode}
                title="Switch Commentary Voice (EN + Siddhu Paji / Hindi / English / Off)"
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-medium min-h-[38px] ${
                  commentaryMode !== 'off'
                    ? 'bg-[#0d1017]/90 border-amber-500/40 text-amber-300'
                    : 'bg-[#0d1017]/90 border-white/15 text-slate-400'
                }`}
              >
                {commentaryMode === 'off' ? (
                  <MicOff className="w-4 h-4 text-slate-400" />
                ) : (
                  <Mic className="w-4 h-4 text-amber-400" />
                )}
                <span className="hidden lg:inline">{COMMENTARY_LABEL[commentaryMode]}</span>
              </button>

              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                className="p-2 rounded-xl bg-[#0d1017]/90 border border-white/15 text-slate-200 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
              >
                {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={onRestartRace}
                aria-label="Restart race"
                className="p-2 rounded-xl bg-[#0d1017]/90 border border-white/15 text-slate-200 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onExitToGarage}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0d1017]/90 border border-white/15 text-xs font-semibold text-white hover:bg-white/10 min-h-[38px]"
              >
                <Home className="w-4 h-4 text-amber-400" />
                <span>Garage</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Best Lap Replay Header Pill */}
      {replayStatus.active && (
        <div className="fixed top-20 sm:top-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-[#0d1017]/92 border border-sky-400/50 shadow-xl">
            <Film className="w-4 h-4 text-sky-400" />
            <span className="font-display font-bold text-xs tracking-wider text-white">
              BEST LAP REPLAY
            </span>
            {replayStatus.lapNumber !== null && (
              <span className="text-xs font-mono-nums text-amber-300">
                Lap {replayStatus.lapNumber}
              </span>
            )}
            {replayStatus.bestLapMs !== null && (
              <span className="text-xs font-mono-nums font-bold text-emerald-300">
                {formatLapTime(replayStatus.bestLapMs)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Upcoming Corner & Brake Predictor */}
      {!replayStatus.active && telemetry.upcomingTurn && telemetry.upcomingTurn !== 'straight' && !telemetry.finished && (
        <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border shadow-lg text-xs font-display font-bold tracking-wide ${
              telemetry.brakeRecommended
                ? 'bg-rose-600/95 border-rose-300 text-white'
                : 'bg-[#0d1017]/90 border-amber-400/50 text-amber-300'
            }`}
          >
            <span className="text-sm leading-none">
              {telemetry.upcomingTurn.includes('left') ? '↰' : '↱'}
            </span>
            <span>
              {telemetry.upcomingTurn === 'hairpin_left'
                ? 'HAIRPIN LEFT'
                : telemetry.upcomingTurn === 'hairpin_right'
                ? 'HAIRPIN RIGHT'
                : telemetry.upcomingTurn === 'sharp_left'
                ? 'SHARP LEFT'
                : telemetry.upcomingTurn === 'sharp_right'
                ? 'SHARP RIGHT'
                : telemetry.upcomingTurn === 'left'
                ? 'LEFT TURN'
                : 'RIGHT TURN'}
            </span>
            <span className="font-mono-nums opacity-90">{telemetry.upcomingTurnDistM ?? 80}m</span>
            {telemetry.brakeRecommended && (
              <span className="px-1.5 py-0.5 rounded bg-black/35 text-[10px] text-amber-200">
                BRAKE
              </span>
            )}
          </div>
        </div>
      )}

      {/* Live Commentary & Assistant Subtitle Ticker */}
      {commentaryCaption && (
        <div className="fixed top-26 sm:top-32 left-1/2 -translate-x-1/2 z-30 max-w-md w-[92%] sm:w-auto pointer-events-none">
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#0d1017]/92 border border-white/15 shadow-xl">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-display font-bold uppercase tracking-wider shrink-0 ${
                commentaryCaption.speaker === 'siddhu'
                  ? 'bg-amber-500 text-slate-950'
                  : commentaryCaption.speaker === 'assistant'
                  ? 'bg-emerald-400 text-slate-950'
                  : 'bg-red-600 text-white'
              }`}
            >
              {commentaryCaption.speaker === 'siddhu'
                ? 'Siddhu Paji'
                : commentaryCaption.speaker === 'assistant'
                ? 'Race Assist'
                : 'Race Radio'}
            </span>
            <span className="text-xs font-medium text-slate-100 leading-snug">
              {commentaryCaption.text}
            </span>
          </div>
        </div>
      )}

      {/* F1 5-Red-Light Starting Gantry & Synchronized Countdown */}
      {(startLightsCount !== null || countdownText) && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <div className="px-8 py-5 rounded-2xl bg-[#0d1017]/95 border border-white/15 text-center space-y-3 shadow-2xl">
            {startLightsCount !== null && (
              <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-[#05070b] border border-white/10">
                {[0, 1, 2, 3, 4].map((idx) => {
                  const lit = idx < startLightsCount;
                  return (
                    <div key={idx} className="flex flex-col gap-1.5 p-1.5 rounded-lg bg-zinc-900 border border-white/10">
                      <span
                        className={`w-5 h-5 rounded-full transition-colors ${
                          lit ? 'bg-red-500 shadow-[0_0_14px_#ef4444]' : 'bg-zinc-800'
                        }`}
                      />
                      <span
                        className={`w-5 h-5 rounded-full transition-colors ${
                          lit ? 'bg-red-500 shadow-[0_0_14px_#ef4444]' : 'bg-zinc-800'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {countdownText && (
              <div className="font-display font-bold text-4xl sm:text-6xl text-amber-400 tracking-wider">
                {countdownText}
              </div>
            )}
            {isMultiplayer && (
              <div className="text-xs text-slate-300">Synchronized Online Grid Start</div>
            )}
          </div>
        </div>
      )}

      {/* Drift Indicator */}
      {telemetry.isDrifting && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-display font-bold text-xs tracking-wide">
          DRIFT {telemetry.driftAngleDeg}°
        </div>
      )}

      {/* Speedometer, DRS & ERS/NOS Telemetry Cluster */}
      <div
        className={`fixed ${
          touchEnabled || replayStatus.active
            ? 'top-16 right-2.5 sm:right-4 w-48'
            : 'bottom-4 right-4 w-68'
        } rounded-2xl bg-[#0d1017]/90 border border-white/15 p-3 pointer-events-auto`}
      >
        <div className="flex items-baseline justify-between">
          <div>
            <span className="font-display font-bold text-3xl sm:text-4xl text-white font-mono-nums leading-none">
              {telemetry.speedKmh}
            </span>
            <span className="text-xs text-slate-400 ml-1">km/h</span>
          </div>
          <div className="flex items-center gap-2">
            {(gameMode === 'f1' || telemetry.drsAvailable || telemetry.drsActive) && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-display font-bold border ${
                  telemetry.drsActive
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : telemetry.drsAvailable
                    ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                    : 'bg-white/5 text-slate-500 border-white/10'
                }`}
              >
                DRS
              </span>
            )}
            <div className="text-right">
              <div className="text-[10px] text-slate-400">Gear</div>
              <div className="font-display font-bold text-2xl text-amber-400 font-mono-nums leading-none">
                {telemetry.gear === -1 ? 'R' : telemetry.gear === 0 ? 'N' : telemetry.gear}
              </div>
            </div>
          </div>
        </div>

        {/* RPM Tachometer Bar */}
        <div className="mt-2">
          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full transition-none ${
                rpmPercent > 88
                  ? 'bg-rose-500'
                  : rpmPercent > 70
                  ? 'bg-amber-400'
                  : 'bg-sky-400'
              }`}
              style={{ width: `${rpmPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono-nums text-slate-400 mt-1">
            <span>{telemetry.rpm} RPM</span>
            <span>
              {gameMode === 'f1' ? 'ERS' : 'NOS'} {Math.round(telemetry.nitro)}%
            </span>
          </div>
        </div>

        {/* ERS / Nitrous Bar */}
        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden mt-1">
          <div
            className="h-full bg-sky-400"
            style={{ width: `${telemetry.nitro}%` }}
          />
        </div>

        {/* Desktop Keyboard Hint */}
        {!touchEnabled && !replayStatus.active && (
          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400">
            <span>WASD · Space Drift · F: DRS</span>
            <button
              type="button"
              onClick={onHorn}
              className="text-amber-400 hover:text-amber-300 font-medium"
            >
              Shift: {gameMode === 'f1' ? 'ERS' : 'NOS'} · H: Horn
            </button>
          </div>
        )}
      </div>

      {/* Best Lap 30s Replay Transport Bar */}
      {replayStatus.active && (
        <div className="fixed bottom-3 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:w-[660px] z-30 pointer-events-auto rounded-2xl bg-[#0d1017]/94 border border-white/15 p-3 sm:px-4 sm:py-3 shadow-2xl space-y-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleReplayPlay}
              aria-label={replayStatus.playing ? 'Pause replay' : 'Play replay'}
              className="w-10 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center shrink-0"
            >
              {replayStatus.playing ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-[11px] font-mono-nums text-slate-300 mb-1">
                <span>{(replayStatus.currentMs / 1000).toFixed(1)}s</span>
                <span className="text-slate-400">
                  Final {(replayStatus.durationMs / 1000).toFixed(1)}s of Best Lap
                </span>
                <span>{(replayStatus.durationMs / 1000).toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(100, replayStatus.durationMs)}
                step={33}
                value={replayStatus.currentMs}
                onChange={(e) => onSeekReplay(Number(e.target.value))}
                aria-label="Replay timeline"
                className="w-full h-2 accent-amber-500 cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={onCycleReplaySpeed}
              className="px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 font-mono-nums font-bold text-xs text-white min-w-[48px]"
            >
              {replayStatus.speed}x
            </button>

            <button
              type="button"
              onClick={onCycleReplayCamera}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-xs font-medium text-sky-200 shrink-0"
            >
              <Camera className="w-3.5 h-3.5 text-sky-400" />
              <span>{REPLAY_CAMERA_LABEL[replayStatus.cameraMode]}</span>
            </button>
          </div>
        </div>
      )}

      {/* Horizontal Thumb-Ergonomic Multi-Touch Controls */}
      {touchEnabled && !telemetry.finished && !replayStatus.active && (
        <>
          {/* Left Thumb Zone: Steering (Pads, Smooth Thumb Slider, Wheel, or Phone Tilt) */}
          <div className="fixed bottom-3 left-3 sm:bottom-4 sm:left-4 pointer-events-auto">
            {controlScheme === 'tilt' ? (
              <div className="w-60 rounded-2xl bg-[#0d1017]/92 border border-emerald-400/40 p-3 space-y-2 shadow-2xl">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 font-display font-bold text-emerald-300">
                    <Compass className="w-3.5 h-3.5" />
                    TILT STEER
                  </span>
                  <span className="font-mono-nums text-slate-300">
                    {tiltDeg > 0 ? `+${tiltDeg}°` : `${tiltDeg}°`}
                  </span>
                </div>

                {tiltNeedsPermission ? (
                  <button
                    type="button"
                    onClick={() => void requestTiltPermission()}
                    className="w-full py-2 rounded-xl bg-emerald-500 text-slate-950 font-display font-bold text-xs"
                  >
                    Allow Tilt Sensor
                  </button>
                ) : (
                  <div
                    ref={tiltBarRef}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      tiltPointerId.current = e.pointerId;
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      updateTiltBarFromPointer(e.clientX);
                    }}
                    onPointerMove={(e) => {
                      if (tiltPointerId.current !== e.pointerId) return;
                      updateTiltBarFromPointer(e.clientX);
                    }}
                    onPointerUp={(e) => {
                      if (tiltPointerId.current !== e.pointerId) return;
                      tiltPointerId.current = null;
                      setTiltSteer(0);
                      setTiltDeg(0);
                      onControlsChange({ steer: 0 });
                    }}
                    onPointerCancel={(e) => {
                      if (tiltPointerId.current !== e.pointerId) return;
                      tiltPointerId.current = null;
                      setTiltSteer(0);
                      setTiltDeg(0);
                      onControlsChange({ steer: 0 });
                    }}
                    className="relative h-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center touch-none-game"
                  >
                    <div className="w-0.5 h-4 bg-white/30" />
                    <div
                      style={{ transform: `translateX(${-tiltSteer * 88}px)` }}
                      className="absolute w-7 h-6 rounded-lg bg-emerald-400 border border-slate-950 shadow pointer-events-none"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400">
                    {tiltSensorActive ? 'Tilt phone left / right' : 'Tilt phone or drag bar'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      tiltCenterDegRef.current = latestRawTiltDegRef.current;
                      setTiltSteer(0);
                      setTiltDeg(0);
                      onControlsChange({ steer: 0 });
                    }}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-semibold text-white"
                  >
                    Center
                  </button>
                </div>
              </div>
            ) : controlScheme === 'wheel' ? (
              <div
                ref={wheelRef}
                onPointerDown={(e) => {
                  e.preventDefault();
                  wheelPointerId.current = e.pointerId;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  updateWheelFromPointer(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (wheelPointerId.current !== e.pointerId) return;
                  updateWheelFromPointer(e.clientX, e.clientY);
                }}
                onPointerUp={(e) => {
                  if (wheelPointerId.current !== e.pointerId) return;
                  wheelPointerId.current = null;
                  setWheelAngleDeg(0);
                  onControlsChange({ steer: 0 });
                }}
                onPointerCancel={(e) => {
                  if (wheelPointerId.current !== e.pointerId) return;
                  wheelPointerId.current = null;
                  setWheelAngleDeg(0);
                  onControlsChange({ steer: 0 });
                }}
                style={{ transform: `rotate(${wheelAngleDeg}deg)` }}
                className="w-36 h-36 rounded-full border-4 border-slate-300/70 bg-[#0d1017]/85 flex items-center justify-center shadow-2xl touch-none-game"
              >
                <div className="w-full h-2 bg-slate-300/60 absolute" />
                <div className="w-2 h-1/2 bg-amber-400 absolute top-0 rounded-full" />
                <div className="w-10 h-10 rounded-full bg-[#151a24] border-2 border-amber-400 z-10 flex items-center justify-center text-[9px] font-display font-bold text-white">
                  WS
                </div>
              </div>
            ) : controlScheme === 'slider' ? (
              <div
                ref={sliderRef}
                onPointerDown={(e) => {
                  e.preventDefault();
                  sliderPointerId.current = e.pointerId;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  updateSliderFromPointer(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (sliderPointerId.current !== e.pointerId) return;
                  updateSliderFromPointer(e.clientX);
                }}
                onPointerUp={(e) => {
                  if (sliderPointerId.current !== e.pointerId) return;
                  sliderPointerId.current = null;
                  setSliderNorm(0);
                  onControlsChange({ steer: 0 });
                }}
                onPointerCancel={(e) => {
                  if (sliderPointerId.current !== e.pointerId) return;
                  sliderPointerId.current = null;
                  setSliderNorm(0);
                  onControlsChange({ steer: 0 });
                }}
                className="relative w-56 h-20 rounded-2xl bg-[#0d1017]/88 border border-white/20 flex items-center justify-between px-4 touch-none-game select-none"
              >
                <ChevronLeft className="w-6 h-6 text-slate-400 pointer-events-none" />
                <div className="absolute left-6 right-6 h-1.5 rounded-full bg-white/10 pointer-events-none" />
                <div
                  style={{
                    transform: `translateX(${-sliderNorm * 68}px)`,
                  }}
                  className="w-14 h-14 rounded-xl bg-amber-500 border-2 border-white shadow-lg flex items-center justify-center font-display font-bold text-[10px] text-slate-950 pointer-events-none z-10"
                >
                  STEER
                </div>
                <ChevronRight className="w-6 h-6 text-slate-400 pointer-events-none" />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Steer Left"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    onControlsChange({ steer: 1 });
                  }}
                  onPointerUp={() => onControlsChange({ steer: 0 })}
                  onPointerCancel={() => onControlsChange({ steer: 0 })}
                  className="w-20 h-20 rounded-2xl bg-[#0d1017]/88 active:bg-amber-500 active:text-slate-950 border border-white/20 flex items-center justify-center text-white shadow-lg"
                >
                  <ChevronLeft className="w-10 h-10" />
                </button>
                <button
                  type="button"
                  aria-label="Steer Right"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    onControlsChange({ steer: -1 });
                  }}
                  onPointerUp={() => onControlsChange({ steer: 0 })}
                  onPointerCancel={() => onControlsChange({ steer: 0 })}
                  className="w-20 h-20 rounded-2xl bg-[#0d1017]/88 active:bg-amber-500 active:text-slate-950 border border-white/20 flex items-center justify-center text-white shadow-lg"
                >
                  <ChevronRight className="w-10 h-10" />
                </button>
              </div>
            )}
          </div>

          {/* Right Thumb Zone: Ergonomic Gas, Brake, DRS, ERS/NOS, Drift & Manual Shift */}
          <div className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 pointer-events-auto flex items-end gap-2.5">
            {manualGearbox && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onShiftGear(true);
                  }}
                  className="w-12 h-12 rounded-xl bg-[#0d1017]/88 border border-white/20 font-display font-bold text-sm text-white active:bg-white/20"
                >
                  G+
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onShiftGear(false);
                  }}
                  className="w-12 h-12 rounded-xl bg-[#0d1017]/88 border border-white/20 font-display font-bold text-sm text-white active:bg-white/20"
                >
                  G-
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {(gameMode === 'f1' || telemetry.drsAvailable) && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleToggleDrs();
                  }}
                  className={`w-16 h-12 rounded-2xl border flex items-center justify-center gap-1 font-display font-bold text-xs transition-colors ${
                    telemetry.drsActive
                      ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                      : drsLatched || telemetry.drsAvailable
                      ? 'bg-amber-500/25 border-amber-400 text-amber-300'
                      : 'bg-[#0d1017]/88 border-white/20 text-slate-300'
                  }`}
                >
                  <Wind className="w-4 h-4" />
                  <span>DRS</span>
                </button>
              )}

              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  onControlsChange({ nitro: true });
                }}
                onPointerUp={() => onControlsChange({ nitro: false })}
                onPointerCancel={() => onControlsChange({ nitro: false })}
                className="w-16 h-14 rounded-2xl bg-sky-500/25 active:bg-sky-500 border border-sky-400/50 flex flex-col items-center justify-center text-sky-300 active:text-slate-950"
              >
                <Flame className="w-5 h-5" />
                <span className="text-[10px] font-bold">{gameMode === 'f1' ? 'ERS' : 'NOS'}</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  onControlsChange({ handbrake: true });
                }}
                onPointerUp={() => onControlsChange({ handbrake: false })}
                onPointerCancel={() => onControlsChange({ handbrake: false })}
                className="w-16 h-12 rounded-2xl bg-[#0d1017]/88 active:bg-amber-500 border border-white/20 text-[10px] font-bold text-slate-200 active:text-slate-950"
              >
                DRIFT
              </button>
            </div>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                onControlsChange({ brake: 1 });
              }}
              onPointerUp={() => onControlsChange({ brake: 0 })}
              onPointerCancel={() => onControlsChange({ brake: 0 })}
              className="w-20 h-24 rounded-2xl bg-rose-500/25 active:bg-rose-500 border border-rose-500/50 flex flex-col items-center justify-center text-rose-200 active:text-white font-display font-bold text-xs shadow-lg"
            >
              BRAKE
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                onControlsChange({ throttle: 1 });
              }}
              onPointerUp={() => onControlsChange({ throttle: 0 })}
              onPointerCancel={() => onControlsChange({ throttle: 0 })}
              className="w-24 h-32 rounded-2xl bg-emerald-500/25 active:bg-emerald-500 border border-emerald-400/50 flex flex-col items-center justify-center text-emerald-200 active:text-slate-950 font-display font-bold text-sm shadow-lg"
            >
              GAS
            </button>
          </div>
        </>
      )}

      {/* Post-Race Finish Modal */}
      {telemetry.finished && !replayStatus.active && (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/75 pointer-events-auto">
          <div className="w-full max-w-md rounded-2xl bg-[#0d1017] border border-white/15 p-6 text-center space-y-4 shadow-2xl">
            <Trophy className="w-10 h-10 text-amber-400 mx-auto" />
            <div>
              <h2 className="font-display font-bold text-2xl text-white">Checkered Flag</h2>
              <p className="text-sm text-slate-400 mt-1">
                Finished P{telemetry.rank} of {telemetry.totalRacers}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 py-3 border-y border-white/10 font-mono-nums">
              <div>
                <div className="text-xs text-slate-400">Best Lap</div>
                <div className="text-lg font-bold text-amber-400">
                  {telemetry.bestLapMs ? formatLapTime(telemetry.bestLapMs) : '--:--.---'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Total Race Time</div>
                <div className="text-lg font-bold text-white">
                  {formatLapTime(telemetry.totalRaceTimeMs)}
                </div>
              </div>
            </div>

            {submittedRank !== null ? (
              <div className="py-2 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs font-medium text-emerald-300">
                Lap record saved to Global Leaderboard at Rank #{submittedRank}
              </div>
            ) : (
              <button
                type="button"
                disabled={submitting || !telemetry.bestLapMs}
                onClick={handleSubmitScore}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-display font-bold text-sm"
              >
                {submitting ? 'Submitting Record...' : 'Post Best Lap to Global Leaderboard'}
              </button>
            )}

            {replayStatus.hasBestLap && (
              <button
                type="button"
                onClick={onStartReplay}
                className="w-full py-2.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/50 text-sky-200 font-display font-bold text-xs flex items-center justify-center gap-2 min-h-[42px]"
              >
                <Film className="w-4 h-4 text-sky-400" />
                <span>Watch Best Lap Replay (30s)</span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setSubmittedRank(null);
                  onRestartRace();
                }}
                className="py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white min-h-[42px]"
              >
                Race Again
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubmittedRank(null);
                  onExitToGarage();
                }}
                className="py-2.5 rounded-xl border border-white/15 hover:bg-white/5 text-xs font-semibold text-slate-200 min-h-[42px]"
              >
                Return to Garage
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
