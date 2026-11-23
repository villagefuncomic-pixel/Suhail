import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Flag,
  Gauge,
  MapPin,
  Palette,
  Sliders,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { TRACKS, VEHICLES, computeTunedStats } from '../data/vehicles';
import {
  GameMode,
  RimFinish,
  TireCompound,
  TrackDefinition,
  TrackId,
  TuningConfig,
  VehicleCategory,
  VehicleId,
} from '../types/game';

interface ShowroomDockProps {
  gameMode: GameMode;
  onChangeGameMode: (mode: GameMode) => void;
  activeTab: 'garage' | 'tuning';
  onTabChange: (tab: 'garage' | 'tuning') => void;
  selectedVehicleId: VehicleId;
  onSelectVehicle: (id: VehicleId) => void;
  selectedTrackId: TrackId;
  onSelectTrack: (id: TrackId) => void;
  tuning: TuningConfig;
  onChangeTuning: (next: TuningConfig) => void;
  onResetTuning: () => void;
  onStartDrive: () => void;
  aiRivalsEnabled: boolean;
  onToggleAiRivals: (enabled: boolean) => void;
}

const RIM_OPTIONS: { id: RimFinish; label: string; swatch: string }[] = [
  { id: 'titanium', label: 'Titanium', swatch: '#cbd5e1' },
  { id: 'forged_gold', label: 'Forged Gold', swatch: '#eab308' },
  { id: 'gloss_black', label: 'Gloss Black', swatch: '#1e293b' },
  { id: 'bronze', label: 'Matte Bronze', swatch: '#92400e' },
];

const F1_TIRE_OPTIONS: { id: TireCompound; label: string; color: string }[] = [
  { id: 'soft_f1', label: 'Pirelli Soft (C5)', color: '#ef4444' },
  { id: 'medium_f1', label: 'Pirelli Medium (C3)', color: '#eab308' },
  { id: 'hard_f1', label: 'Pirelli Hard (C1)', color: '#f8fafc' },
];

const CASUAL_TIRE_OPTIONS: { id: TireCompound; label: string }[] = [
  { id: 'street', label: 'Street Sport' },
  { id: 'semi_slick', label: 'Semi-Slick' },
  { id: 'drift', label: 'Drift Spec' },
  { id: 'all_terrain', label: 'All-Terrain' },
];

const UNDERGLOW_SWATCHES = ['#f59e0b', '#06b6d4', '#ef4444', '#10b981', '#a855f7'];

function buildTrackSvgPoints(track: TrackDefinition): { points: string; startX: number; startY: number } {
  const pts = track.controlPoints;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const size = 100;
  const pad = 14;
  const scale = (size - pad * 2) / span;
  const ox = (size - (maxX - minX) * scale) / 2;
  const oz = (size - (maxZ - minZ) * scale) / 2;

  const projected = pts.map((p) => ({
    x: (p.x - minX) * scale + ox,
    y: (p.z - minZ) * scale + oz,
  }));

  return {
    points: projected.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    startX: projected[0]?.x ?? 50,
    startY: projected[0]?.y ?? 50,
  };
}

