import { CommentaryCaption, CommentaryMode, GameMode } from '../types/game';
import { EngineAudioSystem } from './audio';

export type CommentaryEvent =
  | 'start'
  | 'high_accel'
  | 'speed'
  | 'drs'
  | 'corner'
  | 'p1'
  | 'lap'
  | 'wall_hit'
  | 'assist_left'
  | 'assist_right'
  | 'assist_brake'
  | 'assist_straight'
  | 'finish';

interface LineEntry {
  key: string;
  speaker: 'english' | 'siddhu' | 'assistant';
  text: string;
}

const ENGLISH_LINES: Record<
  'start' | 'speed' | 'drs' | 'corner' | 'p1' | 'lap' | 'wall_hit' | 'finish',
  LineEntry
> = {
  start: {
    key: 'en_start',
    speaker: 'english',
    text: 'Lights out and away we go! An absolute rocket launch off the grid!',
  },
  speed: {
    key: 'en_speed',
    speaker: 'english',
    text: 'Flat out down the straight! Look at that pace with DRS wide open!',
  },
  drs: {
    key: 'en_speed',
    speaker: 'english',
    text: 'Flat out down the straight! Look at that pace with DRS wide open!',
  },
  corner: {
    key: 'en_corner',
    speaker: 'english',
    text: 'Surgical precision through the apex! Carrying blistering momentum on the exit!',
  },
  p1: {
    key: 'en_p1',
    speaker: 'english',
    text: 'Into P1! A clinical move to seize the lead of this Grand Prix!',
  },
  lap: {
    key: 'en_lap',
    speaker: 'english',
    text: 'Across the line! Setting purple sectors and pushing the car to its absolute limit!',
  },
  wall_hit: {
    key: 'en_wall_hit',
    speaker: 'english',
    text: 'Ooh, heavy contact with the barrier! Watch your entry speed and get back on the racing line!',
  },
  finish: {
    key: 'en_finish',
    speaker: 'english',
    text: 'Chequered flag! A masterclass behind the wheel, what a sensational drive!',
  },
};

const SIDDHU_LINES: Record<
  'start' | 'speed' | 'drs' | 'corner' | 'p1' | 'lap' | 'wall_hit' | 'finish',
  LineEntry
> = {
  start: {
    key: 'hi_start',
    speaker: 'siddhu',
    text: 'Wah Guru! Maza aa gaya! Kya zabardast start liya hai, thoko taali!',
  },
  speed: {
    key: 'hi_speed',
    speaker: 'siddhu',
    text: 'Oye hoye hoye! Yeh gaadi nahi, bijli ka toofan hai Guru! Hawa se baatein ho rahi hain!',
  },
  drs: {
    key: 'hi_drs',
    speaker: 'siddhu',
    text: 'DRS khul gaya aur sher ki tarah nikal gaye! Wah Guru, dil bagh-bagh kar diya!',
  },
  corner: {
    key: 'hi_corner',
    speaker: 'siddhu',
    text: 'Kya baat hai Guru! Corner pe aisi pakad dekh ke maza aa gaya, wah bhai wah!',
  },
  p1: {
    key: 'hi_p1',
    speaker: 'siddhu',
    text: 'Number one pe kabza ho gaya Guru! Chha gaye, aaj toh sabki chhutti kar di, thoko taali!',
  },
  lap: {
    key: 'hi_lap',
    speaker: 'siddhu',
    text: 'Ek aur shandaar lap poora! Wah Guru maza aa gaya, yeh raftaar dekh ke taali bajti hai!',
  },
  wall_hit: {
    key: 'hi_wall_hit',
    speaker: 'siddhu',
    text: 'Arre deewar se takkar ho gayi Guru! Brake maaro, sambhal ke track pe wapas aao!',
  },
  finish: {
    key: 'hi_finish',
    speaker: 'siddhu',
    text: 'Chequered flag lehra gaya Guru! Jeet ka jashn manao, wah guru maza aa gaya!',
  },
};

const HIGH_ACCEL_HINDI: LineEntry[] = [
  {
    key: 'hi_high_accel',
    speaker: 'siddhu',
    text: 'Wah Guru! Kya rocket jaisi acceleration hai! Maza aa gaya, thoko taali!',
  },
  {
    key: 'hi_high_accel_2',
    speaker: 'siddhu',
    text: 'Oye hoye hoye! Full throttle pe toh gaadi hawa mein udne lagi Guru! Kya pick-up hai!',
  },
];

const ASSISTANT_LINES: Record<
  'assist_left' | 'assist_right' | 'assist_brake' | 'assist_straight',
  LineEntry
> = {
  assist_left: {
    key: 'assist_left',
    speaker: 'assistant',
    text: 'Sharp left corner ahead — brake early and clip the inside apex!',
  },
  assist_right: {
    key: 'assist_right',
    speaker: 'assistant',
    text: 'Tight right turn coming up — get on the brakes and turn in smooth!',
  },
  assist_brake: {
    key: 'assist_brake',
    speaker: 'assistant',
    text: 'Heavy braking zone ahead — scrub speed now before the hairpin!',
  },
  assist_straight: {
    key: 'assist_straight',
    speaker: 'assistant',
    text: 'Clear straight ahead — full throttle, push flat out now!',
  },
};

export class RaceCommentarySystem {
  private audio: EngineAudioSystem;
  private mode: CommentaryMode = 'mix';
  private gameMode: GameMode = 'f1';
  private lastSpokenAt = 0;
  private lastWallHitAt = 0;
  private lastAssistAt = 0;
  private lastHighAccelAt = 0;
  private playingUntil = 0;
  private mixTurn = 0;
  private highAccelToggle = 0;
  private captionCounter = 0;
  private onCaption?: (caption: CommentaryCaption | null) => void;
  private clearCaptionTimer: number | null = null;

