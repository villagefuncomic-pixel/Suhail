import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import type {
  ChatMessage,
  GameMode,
  LeaderboardEntry,
  RemotePlayerState,
  RoomInfo,
  TrackId,
} from './src/types/game.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const VOICE_CACHE_DIR = path.join(DATA_DIR, 'voice-cache');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(VOICE_CACHE_DIR)) {
  fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
}

interface VoicePromptSpec {
  text: string;
  style: string;
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
}

const VOICE_CATALOG: Record<string, VoicePromptSpec> = {
  intro_welcome_boss_casual: {
    text: "Welcome, Boss! Everything's warmed up and ready — let's hit the track!",
    style:
      'Casual, cool, relaxed friendly male voice, natural conversational warmth and laid-back confidence',
    voiceName: 'Charon',
  },
  // Male English Race Commentary
  en_start: {
    text: 'Lights out and away we go! An absolute rocket launch off the grid!',
    style:
      'Excited male British Formula 1 TV commentator, energetic motorsport broadcast, crisp and fast-paced',
    voiceName: 'Fenrir',
  },
  en_speed: {
    text: 'Flat out down the straight! Look at that pace with DRS wide open!',
    style:
      'Excited male British Formula 1 TV commentator, thrilling high-speed call, intense broadcast energy',
    voiceName: 'Fenrir',
  },
  en_corner: {
    text: 'Surgical precision through the apex! Carrying blistering momentum on the exit!',
    style:
      'Authoritative male motorsport race commentator, articulate, sharp excitement',
    voiceName: 'Charon',
  },
  en_p1: {
    text: 'Into P1! A clinical move to seize the lead of this Grand Prix!',
    style:
      'Excited male British Formula 1 TV commentator, dramatic overtake call, booming enthusiasm',
    voiceName: 'Fenrir',
  },
  en_lap: {
    text: 'Across the line! Setting purple sectors and pushing the car to its absolute limit!',
    style:
      'Excited male British Formula 1 TV commentator, crisp lap-record broadcast delivery',
    voiceName: 'Fenrir',
  },
  en_wall_hit: {
    text: 'Ooh, heavy contact with the barrier! Watch your entry speed and get back on the racing line!',
    style:
      'Alert male motorsport race commentator reacting to a sudden wall impact, urgent and clear',
    voiceName: 'Charon',
  },
  en_finish: {
    text: 'Chequered flag! A masterclass behind the wheel, what a sensational drive!',
    style:
      'Triumphant male Formula 1 TV commentator, celebratory Grand Prix finish call',
    voiceName: 'Fenrir',
  },
  // Racing Assistant / Race Engineer Live Instructions
  assist_left: {
    text: 'Sharp left corner ahead — brake early and clip the inside apex!',
    style:
      'Crisp, calm Formula 1 race engineer / co-driver assistant over team radio, clear tactical guidance',
    voiceName: 'Kore',
  },
  assist_right: {
    text: 'Tight right turn coming up — get on the brakes and turn in smooth!',
    style:
      'Crisp, calm Formula 1 race engineer / co-driver assistant over team radio, clear tactical guidance',
    voiceName: 'Kore',
  },
  assist_brake: {
    text: 'Heavy braking zone ahead — scrub speed now before the hairpin!',
    style:
      'Focused Formula 1 race engineer / co-driver assistant over team radio, urgent but composed',
    voiceName: 'Kore',
  },
  assist_straight: {
    text: 'Clear straight ahead — full throttle, push flat out now!',
    style:
      'Focused Formula 1 race engineer / co-driver assistant over team radio, encouraging',
    voiceName: 'Kore',
  },
  // Hindi Voice Artist — Siddhu Paji Style (F1 Mode, Mix & High Acceleration)
  hi_start: {
    text: 'Wah Guru! Maza aa gaya! Kya zabardast start liya hai, thoko taali!',
    style:
      'Boisterous, charismatic Indian Punjabi-Hindi sports commentator in Navjot Singh Sidhu style, joyful booming voice, poetic energy and excitement',
    voiceName: 'Puck',
  },
  hi_high_accel: {
    text: 'Wah Guru! Kya rocket jaisi acceleration hai! Maza aa gaya, thoko taali!',
    style:
      'Boisterous, thrilled Indian Punjabi-Hindi commentator in Navjot Singh Sidhu style, amazed by explosive acceleration',
    voiceName: 'Puck',
  },
  hi_high_accel_2: {
    text: 'Oye hoye hoye! Full throttle pe toh gaadi hawa mein udne lagi Guru! Kya pick-up hai!',
    style:
      'Energetic Indian Hindi sports commentator in Navjot Singh Sidhu style, dramatic joyful exclamation',
    voiceName: 'Puck',
  },
  hi_speed: {
    text: 'Oye hoye hoye! Yeh gaadi nahi, bijli ka toofan hai Guru! Hawa se baatein ho rahi hain!',
    style:
      'Energetic Indian Hindi sports commentator in Navjot Singh Sidhu style, dramatic flair, booming joyful delivery',
    voiceName: 'Puck',
  },
  hi_drs: {
    text: 'DRS khul gaya aur sher ki tarah nikal gaye! Wah Guru, dil bagh-bagh kar diya!',
    style:
      'Enthusiastic Indian Hindi commentator in Navjot Singh Sidhu style, celebratory, witty and punchy',
    voiceName: 'Puck',
  },
  hi_corner: {
    text: 'Kya baat hai Guru! Corner pe aisi pakad dekh ke maza aa gaya, wah bhai wah!',
    style:
      'Charismatic Indian Hindi commentator in Navjot Singh Sidhu style, appreciative and animated',
    voiceName: 'Puck',
  },
  hi_p1: {
    text: 'Number one pe kabza ho gaya Guru! Chha gaye, aaj toh sabki chhutti kar di, thoko taali!',
    style:
      'Triumphant Indian Hindi commentator in Navjot Singh Sidhu style, loud cheerful excitement',
    voiceName: 'Puck',
  },
  hi_lap: {
    text: 'Ek aur shandaar lap poora! Wah Guru maza aa gaya, yeh raftaar dekh ke taali bajti hai!',
    style:
      'Boisterous Indian Hindi sports commentator in Navjot Singh Sidhu style, rhythmic celebratory tone',
    voiceName: 'Puck',
  },
  hi_wall_hit: {
    text: 'Arre deewar se takkar ho gayi Guru! Brake maaro, sambhal ke track pe wapas aao!',
    style:
      'Animated Indian Hindi commentator in Navjot Singh Sidhu style, urgent playful reaction to hitting the barrier',
    voiceName: 'Puck',
  },
  hi_finish: {
    text: 'Chequered flag lehra gaya Guru! Jeet ka jashn manao, wah guru maza aa gaya!',
    style:
      'Overjoyed Indian Hindi sports commentator in Navjot Singh Sidhu style, grand victory celebration',
    voiceName: 'Puck',
  },
};

