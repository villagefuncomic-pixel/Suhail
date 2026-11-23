import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IntroScreen } from './components/IntroScreen';
import { LeaderboardModal } from './components/LeaderboardModal';
import { MultiplayerModal } from './components/MultiplayerModal';
import { RaceHud } from './components/RaceHud';
import { ShowroomDock } from './components/ShowroomDock';
import {
  TRACK_MAP,
  VEHICLE_MAP,
  VEHICLES,
  createDefaultTuning,
} from './data/vehicles';
import { GameRenderer, ProjectedLabel } from './engine/GameRenderer';
import {
  MultiplayerClient,
  submitLeaderboardEntry,
} from './services/multiplayer';
import {
  CameraMode,
  ChatMessage,
  CommentaryCaption,
  CommentaryMode,
  ControlScheme,
  GameMode,
  InputControls,
  RemotePlayerState,
  ReplayStatus,
  TrackId,
  TuningConfig,
  VehicleId,
  VehicleTelemetry,
} from './types/game';

const CAMERA_ORDER: CameraMode[] = ['chase', 'far_chase', 't_cam', 'hood', 'bumper'];
const SCHEME_ORDER: ControlScheme[] = ['buttons', 'slider', 'wheel', 'tilt'];
const COMMENTARY_ORDER: CommentaryMode[] = ['mix', 'hindi', 'english', 'off'];

const INITIAL_TELEMETRY: VehicleTelemetry = {
  speedKmh: 0,
  rpm: 1000,
  maxRpm: 15000,
  gear: 1,
  throttle: 0,
  brake: 0,
  steer: 0,
  leanAngleRad: 0,
  nitro: 100,
  nitroActive: false,
  drsActive: false,
  drsAvailable: false,
  driftAngleDeg: 0,
  isDrifting: false,
  offTrack: false,
  lap: 1,
  totalLaps: 3,
  lapTimeMs: 0,
  bestLapMs: null,
  totalRaceTimeMs: 0,
  currentSector: 1,
  sectorTimesMs: [null, null, null],
  checkpointProgress: 0,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  headingRad: 0,
  rank: 1,
  totalRacers: 1,
  finished: false,
};

const INITIAL_REPLAY_STATUS: ReplayStatus = {
  active: false,
  playing: false,
  currentMs: 0,
  durationMs: 0,
  speed: 1,
  cameraMode: 'recorded',
  bestLapMs: null,
  lapNumber: null,
  hasBestLap: false,
  bufferSeconds: 0,
};

