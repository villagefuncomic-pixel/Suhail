import { VehicleSpec } from '../types/game';

export class EngineAudioSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private osc3: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  private screechGain: GainNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;

  private windGain: GainNode | null = null;

  // Distant low audience crowd cheering on track
  private crowdBedGain: GainNode | null = null;
  private crowdCheerGain: GainNode | null = null;
  private crowdCheerFilter: BiquadFilterNode | null = null;
  private crowdActive = false;
  private crowdSwellPhase = 0;

  // Starboy-inspired dark synthwave intro BGM
  private introBgmGain: GainNode | null = null;
  private introBgmTimer: number | null = null;
  private introBgmRunning = false;
  private introBgmStep = 0;
  private introBgmNextNoteTime = 0;
  private noiseBuffer: AudioBuffer | null = null;

  // Voice buffer cache & intro guard
  private voiceBufferCache = new Map<string, AudioBuffer>();
  private voiceFetchPromises = new Map<string, Promise<AudioBuffer | null>>();
  private lastIntroVoiceAt = 0;
  private introVoicePlayedOnce = false;

  private muted = false;
  private initialized = false;
  private prevThrottle = 0;
  private crackleTimer = 0;
  private soundProfile: VehicleSpec['soundProfile'] = 'f1_v6_hybrid';

  public init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.44;
      master.connect(ctx.destination);
      this.masterGain = master;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 460;
      filter.Q.value = 3.4;

      const engGain = ctx.createGain();
      engGain.gain.value = 0.0;

      filter.connect(engGain);
      engGain.connect(master);

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 65;

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 130;

      const osc3 = ctx.createOscillator();
      osc3.type = 'sawtooth';
      osc3.frequency.value = 195;

      const oscSub = ctx.createOscillator();
      oscSub.type = 'sine';
      oscSub.frequency.value = 32;

      const g1 = ctx.createGain();
      g1.gain.value = 0.42;
      const g2 = ctx.createGain();
      g2.gain.value = 0.34;
      const g3 = ctx.createGain();
      g3.gain.value = 0.24;
      const gSub = ctx.createGain();
      gSub.gain.value = 0.52;

      osc1.connect(g1).connect(filter);
      osc2.connect(g2).connect(filter);
      osc3.connect(g3).connect(filter);
      oscSub.connect(gSub).connect(filter);

      osc1.start();
      osc2.start();
      osc3.start();
      oscSub.start();

      // Turbocharger / MGU-K Hybrid whine
      const turboOsc = ctx.createOscillator();
      turboOsc.type = 'sine';
      turboOsc.frequency.value = 1600;
      const turboGain = ctx.createGain();
      turboGain.gain.value = 0;
      turboOsc.connect(turboGain).connect(master);
      turboOsc.start();

      const bufferSize = ctx.sampleRate * 2;
      const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = noiseBuf;

      const screechSrc = ctx.createBufferSource();
      screechSrc.buffer = noiseBuf;
      screechSrc.loop = true;
      const screechFilter = ctx.createBiquadFilter();
      screechFilter.type = 'bandpass';
      screechFilter.frequency.value = 1450;
      screechFilter.Q.value = 4.5;
      const screechGain = ctx.createGain();
      screechGain.gain.value = 0;
      screechSrc.connect(screechFilter).connect(screechGain).connect(master);
      screechSrc.start();

      const windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuf;
      windSrc.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 540;
      const windGain = ctx.createGain();
      windGain.gain.value = 0;
      windSrc.connect(windFilter).connect(windGain).connect(master);
      windSrc.start();

      // Distant low grandstand crowd cheering bed (far, warm, low-passed ambient roar)
      const crowdBedSrc = ctx.createBufferSource();
      crowdBedSrc.buffer = noiseBuf;
      crowdBedSrc.loop = true;
      const crowdBedLowpass = ctx.createBiquadFilter();
      crowdBedLowpass.type = 'lowpass';
      crowdBedLowpass.frequency.value = 410;
      crowdBedLowpass.Q.value = 1.2;
      const crowdBedBand = ctx.createBiquadFilter();
      crowdBedBand.type = 'bandpass';
      crowdBedBand.frequency.value = 260;
      crowdBedBand.Q.value = 0.7;
      const crowdBedGain = ctx.createGain();
      crowdBedGain.gain.value = 0;
      crowdBedSrc.connect(crowdBedLowpass).connect(crowdBedBand).connect(crowdBedGain).connect(master);
      crowdBedSrc.start();

      // Distant stadium cheer swell layer (opens gently on straightaways & finish grandstand)
      const crowdCheerSrc = ctx.createBufferSource();
      crowdCheerSrc.buffer = noiseBuf;
      crowdCheerSrc.loop = true;
      const crowdCheerFilter = ctx.createBiquadFilter();
      crowdCheerFilter.type = 'lowpass';
      crowdCheerFilter.frequency.value = 520;
      crowdCheerFilter.Q.value = 1.6;
      const crowdCheerGain = ctx.createGain();
      crowdCheerGain.gain.value = 0;
      crowdCheerSrc.connect(crowdCheerFilter).connect(crowdCheerGain).connect(master);
      crowdCheerSrc.start();

      const introBgmGain = ctx.createGain();
      introBgmGain.gain.value = 0.38;
      introBgmGain.connect(master);

      this.osc1 = osc1;
      this.osc2 = osc2;
      this.osc3 = osc3;
      this.oscSub = oscSub;
      this.engineFilter = filter;
      this.engineGain = engGain;
      this.turboOsc = turboOsc;
      this.turboGain = turboGain;
      this.screechFilter = screechFilter;
      this.screechGain = screechGain;
      this.windGain = windGain;
      this.crowdBedGain = crowdBedGain;
      this.crowdCheerGain = crowdCheerGain;
      this.crowdCheerFilter = crowdCheerFilter;
      this.introBgmGain = introBgmGain;
      this.initialized = true;
    } catch {
      // AudioContext unavailable
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public getMasterGain(): GainNode | null {
    return this.masterGain;
  }

  public setProfile(profile: VehicleSpec['soundProfile']) {
    this.soundProfile = profile;
    if (!this.osc1 || !this.osc2 || !this.osc3) return;
    if (profile === 'suhailll_w16') {
      this.osc1.type = 'sawtooth';
      this.osc2.type = 'sawtooth';
      this.osc3.type = 'triangle';
    } else if (profile === 'f1_v6_hybrid') {
      this.osc1.type = 'sawtooth';
      this.osc2.type = 'triangle';
      this.osc3.type = 'sawtooth';
    } else if (profile === 'v8_turbo' || profile === 'inline6_bmw') {
      this.osc1.type = 'sawtooth';
      this.osc2.type = 'square';
      this.osc3.type = 'triangle';
    } else {
      this.osc1.type = 'sawtooth';
      this.osc2.type = 'triangle';
      this.osc3.type = 'sine';
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.44, this.ctx.currentTime, 0.05);
    }
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  public setEngineActive(active: boolean) {
    if (!this.engineGain || !this.ctx) return;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      this.screechGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.windGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.turboGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.setCrowdActive(false);
    }
  }

  public setCrowdActive(active: boolean) {
    this.crowdActive = active;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (!active) {
      this.crowdBedGain?.gain.setTargetAtTime(0, now, 0.2);
      this.crowdCheerGain?.gain.setTargetAtTime(0, now, 0.2);
    } else {
      this.crowdBedGain?.gain.setTargetAtTime(0.045, now, 0.4);
    }
  }

  public updateCrowd(params: {
    speedKmh: number;
    rank: number;
    nearGrandstand: boolean;
    drsOrNitro: boolean;
    dt: number;
  }) {
    if (!this.crowdActive || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.crowdSwellPhase += params.dt * 1.1;

    const wave = 0.5 + 0.5 * Math.sin(this.crowdSwellPhase) * Math.cos(this.crowdSwellPhase * 0.43);
    const speedFactor = Math.min(1, params.speedKmh / 270);
    const positionBoost = params.rank === 1 ? 0.025 : params.rank === 2 ? 0.014 : 0;
    const grandstandBoost = params.nearGrandstand ? 0.05 : 0;
    const excitementBoost = params.drsOrNitro ? 0.022 : 0;

    // Far, low, warm stadium crowd sound (never harsh or loud)
    const bedLevel = 0.036 + wave * 0.022 + grandstandBoost * 0.4;
    const cheerLevel =
      0.015 + speedFactor * 0.032 + grandstandBoost + positionBoost + excitementBoost + wave * 0.018;

    this.crowdBedGain?.gain.setTargetAtTime(bedLevel, now, 0.3);
    this.crowdCheerGain?.gain.setTargetAtTime(cheerLevel, now, 0.25);
    this.crowdCheerFilter?.frequency.setTargetAtTime(
      360 + speedFactor * 160 + (params.nearGrandstand ? 180 : 0) + wave * 80,
      now,
      0.3,
    );
  }

  /**
   * Starboy-inspired dark moody 93 BPM synthwave/R&B instrumental BGM
   */
  public startIntroBgm() {
    this.init();
    if (!this.ctx || !this.introBgmGain || this.introBgmRunning) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    this.introBgmRunning = true;
    this.introBgmStep = 0;
    this.introBgmNextNoteTime = this.ctx.currentTime + 0.04;
    this.introBgmGain.gain.setTargetAtTime(0.42, this.ctx.currentTime, 0.25);

    const stepDuration = 60 / 93 / 4; // 16th-note at 93 BPM (~0.161s)

    const scheduleStep = (step: number, time: number) => {
      if (!this.ctx || !this.introBgmGain || this.muted) return;
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;

      // Starboy-style minor chord roots: Am -> G -> F -> Em
      const roots = [55.0, 49.0, 43.65, 41.2]; // A1, G1, F1, E1
      const chords = [
        [220.0, 261.63, 329.63, 392.0], // Am7
        [196.0, 246.94, 293.66, 329.63], // G6
        [174.61, 220.0, 261.63, 329.63], // Fmaj7
        [164.81, 196.0, 246.94, 293.66], // Em7
      ];
      const rootFreq = roots[bar];
      const chordFreqs = chords[bar];

      // 1. Syncopated punchy kick drum (steps 0, 3, 6, 8, 11, 14)
      if (s === 0 || s === 3 || s === 8 || s === 10 || (bar % 2 === 1 && s === 14)) {
        const kick = this.ctx.createOscillator();
        const kGain = this.ctx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(128, time);
        kick.frequency.exponentialRampToValueAtTime(38, time + 0.14);
        kGain.gain.setValueAtTime(0.75, time);
        kGain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
        kick.connect(kGain).connect(this.introBgmGain);
        kick.start(time);
        kick.stop(time + 0.26);
      }

      // 2. Crisp gated snare/clap on beat 2 & 4 (steps 4 & 12)
      if ((s === 4 || s === 12) && this.noiseBuffer) {
        const clapSrc = this.ctx.createBufferSource();
        clapSrc.buffer = this.noiseBuffer;
        const clapFilter = this.ctx.createBiquadFilter();
        clapFilter.type = 'bandpass';
        clapFilter.frequency.setValueAtTime(1650, time);
        clapFilter.Q.value = 1.4;
        const clapGain = this.ctx.createGain();
        clapGain.gain.setValueAtTime(0.32, time);
        clapGain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
        clapSrc.connect(clapFilter).connect(clapGain).connect(this.introBgmGain);
        clapSrc.start(time);
        clapSrc.stop(time + 0.17);
      }

      // 3. Tight rhythmic hi-hats
      if (s % 2 === 0 && this.noiseBuffer) {
        const hatSrc = this.ctx.createBufferSource();
        hatSrc.buffer = this.noiseBuffer;
        const hatFilter = this.ctx.createBiquadFilter();
        hatFilter.type = 'highpass';
        hatFilter.frequency.setValueAtTime(7200, time);
        const hatGain = this.ctx.createGain();
        hatGain.gain.setValueAtTime(s % 4 === 2 ? 0.08 : 0.045, time);
        hatGain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
        hatSrc.connect(hatFilter).connect(hatGain).connect(this.introBgmGain);
        hatSrc.start(time);
        hatSrc.stop(time + 0.05);
      }

      // 4. Driving dark Starboy analog bassline
      if (s === 0 || s === 3 || s === 6 || s === 8 || s === 12 || s === 14) {
        const bassOsc = this.ctx.createOscillator();
        const bassFilter = this.ctx.createBiquadFilter();
        const bassGain = this.ctx.createGain();
        bassOsc.type = 'sawtooth';
        const octaveJump = s === 6 || s === 14 ? 2 : 1;
        bassOsc.frequency.setValueAtTime(rootFreq * octaveJump, time);
        bassFilter.type = 'lowpass';
        bassFilter.frequency.setValueAtTime(480, time);
        bassFilter.frequency.exponentialRampToValueAtTime(140, time + 0.22);
        bassGain.gain.setValueAtTime(0.28, time);
        bassGain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
        bassOsc.connect(bassFilter).connect(bassGain).connect(this.introBgmGain);
        bassOsc.start(time);
        bassOsc.stop(time + 0.25);
      }

      // 5. Lush Daft-Punk / Starboy dark piano-synth stabs on bar downbeat & syncopation
      if (s === 0 || s === 10) {
        chordFreqs.forEach((f, idx) => {
          if (!this.ctx || !this.introBgmGain) return;
          const padOsc = this.ctx.createOscillator();
          const padFilter = this.ctx.createBiquadFilter();
          const padGain = this.ctx.createGain();
          padOsc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
          padOsc.frequency.setValueAtTime(f, time);
          padOsc.detune.setValueAtTime(idx % 2 === 0 ? -6 : 6, time);
          padFilter.type = 'lowpass';
          padFilter.frequency.setValueAtTime(1400, time);
          padFilter.frequency.exponentialRampToValueAtTime(420, time + 0.55);
          padGain.gain.setValueAtTime(0.001, time);
          padGain.gain.linearRampToValueAtTime(s === 0 ? 0.075 : 0.045, time + 0.02);
          padGain.gain.exponentialRampToValueAtTime(0.001, time + (s === 0 ? 0.85 : 0.42));
          padOsc.connect(padFilter).connect(padGain).connect(this.introBgmGain);
          padOsc.start(time);
          padOsc.stop(time + 0.9);
        });
      }

      // 6. Signature nocturnal electric pluck motif
      if (s === 2 || s === 5 || s === 9 || s === 13) {
        const noteFreq = chordFreqs[(s + bar) % chordFreqs.length] * 2;
        const pluck = this.ctx.createOscillator();
        const pluckGain = this.ctx.createGain();
        pluck.type = 'triangle';
        pluck.frequency.setValueAtTime(noteFreq, time);
        pluckGain.gain.setValueAtTime(0.05, time);
        pluckGain.gain.exponentialRampToValueAtTime(0.001, time + 0.19);
        pluck.connect(pluckGain).connect(this.introBgmGain);
        pluck.start(time);
        pluck.stop(time + 0.2);
      }
    };

    const tick = () => {
      if (!this.introBgmRunning || !this.ctx) return;
      if (this.ctx.state !== 'running') {
        this.introBgmNextNoteTime = this.ctx.currentTime + 0.04;
        return;
      }
      while (this.introBgmNextNoteTime < this.ctx.currentTime + 0.14) {
        scheduleStep(this.introBgmStep, this.introBgmNextNoteTime);
        this.introBgmNextNoteTime += stepDuration;
        this.introBgmStep = (this.introBgmStep + 1) % 64;
      }
    };

    this.introBgmTimer = window.setInterval(tick, 45);
  }

  public stopIntroBgm() {
    this.introBgmRunning = false;
    if (this.introBgmTimer !== null) {
      window.clearInterval(this.introBgmTimer);
      this.introBgmTimer = null;
    }
    if (this.introBgmGain && this.ctx) {
      this.introBgmGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }

  public async preloadVoice(key: string): Promise<AudioBuffer | null> {
    if (this.voiceBufferCache.has(key)) {
      return this.voiceBufferCache.get(key) ?? null;
    }
    const existing = this.voiceFetchPromises.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const res = await fetch(`/api/voice?key=${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        const arrBuf = await res.arrayBuffer();
        if (!this.ctx) this.init();
        if (!this.ctx) return null;
        const decoded = await this.ctx.decodeAudioData(arrBuf.slice(0));
        this.voiceBufferCache.set(key, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.voiceFetchPromises.delete(key);
      }
    })();

    this.voiceFetchPromises.set(key, promise);
    return promise;
  }

  public playVoiceBuffer(
    buffer: AudioBuffer,
    options?: { playbackRate?: number; gain?: number; devilEffect?: boolean },
  ): number {
    if (!this.ctx || !this.masterGain || this.muted) return 0;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const now = this.ctx.currentTime;
    const rate = options?.playbackRate ?? 1.0;
    const gainVal = options?.gain ?? 1.25;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rate, now);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, now);

    if (options?.devilEffect) {
      // Deep demonic resonant filter + sub-octave layer + dark cavern echo
      const lowFilter = this.ctx.createBiquadFilter();
      lowFilter.type = 'lowshelf';
      lowFilter.frequency.value = 260;
      lowFilter.gain.value = 8;

      const delay = this.ctx.createDelay(0.5);
      delay.delayTime.value = 0.085;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.24;
      delay.connect(fb).connect(delay);

      const wetGain = this.ctx.createGain();
      wetGain.gain.value = 0.28;

      src.connect(lowFilter).connect(g);
      g.connect(this.masterGain);
      g.connect(delay).connect(wetGain).connect(this.masterGain);

      // Sub-octave demonic shadow voice
      const subSrc = this.ctx.createBufferSource();
      subSrc.buffer = buffer;
      subSrc.playbackRate.setValueAtTime(rate * 0.78, now);
      const subLp = this.ctx.createBiquadFilter();
      subLp.type = 'lowpass';
      subLp.frequency.value = 340;
      const subG = this.ctx.createGain();
      subG.gain.setValueAtTime(gainVal * 0.55, now);
      subSrc.connect(subLp).connect(subG).connect(this.masterGain);
      subSrc.start(now);
    } else {
      src.connect(g).connect(this.masterGain);
    }

    src.start(now);
    return (buffer.duration / rate) * 1000;
  }

  public async playIntroVoice(forceReplay = false) {
    const nowMs = Date.now();
    if (!forceReplay && this.introVoicePlayedOnce && nowMs - this.lastIntroVoiceAt < 2500) {
      return;
    }
    if (nowMs - this.lastIntroVoiceAt < 900) return;

    this.init();
    this.startIntroBgm();

    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // wait for user gesture
      }
    }

    if (!this.ctx || this.ctx.state !== 'running') {
      // Browser blocked autoplay before user gesture; wait until user taps
      return;
    }

    this.lastIntroVoiceAt = nowMs;
    this.introVoicePlayedOnce = true;

    // Duck Starboy BGM slightly while the casual Welcome Boss greeting plays
    if (this.introBgmGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.introBgmGain.gain.setTargetAtTime(0.2, now, 0.12);
      window.setTimeout(() => {
        if (this.introBgmRunning && this.introBgmGain && this.ctx) {
          this.introBgmGain.gain.setTargetAtTime(0.42, this.ctx.currentTime, 0.4);
        }
      }, 2800);
    }

    // 1. Smooth Starboy-style warm synth pad swell
    if (this.ctx && this.masterGain && !this.muted) {
      const now = this.ctx.currentTime;
      [110, 164.81, 220].forEach((freq, i) => {
        const osc = this.ctx!.createOscillator();
        const lp = this.ctx!.createBiquadFilter();
        const g = this.ctx!.createGain();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now);
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, now);
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(i === 0 ? 0.14 : 0.08, now + 0.25);
        g.gain.exponentialRampToValueAtTime(0.001, now + 2.0);
        osc.connect(lp).connect(g).connect(this.masterGain!);
        osc.start(now);
        osc.stop(now + 2.1);
      });
    }

    // 2. Casual "Welcome, Boss!" (Gemini TTS + natural SpeechSynthesis fallback)
    if (this.muted) return;
    const cachedBuf =
      this.voiceBufferCache.get('intro_welcome_boss_casual') ??
      (await this.preloadVoice('intro_welcome_boss_casual'));

    if (cachedBuf) {
      this.playVoiceBuffer(cachedBuf, {
        playbackRate: 1.0,
        gain: 1.35,
        devilEffect: false,
      });
      return;
    }

    // Browser fallback: casual friendly greeting via speechSynthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance("Welcome, Boss! Ready when you are — let's drive.");
        utter.pitch = 0.96;
        utter.rate = 1.0;
        utter.volume = 0.95;

        const pickVoice = () => {
          const voices = window.speechSynthesis.getVoices();
          const preferred = voices.find((v) =>
            /Daniel|George|David|Mark|Google UK English Male|Alex|Male/i.test(v.name),
          );
          if (preferred) utter.voice = preferred;
          window.speechSynthesis.speak(utter);
        };

        if (window.speechSynthesis.getVoices().length > 0) {
          pickVoice();
        } else {
          window.speechSynthesis.onvoiceschanged = () => {
            pickVoice();
            window.speechSynthesis.onvoiceschanged = null;
          };
          setTimeout(() => {
            if (!window.speechSynthesis.speaking) window.speechSynthesis.speak(utter);
          }, 120);
        }
      } catch {
        // ignore speech synthesis restrictions
      }
    }
  }

  public update(params: {
    rpm: number;
    maxRpm: number;
    throttle: number;
    speedKmh: number;
    driftAngleDeg: number;
    nitroActive: boolean;
    ecuStage: number;
    dt: number;
  }) {
    if (!this.initialized || !this.ctx || !this.osc1 || !this.osc2 || !this.osc3 || !this.oscSub)
      return;
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const rpmNorm = Math.max(0, Math.min(1.1, params.rpm / params.maxRpm));

    let baseFreq = 36;
    let h2 = 1.5;
    let h3 = 2.5;

    if (this.soundProfile === 'suhailll_w16') {
      baseFreq = 38 + rpmNorm * 188;
      h2 = 1.5;
      h3 = 2.01;
    } else if (this.soundProfile === 'f1_v6_hybrid') {
      baseFreq = 54 + rpmNorm * 265;
      h2 = 1.5;
      h3 = 3.0;
    } else if (this.soundProfile === 'flat6_gt3') {
      baseFreq = 36 + rpmNorm * 165;
      h2 = 1.33;
      h3 = 2.0;
    } else if (this.soundProfile === 'inline6_bmw') {
      baseFreq = 32 + rpmNorm * 130;
      h2 = 1.5;
      h3 = 2.25;
    } else if (this.soundProfile === 'v12') {
      baseFreq = 36 + rpmNorm * 165;
      h2 = 1.5;
      h3 = 2.0;
    } else if (this.soundProfile === 'v10') {
      baseFreq = 34 + rpmNorm * 148;
      h2 = 1.66;
      h3 = 2.5;
    } else if (this.soundProfile === 'v8_turbo') {
      baseFreq = 26 + rpmNorm * 98;
      h2 = 2.0;
      h3 = 1.5;
    } else if (this.soundProfile === 'i4_bike') {
      baseFreq = 46 + rpmNorm * 235;
      h2 = 2.0;
      h3 = 3.0;
    } else {
      baseFreq = 42 + rpmNorm * 212;
      h2 = 1.75;
      h3 = 2.5;
    }

    this.osc1.frequency.setTargetAtTime(baseFreq, now, 0.025);
    this.osc2.frequency.setTargetAtTime(baseFreq * h2, now, 0.025);
    this.osc3.frequency.setTargetAtTime(baseFreq * h3, now, 0.025);
    this.oscSub.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.025);

    const cutoff =
      (this.soundProfile === 'suhailll_w16' ? 380 : 280) +
      rpmNorm * 2700 +
      params.throttle * 1050 +
      (params.nitroActive ? 1000 : 0);
    this.engineFilter?.frequency.setTargetAtTime(cutoff, now, 0.04);

    const engVol = 0.14 + params.throttle * 0.15 + rpmNorm * 0.11;
    this.engineGain?.gain.setTargetAtTime(engVol, now, 0.04);

    const hasTurbo =
      this.soundProfile === 'suhailll_w16' ||
      this.soundProfile === 'f1_v6_hybrid' ||
      this.soundProfile === 'v8_turbo' ||
      this.soundProfile === 'inline6_bmw' ||
      params.ecuStage >= 2;

    if (hasTurbo && this.turboOsc && this.turboGain) {
      const turboFreq =
        (this.soundProfile === 'f1_v6_hybrid' ? 2200 : 1450) +
        rpmNorm * 3100 +
        (params.nitroActive ? 950 : 0);
      this.turboOsc.frequency.setTargetAtTime(turboFreq, now, 0.06);
      const spoolVol =
        params.throttle > 0.25 && rpmNorm > 0.3
          ? (rpmNorm - 0.28) * (this.soundProfile === 'suhailll_w16' ? 0.055 : 0.045)
          : 0;
      this.turboGain.gain.setTargetAtTime(spoolVol, now, 0.08);
    }

    this.crackleTimer = Math.max(0, this.crackleTimer - params.dt);
    if (this.prevThrottle > 0.55 && params.throttle < 0.15 && rpmNorm > 0.52 && this.crackleTimer <= 0) {
      this.playExhaustPop(hasTurbo);
      this.crackleTimer = 0.42;
    }
    this.prevThrottle = params.throttle;

    if (this.screechGain && this.screechFilter) {
      const slipStrength =
        params.speedKmh > 25 && params.driftAngleDeg > 9
          ? Math.min(1, (params.driftAngleDeg - 9) / 25) * 0.14
          : 0;
      this.screechGain.gain.setTargetAtTime(slipStrength, now, 0.05);
      this.screechFilter.frequency.setTargetAtTime(1250 + params.speedKmh * 3.5, now, 0.05);
    }

    if (this.windGain) {
      const windVol = Math.max(0, (params.speedKmh - 80) / 310) * 0.12;
      this.windGain.gain.setTargetAtTime(windVol, now, 0.08);
    }
  }

  public playExhaustPop(withBlowoff = false) {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = withBlowoff ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(withBlowoff ? 2400 : 140, now);
    osc.frequency.exponentialRampToValueAtTime(withBlowoff ? 650 : 48, now + 0.14);
    g.gain.setValueAtTime(withBlowoff ? 0.08 : 0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playShiftBlip() {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(82, now + 0.08);
    g.gain.setValueAtTime(0.11, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playCollision(strength: number) {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.22);
    g.gain.setValueAtTime(Math.min(0.4, strength * 0.025), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playCountdownBeep(isGo: boolean) {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 920 : 480, now);
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.38 : 0.18));
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.4 : 0.2));
  }

  public playHorn() {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [349.23, 440].forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.08, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(g).connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 0.3);
    });
  }

  public dispose() {
    this.stopIntroBgm();
    try {
      this.osc1?.stop();
      this.osc2?.stop();
      this.osc3?.stop();
      this.oscSub?.stop();
      this.turboOsc?.stop();
      this.ctx?.close();
    } catch {
      // ignore
    }
  }
}