const voiceMemoryCache = new Map<string, Buffer>();
const voicePendingCache = new Map<string, Promise<Buffer>>();

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

async function getOrGenerateVoiceWav(key: string): Promise<Buffer> {
  const mem = voiceMemoryCache.get(key);
  if (mem) return mem;

  const diskPath = path.join(VOICE_CACHE_DIR, `${key}.wav`);
  if (fs.existsSync(diskPath)) {
    const buf = fs.readFileSync(diskPath);
    if (buf.length > 44) {
      voiceMemoryCache.set(key, buf);
      return buf;
    }
  }

  const inflight = voicePendingCache.get(key);
  if (inflight) return inflight;

  const spec = VOICE_CATALOG[key];
  if (!spec) {
    throw new Error('Unknown voice key');
  }

  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  const promise = (async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: spec.text,
              speechMetadata: {
                style: spec.style,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: spec.voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('Empty audio response from Gemini TTS');
    }
    const wavBuffer = Buffer.from(base64Audio, 'base64');
    voiceMemoryCache.set(key, wavBuffer);
    try {
      fs.writeFileSync(diskPath, wavBuffer);
    } catch {
      // ignore disk cache write failure
    }
    return wavBuffer;
  })();

  voicePendingCache.set(key, promise);
  try {
    return await promise;
  } finally {
    voicePendingCache.delete(key);
  }
}

