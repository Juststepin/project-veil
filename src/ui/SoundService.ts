import type { GameEvent } from '../core/types';

export type SoundEffectName =
  | 'step'
  | 'attack'
  | 'traitHit'
  | 'hit'
  | 'heal'
  | 'glitch'
  | 'ending';

type AudioContextConstructor = typeof AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    const win = window as typeof window & {
      webkitAudioContext?: AudioContextConstructor;
    };
    return win.AudioContext ?? win.webkitAudioContext ?? null;
  } catch {
    return null;
  }
}

export class SoundService {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private unlockBound = false;

  constructor(initialMuted = false) {
    this.muted = Boolean(initialMuted);
    this.installFirstInteractionUnlock();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = Boolean(muted);
    if (!this.muted) {
      this.unlock();
    }
  }

  unlock(): void {
    try {
      const Ctor = resolveAudioContextConstructor();
      if (!Ctor) return;
      if (!this.ctx) {
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
    } catch {
      // Safe no-op in headless/unsupported audio environments
    }
  }

  play(effect: SoundEffectName, delaySec = 0): void {
    if (this.muted) return;
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const startAt = ctx.currentTime + Math.max(0, delaySec);

      switch (effect) {
        case 'step':
          this.playStep(ctx, startAt);
          break;
        case 'attack':
          this.playAttack(ctx, startAt);
          break;
        case 'traitHit':
          this.playTraitHit(ctx, startAt);
          break;
        case 'hit':
          this.playHit(ctx, startAt);
          break;
        case 'heal':
          this.playHeal(ctx, startAt);
          break;
        case 'glitch':
          this.playGlitch(ctx, startAt);
          break;
        case 'ending':
          this.playEnding(ctx, startAt);
          break;
      }
    } catch {
      // Never propagate Web Audio errors to console or UI loop
    }
  }

  playGlitchPulse(): void {
    this.play('glitch');
  }

  playForEvents(events: GameEvent[]): void {
    if (this.muted || events.length === 0) return;

    try {
      let nextDelay = 0;

      const filterChoice = events.find((e) => e.type === 'FILTER_CHOICE_MADE');
      if (filterChoice && filterChoice.type === 'FILTER_CHOICE_MADE') {
        this.play(filterChoice.choice === 'BREAK' ? 'glitch' : 'heal', 0);
        return;
      }

      const attacked = events.find((e) => e.type === 'ATTACKED');
      const usedItem = events.find((e) => e.type === 'ITEM_USED');
      const stepped = events.some(
        (e) =>
          e.type === 'PLAYER_MOVED' ||
          e.type === 'ROOM_CHANGED' ||
          e.type === 'PLAYER_WAITED' ||
          e.type === 'NPC_TALKED',
      );

      if (attacked && attacked.type === 'ATTACKED') {
        this.play(attacked.triggeredTraitId ? 'traitHit' : 'attack', nextDelay);
        nextDelay += 0.09;
      } else if (usedItem) {
        this.play('heal', nextDelay);
        nextDelay += 0.09;
      } else if (stepped) {
        this.play('step', nextDelay);
        nextDelay += 0.06;
      }

      if (events.some((e) => e.type === 'ENEMY_ATTACKED')) {
        this.play('hit', nextDelay);
        nextDelay += 0.09;
      }

      const crossedIntoGlitch = events.some(
        (e) =>
          e.type === 'LUCIDITY_CHANGED' &&
          e.newLucidity - e.amount < 30 &&
          e.newLucidity >= 30 &&
          e.newLucidity < 70,
      );
      const hasAmbientOrThreshold = events.some(
        (e) =>
          e.type === 'FILTER_THRESHOLD_REACHED' ||
          e.type === 'ROOM_AMBIENT_OBSERVED',
      );

      if (crossedIntoGlitch || hasAmbientOrThreshold) {
        this.play('glitch', nextDelay);
        nextDelay += 0.08;
      }

      if (events.some((e) => e.type === 'GAME_ENDED')) {
        this.play('ending', nextDelay);
      }
    } catch {
      // Safe no-op
    }
  }

  private installFirstInteractionUnlock(): void {
    try {
      if (this.unlockBound || typeof window === 'undefined') return;
      this.unlockBound = true;

      const onFirstGesture = (): void => {
        this.unlock();
        if (this.ctx && this.ctx.state === 'running') {
          window.removeEventListener('pointerdown', onFirstGesture, true);
          window.removeEventListener('keydown', onFirstGesture, true);
          window.removeEventListener('click', onFirstGesture, true);
        }
      };

      window.addEventListener('pointerdown', onFirstGesture, {
        capture: true,
        passive: true,
      });
      window.addEventListener('keydown', onFirstGesture, {
        capture: true,
        passive: true,
      });
      window.addEventListener('click', onFirstGesture, {
        capture: true,
        passive: true,
      });
    } catch {
      // Safe no-op
    }
  }

  private ensureContext(): AudioContext | null {
    try {
      const Ctor = resolveAudioContextConstructor();
      if (!Ctor) return null;
      if (!this.ctx) {
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private playStep(ctx: AudioContext, t: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(112, t);
    osc.frequency.exponentialRampToValueAtTime(56, t + 0.05);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.045, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  private playAttack(ctx: AudioContext, t: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(105, t + 0.08);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.065, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  private playTraitHit(ctx: AudioContext, t: number): void {
    const bodyOsc = ctx.createOscillator();
    const harmOsc = ctx.createOscillator();
    const gain = ctx.createGain();

    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(320, t);
    bodyOsc.frequency.exponentialRampToValueAtTime(175, t + 0.12);

    harmOsc.type = 'sine';
    harmOsc.frequency.setValueAtTime(520, t);
    harmOsc.frequency.exponentialRampToValueAtTime(780, t + 0.11);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.135);

    bodyOsc.connect(gain);
    harmOsc.connect(gain);
    gain.connect(ctx.destination);

    bodyOsc.start(t);
    harmOsc.start(t);
    bodyOsc.stop(t + 0.14);
    harmOsc.stop(t + 0.14);
  }

  private playHit(ctx: AudioContext, t: number): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.12);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.135);
  }

  private playHeal(ctx: AudioContext, t: number): void {
    const notes = [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const noteStart = t + idx * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteStart);

      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.linearRampToValueAtTime(0.06, noteStart + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteStart);
      osc.stop(noteStart + 0.115);
    });
  }

  private playGlitch(ctx: AudioContext, t: number): void {
    const duration = 0.075;
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      channel[i] = (Math.random() * 2 - 1) * 0.55;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1650, t);
    filter.Q.setValueAtTime(2.4, t);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(760, t);
    osc.frequency.setValueAtTime(410, t + 0.032);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.048, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    osc.connect(gain);
    gain.connect(ctx.destination);

    noise.start(t);
    osc.start(t);
    noise.stop(t + duration + 0.005);
    osc.stop(t + duration + 0.005);
  }

  private playEnding(ctx: AudioContext, t: number): void {
    const chord = [110, 164.81, 220];
    for (const freq of chord) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.04, t + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.54);
    }
  }
}
