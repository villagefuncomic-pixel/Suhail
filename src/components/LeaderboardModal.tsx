import React, { useEffect, useState } from 'react';
import { RefreshCw, Trophy, X } from 'lucide-react';
import { TRACKS } from '../data/vehicles';
import { fetchLeaderboard } from '../services/multiplayer';
import { LeaderboardEntry, TrackId, VehicleCategory } from '../types/game';

interface LeaderboardModalProps {
  open: boolean;
  onClose: () => void;
  initialTrack?: TrackId | 'all';
}

export function formatLapTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  open,
  onClose,
  initialTrack = 'all',
}) => {
  const [trackFilter, setTrackFilter] = useState<TrackId | 'all'>(initialTrack);
  const [categoryFilter, setCategoryFilter] = useState<VehicleCategory | 'all'>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeaderboard(trackFilter, categoryFilter);
      setEntries(data);
    } catch {
      setError('Unable to reach leaderboard server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, trackFilter, categoryFilter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-black/75">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl bg-[#0d1017] border border-white/15 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display font-bold text-lg text-white">Global Leaderboards</h2>
              <p className="text-xs text-slate-400">
                Verified fastest laps across Formula 1 and Street circuits
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              aria-label="Refresh leaderboard"
              className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close leaderboard"
              className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10 overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setTrackFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium min-h-[32px] whitespace-nowrap shrink-0 ${
                trackFilter === 'all' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-300'
              }`}
            >
              All Tracks
            </button>
            {TRACKS.map((tr) => (
              <button
                key={tr.id}
                type="button"
                onClick={() => setTrackFilter(tr.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium min-h-[32px] whitespace-nowrap shrink-0 ${
                  trackFilter === tr.id ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-300'
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

          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
            {(['all', 'f1', 'supercar', 'xuv', 'bike'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium min-h-[32px] whitespace-nowrap shrink-0 ${
                  categoryFilter === cat ? 'bg-white/15 text-white' : 'text-slate-400'
                }`}
              >
                {cat === 'all'
                  ? 'All'
                  : cat === 'f1'
                  ? 'F1'
                  : cat === 'supercar'
                  ? 'Supercars'
                  : cat === 'xuv'
                  ? 'XUV'
                  : 'Bike'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error ? (
            <div className="py-12 text-center text-sm text-rose-400">{error}</div>
          ) : entries.length === 0 && !loading ? (
            <div className="py-12 text-center text-sm text-slate-400">
              No lap times recorded for this filter yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[11px] text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Rank</th>
                  <th className="py-2.5 px-3 font-medium">Driver</th>
                  <th className="py-2.5 px-3 font-medium">Vehicle</th>
                  <th className="py-2.5 px-3 font-medium hidden sm:table-cell">Circuit</th>
                  <th className="py-2.5 px-3 font-medium text-right">Top Speed</th>
                  <th className="py-2.5 pl-3 font-medium text-right">Best Lap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {entries.map((entry, idx) => (
                  <tr key={entry.id} className="hover:bg-white/[0.03]">
                    <td className="py-2.5 pr-3 font-mono-nums font-bold text-slate-300">
                      {idx === 0 ? (
                        <span className="text-amber-400">01</span>
                      ) : idx === 1 ? (
                        <span className="text-slate-200">02</span>
                      ) : idx === 2 ? (
                        <span className="text-orange-400">03</span>
                      ) : (
                        String(idx + 1).padStart(2, '0')
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-white">{entry.playerName}</td>
                    <td className="py-2.5 px-3 text-slate-300">
                      <span>{entry.vehicleName}</span>
                      <span className="text-xs text-slate-500 ml-1.5">
                        · {entry.category.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 text-xs hidden sm:table-cell">
                      {TRACKS.find((t) => t.id === entry.trackId)?.name ?? entry.trackId}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-nums text-slate-300">
                      {entry.topSpeedKmh} km/h
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono-nums font-bold text-amber-400">
                      {formatLapTime(entry.bestLapMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