const INITIAL_BENCHMARKS: LeaderboardEntry[] = [
  {
    id: 'bench-f1-1',
    playerName: 'C. Leclerc',
    vehicleId: 'ferrari_f1',
    vehicleName: 'Scuderia SF-24',
    category: 'f1',
    trackId: 'monaco',
    bestLapMs: 36420,
    topSpeedKmh: 356,
    ecuStage: 2,
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'bench-f1-2',
    playerName: 'M. Verstappen',
    vehicleId: 'redbull_f1',
    vehicleName: 'Red Bull RB20',
    category: 'f1',
    trackId: 'silverstone',
    bestLapMs: 38110,
    topSpeedKmh: 369,
    ecuStage: 3,
    createdAt: Date.now() - 86400000,
  },
  {
    id: 'bench-f1-3',
    playerName: 'L. Hamilton',
    vehicleId: 'mercedes_f1',
    vehicleName: 'Mercedes-AMG W15',
    category: 'f1',
    trackId: 'monza',
    bestLapMs: 35980,
    topSpeedKmh: 374,
    ecuStage: 3,
    createdAt: Date.now() - 52000000,
  },
  {
    id: 'bench-suh-1',
    playerName: 'Suhail',
    vehicleId: 'suhailll',
    vehicleName: 'SUHAILLL',
    category: 'supercar',
    trackId: 'coastal',
    bestLapMs: 37240,
    topSpeedKmh: 458,
    ecuStage: 3,
    createdAt: Date.now() - 32000000,
  },
  {
    id: 'bench-por-1',
    playerName: 'K. Estre',
    vehicleId: 'porsche_911_gt3rs',
    vehicleName: 'Porsche 911 GT3 RS',
    category: 'supercar',
    trackId: 'alpine',
    bestLapMs: 42890,
    topSpeedKmh: 322,
    ecuStage: 2,
    createdAt: Date.now() - 21600000,
  },
  {
    id: 'bench-bmw-1',
    playerName: 'R. Sato',
    vehicleId: 'bmw_m4',
    vehicleName: 'BMW M4 Competition',
    category: 'supercar',
    trackId: 'midnight',
    bestLapMs: 44650,
    topSpeedKmh: 312,
    ecuStage: 2,
    createdAt: Date.now() - 10800000,
  },
];

function loadLeaderboard(): LeaderboardEntry[] {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // fallback
  }
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(INITIAL_BENCHMARKS, null, 2), 'utf8');
  return [...INITIAL_BENCHMARKS];
}

let leaderboard: LeaderboardEntry[] = loadLeaderboard();

function saveLeaderboard() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist leaderboard:', err);
  }
}

interface ServerRoom {
  id: string;
  name: string;
  trackId: TrackId;
  mode: GameMode;
  maxPlayers: number;
  status: 'lobby' | 'countdown' | 'racing';
  players: Map<string, RemotePlayerState>;
  sockets: Map<string, WebSocket>;
  countdownTimer?: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, ServerRoom>();

function createRoom(id: string, name: string, trackId: TrackId, mode: GameMode): ServerRoom {
  const room: ServerRoom = {
    id,
    name,
    trackId,
    mode,
    maxPlayers: 12,
    status: 'lobby',
    players: new Map(),
    sockets: new Map(),
  };
  rooms.set(id, room);
  return room;
}

createRoom('monaco-f1', 'Rolex Monaco F1 GP', 'monaco', 'f1');
createRoom('silverstone-f1', 'Silverstone F1 Grand Prix', 'silverstone', 'f1');
createRoom('monza-f1', 'Monza F1 Speed Temple', 'monza', 'f1');
createRoom('coastal-casual', 'Coastal Pacific Cruise', 'coastal', 'casual');
createRoom('alpine-casual', 'Alpine BMW & Porsche Run', 'alpine', 'casual');
createRoom('midnight-casual', 'Midnight SUHAILLL Express', 'midnight', 'casual');

function getRoomSummaries(): RoomInfo[] {
  return Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    trackId: r.trackId,
    mode: r.mode,
    playerCount: r.players.size,
    maxPlayers: r.maxPlayers,
    status: r.status,
  }));
}