export const ShowroomDock: React.FC<ShowroomDockProps> = ({
  gameMode,
  onChangeGameMode,
  activeTab,
  onTabChange,
  selectedVehicleId,
  onSelectVehicle,
  selectedTrackId,
  onSelectTrack,
  tuning,
  onChangeTuning,
  onResetTuning,
  onStartDrive,
  aiRivalsEnabled,
  onToggleAiRivals,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'supercar' | 'xuv' | 'bike'>('all');
  const [tuningSubTab, setTuningSubTab] = useState<'visuals' | 'power' | 'chassis'>('visuals');

  const spec = VEHICLES.find((v) => v.id === selectedVehicleId) ?? VEHICLES[0];
  const stats = computeTunedStats(spec, tuning);

  const modeVehicles = useMemo(
    () => VEHICLES.filter((v) => v.mode === gameMode),
    [gameMode],
  );
  const modeTracks = useMemo(
    () => TRACKS.filter((t) => t.mode === gameMode),
    [gameMode],
  );
  const selectedTrack = modeTracks.find((t) => t.id === selectedTrackId) ?? modeTracks[0];
  const trackSvg = useMemo(() => buildTrackSvgPoints(selectedTrack), [selectedTrack]);

  const filteredVehicles =
    gameMode === 'f1' || categoryFilter === 'all'
      ? modeVehicles
      : modeVehicles.filter((v) => v.category === categoryFilter);

  const categoryLabel = (cat: VehicleCategory) =>
    cat === 'f1' ? 'Formula 1' : cat === 'supercar' ? 'Supercar' : cat === 'xuv' ? 'XUV' : 'Superbike';

  return (
    <div className="fixed bottom-2.5 left-1/2 -translate-x-1/2 z-20 w-[min(1040px,96vw)] pointer-events-none">
      <div className="flex justify-center mb-1 pointer-events-auto">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 px-3.5 py-1 rounded-t-xl bg-[#0d1017]/95 border border-b-0 border-white/15 text-xs font-medium text-slate-300 hover:text-white transition-colors min-h-[32px]"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{collapsed ? 'Show Garage & Circuits' : 'Hide Controls'}</span>
        </button>
      </div>

      {!collapsed && (
        <div className="pointer-events-auto rounded-2xl bg-[#0d1017]/95 border border-white/15 shadow-2xl overflow-hidden">
          {/* Dock Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2 border-b border-white/10">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Mode Switcher */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
                <button
                  type="button"
                  onClick={() => onChangeGameMode('f1')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    gameMode === 'f1'
                      ? 'bg-red-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>F1 Racing</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeGameMode('casual')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    gameMode === 'casual'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Gauge className="w-3.5 h-3.5" />
                  <span>Casual Driving</span>
                </button>
              </div>

              {/* Garage / Tuning Switch */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
                <button
                  type="button"
                  onClick={() => onTabChange('garage')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    activeTab === 'garage'
                      ? 'bg-white/15 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>Garage &amp; Map</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTabChange('tuning')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    activeTab === 'tuning'
                      ? 'bg-white/15 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Tuning</span>
                </button>
              </div>
            </div>

            {/* Live Tuned Spec Summary */}
            <div className="hidden lg:flex items-center gap-3.5 text-xs text-slate-300 font-mono-nums">
              <div>
                <span className="text-slate-400">Power </span>
                <span className="text-white font-bold">{stats.hp} HP</span>
              </div>
              <span aria-hidden="true" className="text-white/20">·</span>
              <div>
                <span className="text-slate-400">Top </span>
                <span className="text-amber-400 font-bold">{stats.topSpeedKmh} km/h</span>
              </div>
              <span aria-hidden="true" className="text-white/20">·</span>
              <div>
                <span className="text-slate-400">0-100 </span>
                <span className="text-white font-bold">{stats.zeroToHundredSec}s</span>
              </div>
              <span aria-hidden="true" className="text-white/20">·</span>
              <div>
                <span className="text-slate-400">Grip </span>
                <span className="text-emerald-400 font-bold">{stats.handlingScore}/100</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onStartDrive}
              className={`px-4 py-2 rounded-xl font-display font-bold text-xs tracking-wide transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                gameMode === 'f1'
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              }`}
            >
              {gameMode === 'f1' ? 'Start Grand Prix' : 'Launch Drive'}
            </button>
          </div>

          {activeTab === 'garage' ? (
            <div className="p-3 space-y-2.5 max-h-[44vh] overflow-y-auto">
              {/* Filter + Track Selector Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {gameMode === 'casual' ? (
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
                    {(['all', 'supercar', 'xuv', 'bike'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                          categoryFilter === cat
                            ? 'bg-white/15 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {cat === 'all'
                          ? 'All'
                          : cat === 'supercar'
                          ? 'Supercars'
                          : cat === 'xuv'
                          ? 'XUVs'
                          : 'Bikes'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-300 font-medium">
                    2026 Formula 1 Official Constructors · DRS &amp; ERS Enabled
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
                    {modeTracks.map((tr) => (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => onSelectTrack(tr.id)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                          selectedTrackId === tr.id
                            ? 'bg-sky-500 text-slate-950 font-semibold'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {tr.id === 'monaco'
                          ? 'Monaco'
                          : tr.id === 'silverstone'
                          ? 'Silverstone'
                          : tr.id === 'monza'
                          ? 'Monza'
                          : tr.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleAiRivals(!aiRivalsEnabled)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                      aiRivalsEnabled
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-white/10 bg-white/5 text-slate-400'
                    }`}
                  >
                    Grid Rivals: {aiRivalsEnabled ? 'On' : 'Solo'}
                  </button>
                </div>
              </div>

              {/* Vehicles Grid + Real Track Circuit Map Card */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch">
                <div
                  className={`lg:col-span-9 grid gap-2 ${
                    gameMode === 'f1'
                      ? 'grid-cols-2 sm:grid-cols-4'
                      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5'
                  }`}
                >
                  {filteredVehicles.map((v) => {
                    const selected = v.id === selectedVehicleId;
                    const isFlagship = v.id === 'suhailll';
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onSelectVehicle(v.id)}
                        className={`text-left p-2.5 rounded-xl border transition-all min-h-[82px] flex flex-col justify-between ${
                          selected
                            ? gameMode === 'f1'
                              ? 'bg-red-500/15 border-red-500 text-white'
                              : 'bg-amber-500/15 border-amber-500 text-white'
                            : isFlagship
                            ? 'bg-amber-500/[0.06] border-amber-500/35 text-slate-200 hover:border-amber-400'
                            : 'bg-white/[0.03] border-white/10 text-slate-300 hover:border-white/25 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {v.carNumber
                              ? `${v.manufacturer.split(' ')[0]} · #${v.carNumber}`
                              : isFlagship
                              ? 'Flagship Hypercar · #1'
                              : `${categoryLabel(v.category)} · ${v.manufacturer.split(' ')[0]}`}
                          </div>
                          <div className="font-display font-bold text-sm text-white truncate mt-0.5">
                            {v.name}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono-nums text-slate-300 mt-2">
                          <span>{v.baseHp} HP</span>
                          <span className="text-amber-400 font-semibold">{v.baseTopSpeedKmh} km/h</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Circuit Map Preview Card */}
                <div className="lg:col-span-3 rounded-xl bg-white/[0.03] border border-white/10 p-2.5 flex items-center gap-3">
                  <div className="w-20 h-20 shrink-0 rounded-lg bg-[#07090d] border border-white/10 p-1">
                    <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
                      <polygon
                        points={trackSvg.points}
                        fill="none"
                        stroke={gameMode === 'f1' ? '#ef4444' : '#38bdf8'}
                        strokeWidth="4.5"
                        strokeLinejoin="round"
                      />
                      <circle
                        cx={trackSvg.startX}
                        cy={trackSvg.startY}
                        r="4.5"
                        fill="#f59e0b"
                        stroke="#07090d"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 text-[10px] text-sky-400 font-medium">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{selectedTrack.location}</span>
                    </div>
                    <div className="font-display font-bold text-xs text-white truncate mt-0.5">
                      {selectedTrack.name}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono-nums mt-1">
                      {selectedTrack.lengthKm} km · {selectedTrack.laps} Laps
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                      {selectedTrack.surfaceType}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3.5 space-y-3 max-h-[44vh] overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setTuningSubTab('visuals')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium min-h-[32px] ${
                      tuningSubTab === 'visuals' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span>Paint &amp; Stance</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTuningSubTab('power')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium min-h-[32px] ${
                      tuningSubTab === 'power' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>ECU &amp; Gearing</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTuningSubTab('chassis')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium min-h-[32px] ${
                      tuningSubTab === 'chassis' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Suspension &amp; Tires</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onResetTuning}
                  className="px-3 py-1.5 rounded-lg border border-white/15 text-xs text-slate-300 hover:text-white hover:bg-white/5 min-h-[32px]"
                >
                  Reset Stock
                </button>
              </div>

              {tuningSubTab === 'visuals' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-300">Body Livery / Paint</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {spec.paintSwatches.map((sw) => (
                        <button
                          key={sw.hex}
                          type="button"
                          title={sw.name}
                          onClick={() => onChangeTuning({ ...tuning, paintColor: sw.hex })}
                          className={`w-8 h-8 rounded-full border-2 transition-transform ${
                            tuning.paintColor.toLowerCase() === sw.hex.toLowerCase()
                              ? 'border-white scale-110'
                              : 'border-white/20 hover:scale-105'
                          }`}
                          style={{ backgroundColor: sw.hex }}
                        />
                      ))}
                      <input
                        type="color"
                        aria-label="Custom body color"
                        value={tuning.paintColor}
                        onChange={(e) => onChangeTuning({ ...tuning, paintColor: e.target.value })}
                        className="w-8 h-8 rounded-lg bg-transparent border border-white/20 cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-300">Coat &amp; Wheel Rim Finish</div>
                    <div className="flex items-center gap-1.5">
                      {(['metallic', 'pearl', 'matte'] as const).map((fin) => (
                        <button
                          key={fin}
                          type="button"
                          onClick={() => onChangeTuning({ ...tuning, paintFinish: fin })}
                          className={`px-2.5 py-1.5 rounded-lg text-xs capitalize border min-h-[32px] ${
                            tuning.paintFinish === fin
                              ? 'bg-amber-500 text-slate-950 border-amber-500 font-semibold'
                              : 'bg-white/5 border-white/10 text-slate-300'
                          }`}
                        >
                          {fin}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      {RIM_OPTIONS.map((rim) => (
                        <button
                          key={rim.id}
                          type="button"
                          onClick={() => onChangeTuning({ ...tuning, rimFinish: rim.id })}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border min-h-[30px] ${
                            tuning.rimFinish === rim.id
                              ? 'border-amber-500 bg-amber-500/15 text-white'
                              : 'border-white/10 bg-white/5 text-slate-400'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: rim.swatch }}
                          />
                          <span>{rim.label.split(' ')[0]}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-300">Chassis Underglow</span>
                      <button
                        type="button"
                        onClick={() => onChangeTuning({ ...tuning, underglow: !tuning.underglow })}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium min-h-[30px] ${
                          tuning.underglow
                            ? 'bg-sky-500 text-slate-950 font-semibold'
                            : 'bg-white/10 text-slate-300'
                        }`}
                      >
                        {tuning.underglow ? 'Enabled' : 'Off'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {UNDERGLOW_SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() =>
                            onChangeTuning({ ...tuning, underglow: true, underglowColor: hex })
                          }
                          className={`w-7 h-7 rounded-full border-2 ${
                            tuning.underglowColor === hex && tuning.underglow
                              ? 'border-white scale-110'
                              : 'border-white/20'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tuningSubTab === 'power' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-300">
                      ECU &amp; Hybrid Boost Mapping
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([0, 1, 2, 3] as const).map((stage) => (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => onChangeTuning({ ...tuning, ecuStage: stage })}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold border min-h-[38px] ${
                            tuning.ecuStage === stage
                              ? 'bg-amber-500 text-slate-950 border-amber-500'
                              : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          {stage === 0 ? 'Stock' : stage === 3 ? 'Pro Race' : `Stage ${stage}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">Final Drive Gear Ratio</span>
                      <span className="font-mono-nums text-amber-400">
                        {tuning.gearRatioBias < 40
                          ? 'Short Acceleration'
                          : tuning.gearRatioBias > 60
                          ? 'Long Top Speed'
                          : 'Balanced'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={tuning.gearRatioBias}
                      onChange={(e) =>
                        onChangeTuning({ ...tuning, gearRatioBias: Number(e.target.value) })
                      }
                      className="w-full tuning-slider"
                    />
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Acceleration</span>
                      <span>Top Speed</span>
                    </div>
                  </div>
                </div>
              )}

              {tuningSubTab === 'chassis' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">Ride Height</span>
                      <span className="font-mono-nums text-white">
                        {tuning.suspensionHeight > 0
                          ? `+${tuning.suspensionHeight} mm`
                          : `${tuning.suspensionHeight} mm`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-10}
                      max={10}
                      value={tuning.suspensionHeight}
                      onChange={(e) =>
                        onChangeTuning({ ...tuning, suspensionHeight: Number(e.target.value) })
                      }
                      className="w-full tuning-slider"
                    />
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="font-medium text-slate-300">Spring Stiffness</span>
                      <span className="font-mono-nums text-white">{tuning.suspensionStiffness}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={tuning.suspensionStiffness}
                      onChange={(e) =>
                        onChangeTuning({ ...tuning, suspensionStiffness: Number(e.target.value) })
                      }
                      className="w-full tuning-slider"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">Aero Wing Downforce</span>
                      <span className="font-mono-nums text-white">{tuning.aeroDownforce}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={tuning.aeroDownforce}
                      onChange={(e) =>
                        onChangeTuning({ ...tuning, aeroDownforce: Number(e.target.value) })
                      }
                      className="w-full tuning-slider"
                    />
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="font-medium text-slate-300">Brake Bias (Front)</span>
                      <span className="font-mono-nums text-white">{tuning.brakeBias}%</span>
                    </div>
                    <input
                      type="range"
                      min={35}
                      max={75}
                      value={tuning.brakeBias}
                      onChange={(e) =>
                        onChangeTuning({ ...tuning, brakeBias: Number(e.target.value) })
                      }
                      className="w-full tuning-slider"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-300">
                      {spec.category === 'f1' ? 'Pirelli F1 Tire Compound' : 'Tire Compound'}
                    </div>
                    {spec.category === 'f1' ? (
                      <div className="grid grid-cols-1 gap-1.5">
                        {F1_TIRE_OPTIONS.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onChangeTuning({ ...tuning, tireCompound: t.id })}
                            className={`flex items-center gap-2 py-2 px-3 rounded-lg text-xs font-medium border min-h-[36px] ${
                              tuning.tireCompound === t.id
                                ? 'bg-red-500/20 text-white border-red-500 font-semibold'
                                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                            }`}
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-black/40 shrink-0"
                              style={{ backgroundColor: t.color }}
                            />
                            <span>{t.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {CASUAL_TIRE_OPTIONS.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onChangeTuning({ ...tuning, tireCompound: t.id })}
                            className={`py-2 px-2 rounded-lg text-xs font-medium border min-h-[38px] ${
                              tuning.tireCompound === t.id
                                ? 'bg-amber-500 text-slate-950 border-amber-500 font-semibold'
                                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