function loadSavedTunings(): Record<VehicleId, TuningConfig> {
  const base = Object.fromEntries(
    VEHICLES.map((v) => [v.id, createDefaultTuning(v.id)]),
  ) as Record<VehicleId, TuningConfig>;
  try {
    const raw = localStorage.getItem('wow_suhail_tunings_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const v of VEHICLES) {
        if (parsed[v.id]) {
          base[v.id] = { ...base[v.id], ...parsed[v.id] };
        }
      }
    }
  } catch {
    // ignore corrupted storage
  }
  return base;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);
  const f1StartTimerRef = useRef<number | null>(null);

  const [showIntro, setShowIntro] = useState(true);
  const [gameMode, setGameMode] = useState<GameMode>('f1');
  const [mode, setMode] = useState<'showroom' | 'race'>('showroom');
  const [dockTab, setDockTab] = useState<'garage' | 'tuning'>('garage');
  const [selectedVehicleId, setSelectedVehicleId] = useState<VehicleId>('ferrari_f1');
  const [selectedTrackId, setSelectedTrackId] = useState<TrackId>('monaco');
  const [tuningsMap, setTuningsMap] = useState<Record<VehicleId, TuningConfig>>(loadSavedTunings);

  const [playerName, setPlayerName] = useState<string>(
    () => localStorage.getItem('wow_suhail_name') || 'Suhail',
  );
  const [aiRivalsEnabled, setAiRivalsEnabled] = useState(true);

  const [showMultiplayer, setShowMultiplayer] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Multiplayer state
  const [mpConnected, setMpConnected] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<RemotePlayerState[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [countdownText, setCountdownText] = useState<string | null>(null);
  const [startLightsCount, setStartLightsCount] = useState<number | null>(null);

  // Race HUD state
  const [telemetry, setTelemetry] = useState<VehicleTelemetry>(INITIAL_TELEMETRY);
  const [labels, setLabels] = useState<ProjectedLabel[]>([]);
  const [minimapPoints, setMinimapPoints] = useState<{ x: number; z: number }[]>([]);
  const [opponents, setOpponents] = useState<{ x: number; z: number; name: string }[]>([]);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [muted, setMuted] = useState(false);
  const [manualGearbox, setManualGearbox] = useState(false);
  const [touchEnabled, setTouchEnabled] = useState<boolean>(
    () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
  );
  const [controlScheme, setControlScheme] = useState<ControlScheme>('buttons');
  const [commentaryMode, setCommentaryMode] = useState<CommentaryMode>('mix');
  const [commentaryCaption, setCommentaryCaption] = useState<CommentaryCaption | null>(null);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>(INITIAL_REPLAY_STATUS);
  const [contextLost, setContextLost] = useState(false);
  const [lapBanner, setLapBanner] = useState<string | null>(null);

  const peakSpeedRef = useRef(0);
  const keysPressedRef = useRef(new Set<string>());
  const drsKeyToggleRef = useRef(false);
  const touchControlsRef = useRef<InputControls>({
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
    drs: false,
    horn: false,
  });

  // Refs for latest state inside callbacks
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const gameModeRef = useRef(gameMode);
  gameModeRef.current = gameMode;
  const selectedVehicleRef = useRef(selectedVehicleId);
  selectedVehicleRef.current = selectedVehicleId;
  const selectedTrackRef = useRef(selectedTrackId);
  selectedTrackRef.current = selectedTrackId;
  const currentTuning = tuningsMap[selectedVehicleId];
  const currentTuningRef = useRef(currentTuning);
  currentTuningRef.current = currentTuning;
  const currentRoomRef = useRef(currentRoomId);
  currentRoomRef.current = currentRoomId;

  const clearF1StartTimer = () => {
    if (f1StartTimerRef.current !== null) {
      window.clearInterval(f1StartTimerRef.current);
      f1StartTimerRef.current = null;
    }
  };

  const pushMergedControls = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    const keys = keysPressedRef.current;
    const t = touchControlsRef.current;

    const kThrottle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
    const kBrake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
    const kLeft = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
    const kRight = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
    const kSteer = kLeft - kRight;
    const kHandbrake = keys.has('Space');
    const kNitro = keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyN');

    if (kBrake > 0.1) {
      drsKeyToggleRef.current = false;
    }

    r.setControls({
      throttle: Math.max(kThrottle, t.throttle),
      brake: Math.max(kBrake, t.brake),
      steer: kSteer !== 0 ? kSteer : t.steer,
      handbrake: kHandbrake || t.handbrake,
      nitro: kNitro || t.nitro,
      drs: drsKeyToggleRef.current || t.drs,
      horn: t.horn,
    });
  }, []);

  // Initialize Three.js GameRenderer & MultiplayerClient once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const gr = new GameRenderer(
      container,
      selectedVehicleRef.current,
      selectedTrackRef.current,
      currentTuningRef.current,
      {
        onTelemetry: (tel) => {
          setTelemetry(tel);
          if (tel.speedKmh > peakSpeedRef.current) {
            peakSpeedRef.current = tel.speedKmh;
          }
          if (rendererRef.current) {
            setOpponents(rendererRef.current.getOpponentPositions());
          }
          if (currentRoomRef.current && mpClientRef.current) {
            mpClientRef.current.sendTelemetry({
              x: tel.positionX,
              y: tel.positionY,
              z: tel.positionZ,
              heading: tel.headingRad,
              speedKmh: tel.speedKmh,
              steer: tel.steer,
              leanAngle: tel.leanAngleRad,
              nitroActive: tel.nitroActive,
              drsActive: tel.drsActive,
              braking: tel.brake > 0.1,
              lap: tel.lap,
              progress: tel.checkpointProgress,
              vehicleId: selectedVehicleRef.current,
              tuning: currentTuningRef.current,
              finished: tel.finished,
              finishTimeMs: tel.totalRaceTimeMs,
            });
          }
        },
        onLabelsUpdate: (lbls) => setLabels(lbls),
        onLapComplete: (lapMs, lapNum, finished) => {
          const mins = Math.floor(lapMs / 60000);
          const secs = ((lapMs % 60000) / 1000).toFixed(2).padStart(5, '0');
          setLapBanner(
            finished
              ? `Checkered Flag! Best Lap ${mins}:${secs}`
              : `Lap ${lapNum} · ${mins}:${secs}`,
          );
          setTimeout(() => setLapBanner(null), 3200);
        },
        onCommentaryCaption: (cap) => setCommentaryCaption(cap),
        onReplayStatus: (status) => setReplayStatus(status),
        onContextLost: (lost) => setContextLost(lost),
      },
    );
    rendererRef.current = gr;
    void gr.audio.preloadVoice('intro_welcome_boss_casual');

    const mp = new MultiplayerClient({
      onConnected: (conn) => setMpConnected(conn),
      onRoomJoined: (data) => {
        setCurrentRoomId(data.roomId);
        const tr = TRACK_MAP[data.trackId];
        if (tr) {
          setGameMode(tr.mode);
          if (VEHICLE_MAP[selectedVehicleRef.current].mode !== tr.mode) {
            const fallbackVeh = tr.mode === 'f1' ? 'ferrari_f1' : 'suhailll';
            setSelectedVehicleId(fallbackVeh);
            gr.setVehicle(fallbackVeh, tuningsMap[fallbackVeh]);
          }
        }
        setSelectedTrackId(data.trackId);
        setRoomPlayers(data.players);
        gr.syncRemotePlayers(data.players, data.playerId);
      },
      onPlayersUpdate: (players) => {
        setRoomPlayers(players);
        gr.syncRemotePlayers(players, mp.getPlayerId());
      },
      onCountdown: (seconds, slotIndex) => {
        clearF1StartTimer();
        setShowIntro(false);
        setShowMultiplayer(false);
        setMode('race');
        peakSpeedRef.current = 0;
        gr.setupRaceMode(selectedTrackRef.current, slotIndex);
        gr.setRaceFrozen(true);
        setMinimapPoints(gr.getMinimapPoints());

        const isF1 = TRACK_MAP[selectedTrackRef.current].mode === 'f1';
        let elapsedLights = isF1 ? 1 : 0;
        let rem = seconds;
        setCountdownText(isF1 ? null : String(rem));
        setStartLightsCount(isF1 ? 1 : null);
        gr.setStartLights(isF1 ? 1 : 0);
        gr.audio.playCountdownBeep(false);

        f1StartTimerRef.current = window.setInterval(() => {
          rem -= 1;
          elapsedLights = Math.min(5, elapsedLights + 1);
          if (rem > 0) {
            if (isF1) {
              setStartLightsCount(elapsedLights);
              gr.setStartLights(elapsedLights);
            } else {
              setCountdownText(String(rem));
            }
            gr.audio.playCountdownBeep(false);
          } else {
            clearF1StartTimer();
          }
        }, 1000);
      },
      onRaceGo: () => {
        clearF1StartTimer();
        gr.setRaceFrozen(false);
        gr.setStartLights(0);
        setStartLightsCount(null);
        gr.audio.playCountdownBeep(true);
        setCountdownText('LIGHTS OUT!');
        setTimeout(() => setCountdownText(null), 950);
      },
      onChatMessage: (msg) => {
        setChatMessages((prev) => [...prev.slice(-40), msg]);
      },
    });
    mpClientRef.current = mp;

    return () => {
      clearF1StartTimer();
      mp.leave();
      gr.dispose();
      rendererRef.current = null;
      mpClientRef.current = null;
    };
  }, []);

  // Keyboard listener for Race Mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (modeRef.current !== 'race') return;
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)
      ) {
        e.preventDefault();
      }
      if (!keysPressedRef.current.has(e.code)) {
        keysPressedRef.current.add(e.code);
        const isReplaying = Boolean(rendererRef.current?.getReplayStatus().active);
        if (isReplaying) {
          if (e.code === 'Space') {
            rendererRef.current?.toggleReplayPlay();
          } else if (e.code === 'KeyC') {
            rendererRef.current?.cycleReplayCamera();
          } else if (e.code === 'Escape') {
            rendererRef.current?.exitReplay();
          }
          return;
        }
        if (e.code === 'KeyC') {
          setCameraMode((prev) => {
            const next = CAMERA_ORDER[(CAMERA_ORDER.indexOf(prev) + 1) % CAMERA_ORDER.length];
            rendererRef.current?.setCameraMode(next);
            return next;
          });
        } else if (e.code === 'KeyF') {
          drsKeyToggleRef.current = !drsKeyToggleRef.current;
        } else if (e.code === 'KeyH') {
          rendererRef.current?.audio.playHorn();
        } else if (e.code === 'KeyE' || e.code === 'BracketRight') {
          rendererRef.current?.shiftGear(true);
        } else if (e.code === 'KeyQ' || e.code === 'BracketLeft') {
          rendererRef.current?.shiftGear(false);
        }
      }
      pushMergedControls();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysPressedRef.current.delete(e.code);
      pushMergedControls();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pushMergedControls]);

  const handleChangeGameMode = (nextMode: GameMode) => {
    setGameMode(nextMode);
    const nextVeh =
      nextMode === 'f1'
        ? VEHICLE_MAP[selectedVehicleId].mode === 'f1'
          ? selectedVehicleId
          : 'ferrari_f1'
        : VEHICLE_MAP[selectedVehicleId].mode === 'casual'
        ? selectedVehicleId
        : 'suhailll';
    const nextTrack =
      nextMode === 'f1'
        ? TRACK_MAP[selectedTrackId].mode === 'f1'
          ? selectedTrackId
          : 'monaco'
        : TRACK_MAP[selectedTrackId].mode === 'casual'
        ? selectedTrackId
        : 'coastal';

    setSelectedVehicleId(nextVeh);
    setSelectedTrackId(nextTrack);
    rendererRef.current?.setVehicle(nextVeh, tuningsMap[nextVeh]);
    rendererRef.current?.setTrack(nextTrack);
  };

  const handleEnterFromIntro = (chosenMode: GameMode) => {
    setShowIntro(false);
    handleChangeGameMode(chosenMode);
  };

  const handleSelectVehicle = (id: VehicleId) => {
    setSelectedVehicleId(id);
    const tuning = tuningsMap[id];
    rendererRef.current?.setVehicle(id, tuning);
  };

  const handleChangeTuning = (next: TuningConfig) => {
    setTuningsMap((prev) => {
      const updated = { ...prev, [selectedVehicleId]: next };
      try {
        localStorage.setItem('wow_suhail_tunings_v2', JSON.stringify(updated));
      } catch {
        // ignore quota errors
      }
      return updated;
    });
    rendererRef.current?.updateTuning(next);
  };

  const handleResetTuning = () => {
    handleChangeTuning(createDefaultTuning(selectedVehicleId));
  };

  const handleSelectTrack = (id: TrackId) => {
    setSelectedTrackId(id);
    rendererRef.current?.setTrack(id);
  };

  const startDrive = () => {
    clearF1StartTimer();
    drsKeyToggleRef.current = false;
    setReplayStatus(INITIAL_REPLAY_STATUS);
    setMode('race');
    peakSpeedRef.current = 0;
    rendererRef.current?.setAiRivalsEnabled(aiRivalsEnabled);
    rendererRef.current?.setupRaceMode(selectedTrackId, 0);
    setMinimapPoints(rendererRef.current?.getMinimapPoints() ?? []);

    if (gameMode === 'f1') {
      // Authentic 5-Red-Light F1 Grand Prix Standing Start
      rendererRef.current?.setRaceFrozen(true);
      let lights = 1;
      setStartLightsCount(1);
      setCountdownText(null);
      rendererRef.current?.setStartLights(1);
      rendererRef.current?.audio.playCountdownBeep(false);

      f1StartTimerRef.current = window.setInterval(() => {
        lights += 1;
        if (lights <= 5) {
          setStartLightsCount(lights);
          rendererRef.current?.setStartLights(lights);
          rendererRef.current?.audio.playCountdownBeep(false);
        } else {
          clearF1StartTimer();
          setStartLightsCount(null);
          rendererRef.current?.setStartLights(0);
          rendererRef.current?.setRaceFrozen(false);
          rendererRef.current?.audio.playCountdownBeep(true);
          setCountdownText('LIGHTS OUT!');
          setTimeout(() => setCountdownText(null), 950);
        }
      }, 650);
    } else {
      setStartLightsCount(null);
      setCountdownText(null);
      rendererRef.current?.setStartLights(0);
      rendererRef.current?.setRaceFrozen(false);
    }
  };

  const exitToGarage = () => {
    clearF1StartTimer();
    keysPressedRef.current.clear();
    drsKeyToggleRef.current = false;
    touchControlsRef.current = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      nitro: false,
      drs: false,
      horn: false,
    };
    pushMergedControls();
    setCountdownText(null);
    setStartLightsCount(null);
    setCommentaryCaption(null);
    setReplayStatus(INITIAL_REPLAY_STATUS);
    setMode('showroom');
    rendererRef.current?.setupShowroomMode();
  };

  const handleControlsChange = useCallback(
    (patch: Partial<InputControls>) => {
      touchControlsRef.current = { ...touchControlsRef.current, ...patch };
      pushMergedControls();
    },
    [pushMergedControls],
  );

  const handleToggleMute = () => {
    setMuted((m) => {
      const next = !m;
      rendererRef.current?.audio.setMuted(next);
      return next;
    });
  };

  const handleChangePlayerName = (name: string) => {
    setPlayerName(name);
    localStorage.setItem('wow_suhail_name', name);
  };

  const handleJoinRoom = (roomId: string, trackId: TrackId) => {
    const tr = TRACK_MAP[trackId];
    if (tr && tr.mode !== gameMode) {
      handleChangeGameMode(tr.mode);
    }
    setSelectedTrackId(trackId);
    mpClientRef.current?.connectAndJoin({
      roomId,
      name: playerName.trim() || 'Suhail',
      vehicleId: selectedVehicleRef.current,
      tuning: currentTuningRef.current,
    });
  };

  const handleLeaveRoom = () => {
    mpClientRef.current?.leave();
    setCurrentRoomId(null);
    setRoomPlayers([]);
    rendererRef.current?.syncRemotePlayers([], '');
  };

  const handleSubmitLeaderboard = async () => {
    if (!telemetry.bestLapMs) return null;
    const spec = VEHICLE_MAP[selectedVehicleId];
    return submitLeaderboardEntry({
      playerName: playerName.trim() || 'Suhail',
      vehicleId: selectedVehicleId,
      vehicleName: spec.name,
      category: spec.category,
      trackId: selectedTrackId,
      bestLapMs: telemetry.bestLapMs,
      topSpeedKmh: Math.max(telemetry.speedKmh, peakSpeedRef.current),
      ecuStage: currentTuning.ecuStage,
    });
  };

  const currentSpec = VEHICLE_MAP[selectedVehicleId];
  const currentTrack = TRACK_MAP[selectedTrackId];

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-[#090b10]">
      {/* Dedicated WebGL Mount Container */}
      <div ref={canvasMountRef} className="fixed inset-0 w-full h-full z-0" />

      {/* First Launch Intro Screen with Starboy BGM + Devil's Pitch "Welcome Boss" */}
      {showIntro && (
        <IntroScreen
          onEnter={handleEnterFromIntro}
          onPlayIntroAudio={(force) => {
            void rendererRef.current?.audio.playIntroVoice(force);
          }}
          onStopIntroBgm={() => rendererRef.current?.audio.stopIntroBgm()}
        />
      )}

      {/* Context Lost Recovery Banner */}
      {contextLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 text-center">
          <div className="max-w-sm rounded-2xl bg-[#0d1017] border border-white/15 p-6">
            <h2 className="font-display font-bold text-lg text-white">Restoring 3D Viewport</h2>
            <p className="text-xs text-slate-400 mt-2">
              Graphics context was paused by the browser. Tap reload if it does not resume automatically.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-semibold text-xs"
            >
              Reload Simulator
            </button>
          </div>
        </div>
      )}

      {/* Showroom UI Mode */}
      {!showIntro && mode === 'showroom' && (
        <>
          <header className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-8 py-3 bg-[#090b10]/88 border-b border-white/10">
            <button
              type="button"
              onClick={() => setShowIntro(true)}
              className="font-display font-bold text-lg sm:text-xl tracking-wider text-white whitespace-nowrap shrink-0 hover:text-amber-400 transition-colors"
            >
              WOW SUHAIL
            </button>

            <nav className="flex items-center gap-4 sm:gap-7 text-xs sm:text-sm font-medium text-slate-300 overflow-x-auto">
              <button
                type="button"
                onClick={() => setDockTab('garage')}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  dockTab === 'garage'
                    ? 'border-amber-500 text-white'
                    : 'border-transparent hover:text-white'
                }`}
              >
                Garage
              </button>
              <button
                type="button"
                onClick={() => setDockTab('tuning')}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  dockTab === 'tuning'
                    ? 'border-amber-500 text-white'
                    : 'border-transparent hover:text-white'
                }`}
              >
                Tuning
              </button>
              <button
                type="button"
                onClick={() => setShowMultiplayer(true)}
                className="py-1 border-b-2 border-transparent hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                Multiplayer{currentRoomId ? ` (${roomPlayers.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setShowLeaderboard(true)}
                className="py-1 border-b-2 border-transparent hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                Leaderboard
              </button>
            </nav>

            <button
              type="button"
              onClick={startDrive}
              className={`px-4 py-2 rounded-xl font-display font-bold text-xs sm:text-sm whitespace-nowrap shrink-0 min-h-[38px] ${
                gameMode === 'f1'
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              }`}
            >
              {gameMode === 'f1' ? 'Race Grand Prix' : 'Drive Now'}
            </button>
          </header>

          {/* Compact Vehicle & Circuit Callout */}
          <div className="fixed top-16 left-4 sm:left-8 z-10 max-w-xs sm:max-w-sm pointer-events-none">
            <div className="text-xs text-amber-400 font-medium">
              {currentSpec.manufacturer} · {currentSpec.year} · {currentSpec.engineLabel}
            </div>
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-white mt-0.5 leading-tight">
              {currentSpec.name}
            </h1>
            <p className="hidden sm:block text-xs text-slate-300 mt-1 leading-relaxed">
              {currentSpec.description}
            </p>
            <div className="text-[11px] text-slate-400 mt-1.5">
              Circuit: <span className="text-slate-200 font-medium">{currentTrack.name}</span> · {currentTrack.lengthKm} km
            </div>
          </div>

          <ShowroomDock
            gameMode={gameMode}
            onChangeGameMode={handleChangeGameMode}
            activeTab={dockTab}
            onTabChange={setDockTab}
            selectedVehicleId={selectedVehicleId}
            onSelectVehicle={handleSelectVehicle}
            selectedTrackId={selectedTrackId}
            onSelectTrack={handleSelectTrack}
            tuning={currentTuning}
            onChangeTuning={handleChangeTuning}
            onResetTuning={handleResetTuning}
            onStartDrive={startDrive}
            aiRivalsEnabled={aiRivalsEnabled}
            onToggleAiRivals={(v) => {
              setAiRivalsEnabled(v);
              rendererRef.current?.setAiRivalsEnabled(v);
            }}
          />
        </>
      )}

      {/* Active Driving HUD */}
      {!showIntro && mode === 'race' && (
        <>
          <RaceHud
            gameMode={gameMode}
            telemetry={telemetry}
            labels={labels}
            minimapPoints={minimapPoints}
            opponents={opponents}
            cameraMode={cameraMode}
            onCycleCamera={() => {
              setCameraMode((prev) => {
                const next = CAMERA_ORDER[(CAMERA_ORDER.indexOf(prev) + 1) % CAMERA_ORDER.length];
                rendererRef.current?.setCameraMode(next);
                return next;
              });
            }}
            muted={muted}
            onToggleMute={handleToggleMute}
            commentaryMode={commentaryMode}
            onCycleCommentaryMode={() => {
              setCommentaryMode((prev) => {
                const next =
                  COMMENTARY_ORDER[(COMMENTARY_ORDER.indexOf(prev) + 1) % COMMENTARY_ORDER.length];
                rendererRef.current?.commentary.setMode(next);
                return next;
              });
            }}
            commentaryCaption={commentaryCaption}
            manualGearbox={manualGearbox}
            onToggleGearbox={() => {
              setManualGearbox((g) => {
                const next = !g;
                rendererRef.current?.setManualTransmission(next);
                return next;
              });
            }}
            onShiftGear={(up) => rendererRef.current?.shiftGear(up)}
            onHorn={() => rendererRef.current?.audio.playHorn()}
            onExitToGarage={exitToGarage}
            onRestartRace={startDrive}
            countdownText={countdownText}
            startLightsCount={startLightsCount}
            touchEnabled={touchEnabled}
            onToggleTouch={() => setTouchEnabled((t) => !t)}
            controlScheme={controlScheme}
            onToggleControlScheme={() =>
              setControlScheme((s) => SCHEME_ORDER[(SCHEME_ORDER.indexOf(s) + 1) % SCHEME_ORDER.length])
            }
            onToggleTiltQuick={() => {
              if (touchEnabled && controlScheme === 'tilt') {
                setControlScheme('buttons');
              } else {
                setTouchEnabled(true);
                setControlScheme('tilt');
              }
            }}
            onControlsChange={handleControlsChange}
            onSubmitLeaderboard={handleSubmitLeaderboard}
            isMultiplayer={Boolean(currentRoomId)}
            replayStatus={replayStatus}
            onStartReplay={() => {
              rendererRef.current?.startBestLapReplay();
            }}
            onExitReplay={() => rendererRef.current?.exitReplay()}
            onToggleReplayPlay={() => rendererRef.current?.toggleReplayPlay()}
            onSeekReplay={(ms) => rendererRef.current?.seekReplay(ms)}
            onCycleReplaySpeed={() => rendererRef.current?.cycleReplaySpeed()}
            onCycleReplayCamera={() => rendererRef.current?.cycleReplayCamera()}
          />

          {lapBanner && (
            <div className="fixed top-24 left-1/2 -translate-x-1/2 z-30 px-5 py-2.5 rounded-xl bg-[#0d1017]/95 border border-amber-500/50 font-display font-bold text-sm text-amber-400 shadow-xl">
              {lapBanner}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <MultiplayerModal
        open={showMultiplayer}
        onClose={() => setShowMultiplayer(false)}
        playerName={playerName}
        onChangePlayerName={handleChangePlayerName}
        connected={mpConnected}
        currentRoomId={currentRoomId}
        roomPlayers={roomPlayers}
        chatMessages={chatMessages}
        onJoinRoom={handleJoinRoom}
        onLeaveRoom={handleLeaveRoom}
        onStartOnlineRace={() => mpClientRef.current?.triggerRaceStart()}
        onSendChat={(txt) => mpClientRef.current?.sendChat(txt)}
      />

      <LeaderboardModal
        open={showLeaderboard}
        onClose={() => setShowLeaderboard(false)}
        initialTrack={selectedTrackId}
      />
    </div>
  );
}