function broadcastToRoom(room: ServerRoom, payload: unknown, excludeId?: string) {
  const msg = JSON.stringify(payload);
  room.sockets.forEach((ws, pid) => {
    if (pid !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, leaderboardCount: leaderboard.length });
  });

  app.get('/api/voice', async (req, res) => {
    const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (!key || !VOICE_CATALOG[key]) {
      res.status(400).json({ error: 'Invalid voice key' });
      return;
    }
    try {
      const wav = await getOrGenerateVoiceWav(key);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(wav);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'TTS generation failed';
      if (msg === 'GEMINI_API_KEY_MISSING') {
        res.status(503).json({ error: 'GEMINI_API_KEY is not configured' });
        return;
      }
      console.error('Voice TTS error:', msg);
      res.status(502).json({ error: msg });
    }
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getRoomSummaries() });
  });

  app.post('/api/rooms', (req, res) => {
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 32) : '';
    const validTracks: TrackId[] = ['monaco', 'silverstone', 'monza', 'coastal', 'alpine', 'midnight'];
    const trackId: TrackId = validTracks.includes(req.body?.trackId) ? req.body.trackId : 'monaco';
    const mode: GameMode =
      trackId === 'monaco' || trackId === 'silverstone' || trackId === 'monza' ? 'f1' : 'casual';
    const name = rawName || `Custom Room ${rooms.size + 1}`;
    const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const created = createRoom(id, name, trackId, mode);
    res.status(201).json({
      room: {
        id: created.id,
        name: created.name,
        trackId: created.trackId,
        mode: created.mode,
        playerCount: 0,
        maxPlayers: created.maxPlayers,
        status: created.status,
      },
    });
  });

  app.get('/api/leaderboard', (req, res) => {
    const track = typeof req.query.track === 'string' ? req.query.track : 'all';
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    const filtered = leaderboard
      .filter((entry) => (track === 'all' ? true : entry.trackId === track))
      .filter((entry) => (category === 'all' ? true : entry.category === category))
      .sort((a, b) => a.bestLapMs - b.bestLapMs)
      .slice(0, 50);
    res.json({ entries: filtered });
  });

  app.post('/api/leaderboard', (req, res) => {
    const body = req.body ?? {};
    const playerName =
      typeof body.playerName === 'string' ? body.playerName.trim().slice(0, 24) : '';
    const bestLapMs = Number(body.bestLapMs);
    const topSpeedKmh = Number(body.topSpeedKmh);
    const ecuStage = Number(body.ecuStage ?? 0);

    if (
      !playerName ||
      !Number.isFinite(bestLapMs) ||
      bestLapMs < 8000 ||
      bestLapMs > 600000 ||
      !body.vehicleId ||
      !body.trackId
    ) {
      res.status(400).json({ error: 'Invalid leaderboard submission' });
      return;
    }

    const validCats = ['f1', 'supercar', 'xuv', 'bike'] as const;
    const cat = validCats.includes(body.category) ? body.category : 'supercar';
    const validTracks: TrackId[] = ['monaco', 'silverstone', 'monza', 'coastal', 'alpine', 'midnight'];
    const trackId: TrackId = validTracks.includes(body.trackId) ? body.trackId : 'monaco';

    const entry: LeaderboardEntry = {
      id: `lap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      playerName,
      vehicleId: body.vehicleId,
      vehicleName: String(body.vehicleName || body.vehicleId).slice(0, 36),
      category: cat,
      trackId,
      bestLapMs: Math.round(bestLapMs),
      topSpeedKmh: Math.min(520, Math.max(0, Math.round(topSpeedKmh || 0))),
      ecuStage: Math.min(3, Math.max(0, Math.round(ecuStage))),
      createdAt: Date.now(),
    };

    leaderboard.push(entry);
    leaderboard.sort((a, b) => a.bestLapMs - b.bestLapMs);
    if (leaderboard.length > 200) {
      leaderboard = leaderboard.slice(0, 200);
    }
    saveLeaderboard();

    const rank = leaderboard.findIndex((e) => e.id === entry.id) + 1;
    res.status(201).json({ entry, rank });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let clientId = `p-${Math.random().toString(36).slice(2, 9)}`;
    let currentRoom: ServerRoom | null = null;

    const leaveCurrentRoom = () => {
      if (!currentRoom) return;
      const room = currentRoom;
      const leavingName = room.players.get(clientId)?.name;
      room.players.delete(clientId);
      room.sockets.delete(clientId);
      broadcastToRoom(room, {
        type: 'player:left',
        playerId: clientId,
        players: Array.from(room.players.values()),
      });
      if (leavingName) {
        const sysMsg: ChatMessage = {
          id: `sys-${Date.now()}`,
          sender: 'Race Control',
          text: `${leavingName} left the track.`,
          timestamp: Date.now(),
          system: true,
        };
        broadcastToRoom(room, { type: 'chat:message', message: sysMsg });
      }
      if (room.players.size === 0 && room.status !== 'lobby') {
        room.status = 'lobby';
      }
      currentRoom = null;
    };

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (!data || typeof data.type !== 'string') return;

        if (data.type === 'room:join') {
          leaveCurrentRoom();
          const roomId = typeof data.roomId === 'string' ? data.roomId : 'monaco-f1';
          const room = rooms.get(roomId) || rooms.get('monaco-f1')!;
          if (typeof data.playerId === 'string' && data.playerId.length > 2) {
            clientId = data.playerId.slice(0, 32);
          }

          const playerState: RemotePlayerState = {
            id: clientId,
            name: String(data.name || 'Suhail').slice(0, 22),
            vehicleId: data.vehicleId || 'ferrari_f1',
            tuning: data.tuning,
            x: Number(data.x || 0),
            y: Number(data.y || 0),
            z: Number(data.z || 0),
            heading: Number(data.heading || 0),
            speedKmh: 0,
            steer: 0,
            leanAngle: 0,
            nitroActive: false,
            drsActive: false,
            braking: false,
            lap: 1,
            progress: 0,
            finished: false,
          };

          room.players.set(clientId, playerState);
          room.sockets.set(clientId, ws);
          currentRoom = room;

          const slotIndex = Math.max(0, room.players.size - 1);
          ws.send(
            JSON.stringify({
              type: 'room:joined',
              roomId: room.id,
              trackId: room.trackId,
              roomStatus: room.status,
              playerId: clientId,
              slotIndex,
              players: Array.from(room.players.values()),
            }),
          );

          broadcastToRoom(
            room,
            {
              type: 'player:joined',
              player: playerState,
              players: Array.from(room.players.values()),
            },
            clientId,
          );

          const sysMsg: ChatMessage = {
            id: `sys-${Date.now()}`,
            sender: 'Race Control',
            text: `${playerState.name} entered ${room.name}.`,
            timestamp: Date.now(),
            system: true,
          };
          broadcastToRoom(room, { type: 'chat:message', message: sysMsg });
        } else if (data.type === 'room:leave') {
          leaveCurrentRoom();
        } else if (data.type === 'player:state' && currentRoom) {
          const existing = currentRoom.players.get(clientId);
          if (!existing) return;
          existing.x = Number(data.x ?? existing.x);
          existing.y = Number(data.y ?? existing.y);
          existing.z = Number(data.z ?? existing.z);
          existing.heading = Number(data.heading ?? existing.heading);
          existing.speedKmh = Number(data.speedKmh ?? 0);
          existing.steer = Number(data.steer ?? 0);
          existing.leanAngle = Number(data.leanAngle ?? 0);
          existing.nitroActive = Boolean(data.nitroActive);
          existing.drsActive = Boolean(data.drsActive);
          existing.braking = Boolean(data.braking);
          existing.lap = Number(data.lap ?? existing.lap);
          existing.progress = Number(data.progress ?? existing.progress);
          if (data.vehicleId) existing.vehicleId = data.vehicleId;
          if (data.tuning) existing.tuning = data.tuning;
          if (data.finished) {
            existing.finished = true;
            existing.finishTimeMs = Number(data.finishTimeMs || 0);
          }

          broadcastToRoom(
            currentRoom,
            {
              type: 'room:state',
              players: Array.from(currentRoom.players.values()),
            },
            clientId,
          );
        } else if (data.type === 'race:start' && currentRoom) {
          const room = currentRoom;
          if (room.status === 'countdown') return;
          room.status = 'countdown';
          let slot = 0;
          room.players.forEach((p) => {
            p.lap = 1;
            p.progress = 0;
            p.finished = false;
            const sock = room.sockets.get(p.id);
            if (sock && sock.readyState === WebSocket.OPEN) {
              sock.send(
                JSON.stringify({
                  type: 'race:countdown',
                  seconds: 5,
                  slotIndex: slot,
                }),
              );
            }
            slot += 1;
          });
          if (room.countdownTimer) clearTimeout(room.countdownTimer);
          room.countdownTimer = setTimeout(() => {
            room.status = 'racing';
            broadcastToRoom(room, { type: 'race:go' });
          }, 5200);
        } else if (data.type === 'chat:send' && currentRoom) {
          const sender = currentRoom.players.get(clientId)?.name || 'Racer';
          const text = typeof data.text === 'string' ? data.text.trim().slice(0, 140) : '';
          if (!text) return;
          const chatMsg: ChatMessage = {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            sender,
            text,
            timestamp: Date.now(),
          };
          broadcastToRoom(currentRoom, { type: 'chat:message', message: chatMsg });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom();
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`WOW SUHAIL server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
