type ToneOptions = { freq: number; to?: number; type?: OscillatorType; dur: number; gain: number; delay?: number; attack?: number };
type NoiseOptions = { dur: number; gain: number; filter: BiquadFilterType; freq: number; to?: number; q?: number };

// 五声音阶。边墙的拨弦声和结尾重画球路时的音都取自这里，随便怎么撞都不会难听。
const SCALE = [0, 2, 4, 7, 9];
const noteFrequency = (step: number) => 110 * Math.pow(2, (12 * Math.floor(step / SCALE.length) + SCALE[step % SCALE.length]) / 12);

/**
 * 全部声音由 Web Audio 即时合成，不依赖音频文件。
 * 浏览器要求先有用户操作才能出声：界面在首次点击或按键时调用 unlock。
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private level = 0.7;
  private lastPlayed = new Map<string, number>();

  unlock() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level;
      this.master.connect(this.ctx.destination);
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.level = muted ? 0 : 0.7;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.02);
  }

  /** 球拍击球：一声闷响，越快越亮。 */
  hit(burst: boolean, speed: number) {
    if (burst) {
      this.tone({ freq: 120, to: 38, dur: 0.42, gain: 0.8 });
      this.burst({ dur: 0.4, gain: 0.5, filter: 'lowpass', freq: 5200, to: 220 });
      return;
    }
    if (this.throttled('hit', 40)) return;
    const strength = Math.max(0, Math.min(1, speed / 50));
    this.tone({ freq: 190 + strength * 150, to: 70, dur: 0.11, gain: 0.3 + strength * 0.5 });
    this.burst({ dur: 0.035, gain: 0.18 + strength * 0.35, filter: 'bandpass', freq: 1800 + strength * 2200, q: 1.2 });
  }

  /** 边墙被拨了一下。step 是五声音阶上的第几个音。 */
  pluck(step: number, power: number) {
    if (this.throttled(`pluck${step}`, 50)) return;
    const strength = Math.max(0, Math.min(1, power / 40));
    const freq = noteFrequency(step);
    this.tone({ freq, type: 'triangle', dur: 0.7, gain: 0.07 + strength * 0.2 });
    this.tone({ freq: freq * 2, dur: 0.25, gain: 0.03 + strength * 0.08 });
  }

  /** 屏障皮筋把球兜住弹回。 */
  band(power: number) {
    if (this.throttled('band', 60)) return;
    const strength = Math.max(0, Math.min(1, power / 20));
    this.tone({ freq: 104, to: 72, type: 'triangle', dur: 0.45, gain: 0.2 + strength * 0.25 });
    this.tone({ freq: 208, to: 150, dur: 0.18, gain: 0.08 });
  }

  /** 皮筋绷断。 */
  snap() {
    this.tone({ freq: 620, to: 80, dur: 0.16, gain: 0.4 });
    this.burst({ dur: 0.05, gain: 0.4, filter: 'highpass', freq: 2400 });
  }

  goal() {
    this.tone({ freq: 260, to: 52, dur: 0.7, gain: 0.45 });
  }

  countdown() { this.tone({ freq: 440, dur: 0.09, gain: 0.2, type: 'triangle' }); }
  serve() { this.tone({ freq: 880, dur: 0.14, gain: 0.22, type: 'triangle' }); }

  /** 一局结束后重画第 index 个进球的球路时的一个音，一个比一个高。 */
  recap(index: number) {
    const freq = noteFrequency(5 + index);
    this.tone({ freq, type: 'triangle', dur: 1.1, gain: 0.2, attack: 0.01 });
    this.tone({ freq: freq * 2, dur: 0.5, gain: 0.06 });
  }

  click() { this.tone({ freq: 1250, to: 900, dur: 0.03, gain: 0.08 }); }

  private throttled(key: string, minGapMs: number) {
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < minGapMs) return true;
    this.lastPlayed.set(key, now);
    return false;
  }

  private tone({ freq, to, type = 'sine', dur, gain, delay = 0, attack = 0.004 }: ToneOptions) {
    if (!this.ctx || !this.master || this.level === 0) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private burst({ dur, gain, filter, freq, to, q = 0.7 }: NoiseOptions) {
    if (!this.ctx || !this.master || !this.noise || this.level === 0) return;
    const start = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const shape = this.ctx.createBiquadFilter();
    shape.type = filter;
    shape.Q.value = q;
    shape.frequency.setValueAtTime(freq, start);
    if (to) shape.frequency.exponentialRampToValueAtTime(to, start + dur);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    source.connect(shape).connect(amp).connect(this.master);
    source.start(start, Math.random() * 0.5);
    source.stop(start + dur + 0.02);
  }
}

export const sfx = new Sfx();
