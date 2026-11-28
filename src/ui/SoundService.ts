import type { GameEvent } from '../core/types';

export type SoundEffectName =
  | 'step'
  | 'attack'
  | 'traitHit'
  | 'hit'
  | 'heal'
  | 'pickup'
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
  private hasUnlockedOnce = false;

  constructor(initialMuted = false) {
    this.muted = Boolean(initialMuted);
    this.installInteractionUnlock();
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
      this.hasUnlockedOnce = true;
      if (!this.ctx) {
        this.ctx = new Ctor();
      }
      if ((this.ctx.state as string) !== 'running' && (this.ctx.state as string) !== 'closed') {
        void this.ctx.resume().catch(() => {});
      }
    } catch {
      // Safe no-op in headless/unsupported audio environments
    }
  }

  play(effect: SoundEffectName, delaySec = 0): void {
    if (this.muted) return;
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return;
      const state = ctx.state as string;
      if (state === 'closed') return;

      if (state === 'running') {
        this.hasUnlockedOnce = true;
        this.dispatchEffect(ctx, effect, delaySec);
        return;
      }

      void ctx
        .resume()
        .then(() => {
          if ((ctx.state as string) === 'running') {
            this.hasUnlockedOnce = true;
          }
          if (this.muted || (ctx.state as string) !== 'running') return;
          try {
            this.dispatchEffect(ctx, effect, delaySec);
          } catch {
            // Never propagate deferred Web Audio errors to console
          }
        })
        .catch(() => {});
    } catch {
      // Never propagate Web Audio errors to console or UI loop
    }
  }

  private dispatchEffect(ctx: AudioContext, effect: SoundEffectName, delaySec: number): void {
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
      case 'pickup':
        this.playPickup(ctx, startAt);
        break;
      case 'glitch':
        this.playGlitch(ctx, startAt);
        break;
      case 'ending':
        this.playEnding(ctx, startAt);
        break;
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

      const relicActivated = events.find((e) => e.type === 'RELIC_ACTIVATED');
      const attacked = events.find((e) => e.type === 'ATTACKED');
      const usedItem = events.find((e) => e.type === 'ITEM_USED');
      const hubRested = events.some((e) => e.type === 'HUB_RESTED');
      const hubAcquired = events.some(
        (e) =>
          e.type === 'HUB_RATION_BOUGHT' ||
          e.type === 'HUB_SUPPLY_CLAIMED' ||
          e.type === 'OBJECT_INSPECTED' ||
          e.type === 'RELIC_SHARD_SUBMITTED',
      );
      const pickedUpGround = events.some((e) => e.type === 'ITEM_PICKED_UP');
      const stepped = events.some(
        (e) =>
          e.type === 'PLAYER_MOVED' ||
          e.type === 'ROOM_CHANGED' ||
          e.type === 'PLAYER_WAITED' ||
          e.type === 'NPC_TALKED',
      );

      if (relicActivated) {
        this.play('traitHit', nextDelay);
        nextDelay += 0.08;
        this.play('heal', nextDelay);
        nextDelay += 0.09;
      } else if (attacked && attacked.type === 'ATTACKED') {
        this.play(attacked.triggeredTraitId ? 'traitHit' : 'attack', nextDelay);
        nextDelay += 0.09;
      } else if (usedItem || hubRested) {
        this.play('heal', nextDelay);
        nextDelay += 0.09;
      } else if (hubAcquired) {
        this.play('pickup', nextDelay);
        nextDelay += 0.08;
      } else if (stepped) {
        this.play('step', nextDelay);
        nextDelay += 0.06;
        if (pickedUpGround) {
          this.play('pickup', nextDelay);
          nextDelay += 0.07;
        }
      } else if (pickedUpGround) {
        this.play('pickup', nextDelay);
        nextDelay += 0.07;
      }

      if (
        !attacked &&
        !relicActivated &&
        events.some((e) => e.type === 'NPC_ATTACKED_NPC')
      ) {
        this.play('attack', nextDelay);
        nextDelay += 0.08;
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
          e.type === 'ROOM_AMBIENT_OBSERVED' ||
          e.type === 'RELIC_SHARD_GLITCHED',
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

  private installInteractionUnlock(): void {
    try {
      if (this.unlockBound || typeof window === 'undefined') return;
      this.unlockBound = true;

      const onGesture = (): void => {
        if (this.muted) return;
        this.unlock();
      };

      window.addEventListener('pointerdown', onGesture, {
        capture: true,
        passive: true,
      });
      window.addEventListener('touchend', onGesture, {
        capture: true,
        passive: true,
      });
      window.addEventListener('keydown', onGesture, {
        capture: true,
        passive: true,
      });
      window.addEventListener('click', onGesture, {
        capture: true,
        passive: true,
      });

      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          try {
            if (
              document.visibilityState === 'visible' &&
              this.hasUnlockedOnce &&
              !this.muted &&
              this.ctx
            ) {
              const state = this.ctx.state as string;
              if (state !== 'running' && state !== 'closed') {
                void this.ctx.resume().catch(() => {});
              }
            }
          } catch {
            // Safe no-op
          }
        });
      }
    } catch {
      // Safe no-op
    }
  }

  private getOrCreateContext(): AudioContext | null {
    try {
      const Ctor = resolveAudioContextConstructor();
      if (!Ctor) return null;
      if (!this.ctx) {
        this.ctx = new Ctor();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private playStep(ctx: AudioContext, t: number): void {
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(112, t);
    subOsc.frequency.exponentialRampToValueAtTime(56, t + 0.05);

    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.linearRampToValueAtTime(0.045, t + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

    const midOsc = ctx.createOscillator();
    const midGain = ctx.createGain();
    midOsc.type = 'triangle';
    midOsc.frequency.setValueAtTime(190, t);
    midOsc.frequency.exponentialRampToValueAtTime(95, t + 0.05);

    midGain.gain.setValueAtTime(0.0001, t);
    midGain.gain.linearRampToValueAtTime(0.06, t + 0.007);
    midGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    midOsc.connect(midGain);
    midGain.connect(ctx.destination);

    subOsc.start(t);
    midOsc.start(t);
    subOsc.stop(t + 0.06);
    midOsc.stop(t + 0.06);
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

  private playPickup(ctx: AudioContext, t: number): void {
    const notes = [659.25, 880];
    notes.forEach((freq, idx) => {
      const noteStart = t + idx * 0.05;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteStart);

      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.linearRampToValueAtTime(0.052, noteStart + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.085);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteStart);
      osc.stop(noteStart + 0.09);
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
    filter.frequency.setValueAtTime(1550, t);
    filter.Q.setValueAtTime(1.9, t);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(760, t);
    osc.frequency.setValueAtTime(410, t + 0.032);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.048, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    noise.connect(filter);
    osc.connect(filter);
    filter.connect(gain);
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
