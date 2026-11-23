import {
  ChatMessage,
  LeaderboardEntry,
  RemotePlayerState,
  RoomInfo,
  TrackId,
  TuningConfig,
  VehicleCategory,
  VehicleId,
} from '../types/game';

export interface MultiplayerEvents {
  onConnected?: (connected: boolean) => void;
  onRoomJoined?: (data: {
    roomId: string;
    trackId: TrackId;
    roomStatus: 'lobby' | 'countdown' | 'racing';
    playerId: string;
    slotIndex: number;
    players: RemotePlayerState[];
  }) => void;
  onPlayersUpdate?: (players: RemotePlayerState[]) => void;
  onCountdown?: (seconds: number, slotIndex: number) => void;
  onRaceGo?: () => void;
  onChatMessage?: (message: ChatMessage) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private events: MultiplayerEvents;
  private playerId: string;
  private reconnectTimer: number | null = null;
  private intentionalClose = false;
  private lastJoinPayload: {
    roomId: string;
    name: string;
    vehicleId: VehicleId;
    tuning: TuningConfig;
  } | null = null;

  constructor(events: MultiplayerEvents) {
    this.events = events;
    const saved = localStorage.getItem('wow_suhail_player_id');
    if (saved) {
      this.playerId = saved;
    } else {
      this.playerId = `racer-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem('wow_suhail_player_id', this.playerId);
    }
  }

  public getPlayerId(): string {
    return this.playerId;
  }

  public connectAndJoin(payload: {
    roomId: string;
    name: string;
    vehicleId: VehicleId;
    tuning: TuningConfig;
  }) {
    this.lastJoinPayload = payload;
    this.intentionalClose = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'room:join',
          playerId: this.playerId,
          ...payload,
        }),
      );
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.events.onConnected?.(true);
      if (this.lastJoinPayload) {
        ws.send(
          JSON.stringify({
            type: 'room:join',
            playerId: this.playerId,
            ...this.lastJoinPayload,
          }),
        );
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'room:joined') {
          this.events.onRoomJoined?.(msg);
        } else if (
          msg.type === 'room:state' ||
          msg.type === 'player:joined' ||
          msg.type === 'player:left'
        ) {
          if (Array.isArray(msg.players)) {
            this.events.onPlayersUpdate?.(msg.players);
          }
        } else if (msg.type === 'race:countdown') {
          this.events.onCountdown?.(Number(msg.seconds || 3), Number(msg.slotIndex || 0));
        } else if (msg.type === 'race:go') {
          this.events.onRaceGo?.();
        } else if (msg.type === 'chat:message' && msg.message) {
          this.events.onChatMessage?.(msg.message);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      this.events.onConnected?.(false);
      this.ws = null;
      if (!this.intentionalClose && this.lastJoinPayload) {
        this.reconnectTimer = window.setTimeout(() => {
          if (this.lastJoinPayload) this.connectAndJoin(this.lastJoinPayload);
        }, 2500);
      }
    };

    ws.onerror = () => {
      this.events.onConnected?.(false);
    };
  }

  public sendTelemetry(state: {
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
    vehicleId: VehicleId;
    tuning: TuningConfig;
    finished?: boolean;
    finishTimeMs?: number;
  }) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'player:state', ...state }));
    }
  }

  public triggerRaceStart() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'race:start' }));
    }
  }

  public sendChat(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat:send', text }));
    }
  }

  public leave() {
    this.intentionalClose = true;
    this.lastJoinPayload = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'room:leave' }));
      }
      this.ws.close();
      this.ws = null;
    }
    this.events.onConnected?.(false);
  }
}

export async function fetchRooms(): Promise<RoomInfo[]> {
  const res = await fetch('/api/rooms');
  if (!res.ok) throw new Error('Failed to load rooms');
  const data = await res.json();
  return data.rooms ?? [];
}

export async function createCustomRoom(name: string, trackId: TrackId): Promise<RoomInfo> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, trackId }),
  });
  if (!res.ok) throw new Error('Failed to create room');
  const data = await res.json();
  return data.room;
}

export async function fetchLeaderboard(
  track: TrackId | 'all' = 'all',
  category: VehicleCategory | 'all' = 'all',
): Promise<LeaderboardEntry[]> {
  const res = await fetch(
    `/api/leaderboard?track=${encodeURIComponent(track)}&category=${encodeURIComponent(category)}`,
  );
  if (!res.ok) throw new Error('Failed to load leaderboard');
  const data = await res.json();
  return data.entries ?? [];
}

export async function submitLeaderboardEntry(payload: {
  playerName: string;
  vehicleId: VehicleId;
  vehicleName: string;
  category: VehicleCategory;
  trackId: TrackId;
  bestLapMs: number;
  topSpeedKmh: number;
  ecuStage: number;
}): Promise<{ entry: LeaderboardEntry; rank: number }> {
  const res = await fetch('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to submit lap time');
  return res.json();
}