  constructor(audio: EngineAudioSystem, onCaption?: (caption: CommentaryCaption | null) => void) {
    this.audio = audio;
    this.onCaption = onCaption;
  }

  public setMode(mode: CommentaryMode) {
    this.mode = mode;
    if (mode === 'off') {
      this.stop();
    }
  }

  public setGameMode(gameMode: GameMode) {
    this.gameMode = gameMode;
  }

  public preloadRaceLines() {
    const keys = [
      'hi_start',
      'en_start',
      'hi_high_accel',
      'hi_high_accel_2',
      'en_wall_hit',
      'hi_wall_hit',
      'assist_left',
      'assist_right',
      'assist_brake',
      'assist_straight',
      'hi_speed',
      'en_speed',
      'hi_drs',
      'hi_lap',
      'en_lap',
    ];
    keys.forEach((k) => {
      void this.audio.preloadVoice(k);
    });
  }

  public stop() {
    if (this.clearCaptionTimer !== null) {
      window.clearTimeout(this.clearCaptionTimer);
      this.clearCaptionTimer = null;
    }
    this.onCaption?.(null);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  private isSilenced(): boolean {
    return this.mode === 'off' || this.audio.isMuted();
  }

  public async trigger(event: CommentaryEvent, force = false) {
    if (this.isSilenced()) return;

    const now = Date.now();

    if (event === 'wall_hit') {
      if (!force && now - this.lastWallHitAt < 4200) return;
      this.lastWallHitAt = now;
    } else if (
      event === 'assist_left' ||
      event === 'assist_right' ||
      event === 'assist_brake' ||
      event === 'assist_straight'
    ) {
      if (!force && (now < this.playingUntil || now - this.lastAssistAt < 7000)) return;
      this.lastAssistAt = now;
    } else if (event === 'high_accel') {
      if (!force && (now < this.playingUntil || now - this.lastHighAccelAt < 9000 || now - this.lastSpokenAt < 5200)) {
        return;
      }
      this.lastHighAccelAt = now;
    } else {
      if (!force && (now < this.playingUntil || now - this.lastSpokenAt < 6800)) {
        return;
      }
    }

    let entry: LineEntry;
    if (
      event === 'assist_left' ||
      event === 'assist_right' ||
      event === 'assist_brake' ||
      event === 'assist_straight'
    ) {
      entry = ASSISTANT_LINES[event];
    } else if (event === 'high_accel') {
      // Dedicated Hindi Siddhu Paji commentary whenever acceleration is high
      entry = HIGH_ACCEL_HINDI[this.highAccelToggle % HIGH_ACCEL_HINDI.length];
      this.highAccelToggle += 1;
    } else if (this.mode === 'hindi') {
      entry = SIDDHU_LINES[event];
    } else if (this.mode === 'english') {
      entry = ENGLISH_LINES[event];
    } else {
      if (event === 'start' && this.gameMode === 'f1') {
        entry = SIDDHU_LINES.start;
      } else if (event === 'drs') {
        entry = SIDDHU_LINES.drs;
      } else {
        this.mixTurn += 1;
        entry = this.mixTurn % 2 === 1 ? SIDDHU_LINES[event] : ENGLISH_LINES[event];
      }
    }

    this.lastSpokenAt = now;
    this.playingUntil = now + 3800;

    this.captionCounter += 1;
    this.onCaption?.({
      id: `cap-${this.captionCounter}`,
      speaker: entry.speaker,
      text: entry.text,
    });
    if (this.clearCaptionTimer !== null) {
      window.clearTimeout(this.clearCaptionTimer);
    }
    this.clearCaptionTimer = window.setTimeout(() => {
      this.onCaption?.(null);
    }, 4400);

    const buf = await this.audio.preloadVoice(entry.key);
    if (this.isSilenced()) return;

    if (buf) {
      const durationMs = this.audio.playVoiceBuffer(buf, {
        playbackRate: 1.0,
        gain: 1.35,
        devilEffect: false,
      });
      this.playingUntil = Date.now() + Math.max(2200, durationMs + 400);
      return;
    }

    // Fallback to browser SpeechSynthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(entry.text);
        const voices = window.speechSynthesis.getVoices();
        if (entry.speaker === 'siddhu') {
          utter.lang = 'hi-IN';
          utter.pitch = 1.08;
          utter.rate = 1.04;
          const hiVoice = voices.find((v) =>
            /hi|Hindi|Lekha|Rishi|Hemant|Kalpana/i.test(v.lang + ' ' + v.name),
          );
          if (hiVoice) utter.voice = hiVoice;
        } else if (entry.speaker === 'assistant') {
          utter.lang = 'en-US';
          utter.pitch = 1.0;
          utter.rate = 1.1;
          const assistVoice = voices.find((v) =>
            /Samantha|Aria|Karen|Daniel|Google US English/i.test(v.name),
          );
          if (assistVoice) utter.voice = assistVoice;
        } else {
          utter.lang = 'en-GB';
          utter.pitch = 0.88;
          utter.rate = 1.06;
          const enMale = voices.find((v) =>
            /Daniel|George|Arthur|Ryan|David|Google UK English Male|Male/i.test(v.name),
          );
          if (enMale) utter.voice = enMale;
        }
        utter.volume = 0.96;
        window.speechSynthesis.speak(utter);
      } catch {
        // ignore speech synthesis fallback error
      }
    }
  }
}
