import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Flag, Gauge, Volume2 } from 'lucide-react';
import { GameMode } from '../types/game';

interface IntroScreenProps {
  onEnter: (mode: GameMode) => void;
  onPlayIntroAudio: (forceReplay?: boolean) => void;
  onStopIntroBgm: () => void;
}

const LETTERS = ['W', 'O', 'W', ' ', 'S', 'U', 'H', 'A', 'I', 'L'];

export const IntroScreen: React.FC<IntroScreenProps> = ({
  onEnter,
  onPlayIntroAudio,
  onStopIntroBgm,
}) => {
  const [audioStarted, setAudioStarted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onPlayIntroAudio(false);
    }, 260);
    return () => {
      window.clearTimeout(timer);
    };
  }, [onPlayIntroAudio]);

  const handleUnlockAudio = () => {
    onPlayIntroAudio(!audioStarted);
    setAudioStarted(true);
  };

  const handleSelectMode = (mode: GameMode) => {
    onStopIntroBgm();
    onEnter(mode);
  };

  return (
    <div
      onPointerDown={handleUnlockAudio}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#07090d] px-6 overflow-hidden select-none"
    >
      {/* Subtle Horizontal Motorsport Telemetry Lines */}
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-3xl h-px bg-gradient-to-r from-transparent via-amber-500/70 to-transparent mb-8 origin-center"
      />

      {/* Animated Letter-by-Letter WOW SUHAIL Title */}
      <div className="relative flex items-center justify-center flex-wrap gap-x-1 sm:gap-x-2">
        {LETTERS.map((ch, idx) =>
          ch === ' ' ? (
            <span key={idx} className="w-4 sm:w-8" />
          ) : (
            <motion.span
              key={idx}
              initial={{ opacity: 0, y: 36, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{
                delay: 0.12 + idx * 0.065,
                duration: 0.65,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={`font-display font-bold text-5xl sm:text-7xl md:text-8xl tracking-wider ${
                idx >= 4 ? 'text-amber-400' : 'text-white'
              }`}
            >
              {ch}
            </motion.span>
          ),
        )}
      </div>

      {/* Subtitle Reveal */}
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85, duration: 0.55 }}
        className="mt-4 text-xs sm:text-sm tracking-[0.28em] uppercase text-slate-400 text-center"
      >
        Welcome, Boss · Formula 1 Grand Prix · Hypercars · Superbikes
      </motion.p>

      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-3xl h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mt-8 mb-9 origin-center"
      />

      {/* Horizontal Mode Entry Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.05, duration: 0.5 }}
        className="flex flex-wrap items-center justify-center gap-3 sm:gap-4"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleSelectMode('f1');
          }}
          className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-display font-bold text-sm sm:text-base tracking-wide transition-colors min-h-[48px]"
        >
          <Flag className="w-4 h-4" />
          <span>F1 Racing Mode</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleSelectMode('casual');
          }}
          className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm sm:text-base tracking-wide transition-colors min-h-[48px]"
        >
          <Gauge className="w-4 h-4" />
          <span>Casual Driving Mode</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlayIntroAudio(true);
            setAudioStarted(true);
          }}
          aria-label="Play Starboy BGM and Welcome Boss voice"
          className="flex items-center gap-1.5 px-4 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-medium text-slate-300 min-h-[48px]"
        >
          <Volume2 className="w-4 h-4 text-amber-400" />
          <span>Intro Audio</span>
        </button>
      </motion.div>
    </div>
  );
};
