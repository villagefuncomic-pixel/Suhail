import React, { useEffect, useState } from 'react';
import { Globe, MessageSquare, Play, Plus, RefreshCw, Users, X } from 'lucide-react';
import { TRACKS, VEHICLE_MAP } from '../data/vehicles';
import { createCustomRoom, fetchRooms } from '../services/multiplayer';
import { ChatMessage, RemotePlayerState, RoomInfo, TrackId } from '../types/game';

interface MultiplayerModalProps {
  open: boolean;
  onClose: () => void;
  playerName: string;
  onChangePlayerName: (name: string) => void;
  connected: boolean;
  currentRoomId: string | null;
  roomPlayers: RemotePlayerState[];
  chatMessages: ChatMessage[];
  onJoinRoom: (roomId: string, trackId: TrackId) => void;
  onLeaveRoom: () => void;
  onStartOnlineRace: () => void;
  onSendChat: (text: string) => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  open,
  onClose,
  playerName,
  onChangePlayerName,
  connected,
  currentRoomId,
  roomPlayers,
  chatMessages,
  onJoinRoom,
  onLeaveRoom,
  onStartOnlineRace,
  onSendChat,
}) => {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomTrack, setNewRoomTrack] = useState<TrackId>('monaco');
  const [chatText, setChatText] = useState('');

  const refreshRooms = async () => {
    setLoading(true);
    try {
      const list = await fetchRooms();
      setRooms(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      refreshRooms();
    }
  }, [open, currentRoomId]);

  if (!open) return null;

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createCustomRoom(newRoomName || 'WOW SUHAIL GP', newRoomTrack);
      setNewRoomName('');
      await refreshRooms();
      onJoinRoom(created.id, created.trackId);
    } catch {
      // ignore
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    onSendChat(chatText.trim());
    setChatText('');
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-black/75">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0d1017] border border-white/15 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="font-display font-bold text-lg text-white">Online Multiplayer</h2>
              <p className="text-xs text-slate-400">
                Real-time WebSocket F1 &amp; Casual lobbies · {connected ? 'Connected' : 'Ready to join'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close multiplayer lobby"
            className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <label htmlFor="racer-handle" className="text-xs font-medium text-slate-300">
              Driver Name
            </label>
            <input
              id="racer-handle"
              type="text"
              maxLength={22}
              value={playerName}
              onChange={(e) => onChangePlayerName(e.target.value)}
              placeholder="Suhail"
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500 min-h-[38px]"
            />
          </div>

          <button
            type="button"
            onClick={refreshRooms}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:text-white min-h-[38px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10">
          <div className="p-4 space-y-3">
            <h3 className="font-display font-semibold text-sm text-slate-200">F1 &amp; Casual Lobbies</h3>
            <div className="space-y-2 max-h-[34vh] overflow-y-auto pr-1">
              {rooms.map((room) => {
                const isJoined = currentRoomId === room.id;
                const track = TRACKS.find((t) => t.id === room.trackId);
                return (
                  <div
                    key={room.id}
                    className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border ${
                      isJoined ? 'bg-sky-500/10 border-sky-500/50' : 'bg-white/[0.03] border-white/10'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-xs sm:text-sm text-white truncate">
                        {room.name}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {track?.mode === 'f1' ? 'F1 GP' : 'Casual'} · {track?.name ?? room.trackId} ·{' '}
                        {room.playerCount}/{room.maxPlayers}
                      </div>
                    </div>
                    {isJoined ? (
                      <button
                        type="button"
                        onClick={onLeaveRoom}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white shrink-0 min-h-[36px]"
                      >
                        Leave
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onJoinRoom(room.id, room.trackId)}
                        className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold shrink-0 min-h-[36px]"
                      >
                        Join
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <form onSubmit={handleCreateRoom} className="pt-2 border-t border-white/10 space-y-2">
              <div className="text-xs font-medium text-slate-300">Host New Room</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={28}
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="Room title..."
                  className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-xs text-white focus:outline-none focus:border-amber-500 min-h-[38px]"
                />
                <select
                  value={newRoomTrack}
                  onChange={(e) => setNewRoomTrack(e.target.value as TrackId)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#161b26] border border-white/15 text-xs text-white min-h-[38px]"
                >
                  {TRACKS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.mode === 'f1' ? `[F1] ${t.name}` : t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shrink-0 min-h-[38px]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Host</span>
                </button>
              </div>
            </form>
          </div>

          <div className="p-4 flex flex-col justify-between gap-3">
            {currentRoomId ? (
              <>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Users className="w-4 h-4 text-sky-400" />
                      <span>Grid ({roomPlayers.length})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onStartOnlineRace();
                        onClose();
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs min-h-[38px]"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Lights Out Race</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {roomPlayers.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full border border-white/30"
                            style={{ backgroundColor: p.tuning?.paintColor || '#f59e0b' }}
                          />
                          <span className="font-medium text-white">{p.name}</span>
                        </div>
                        <span className="text-slate-400">
                          {VEHICLE_MAP[p.vehicleId]?.name ?? p.vehicleId}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col border-t border-white/10 pt-2.5 gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Paddock Chat</span>
                  </div>
                  <div className="h-28 overflow-y-auto rounded-lg bg-black/35 border border-white/10 p-2.5 space-y-1 text-xs">
                    {chatMessages.length === 0 ? (
                      <div className="text-slate-500">Say hello to other racers.</div>
                    ) : (
                      chatMessages.map((m) => (
                        <div key={m.id} className={m.system ? 'text-sky-400' : 'text-slate-200'}>
                          <span className="font-semibold text-amber-400">{m.sender}: </span>
                          <span>{m.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleSendChat} className="flex gap-2">
                    <input
                      type="text"
                      maxLength={120}
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      placeholder="Message room..."
                      className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-500 min-h-[36px]"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white min-h-[36px]"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4">
                <Users className="w-8 h-8 text-slate-500 mb-3" />
                <div className="font-display font-semibold text-base text-white">
                  Join an F1 or Casual Lobby
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  Pick a circuit lobby on the left to race online with synchronized 5-red-light starts and custom liveries.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
