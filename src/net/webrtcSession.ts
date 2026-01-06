import { WsServerMsg } from './protocol';

export type RtcRole = 'host' | 'guest';

export type RtcStatus =
  | { phase: 'idle' }
  | { phase: 'signaling' }
  | { phase: 'connecting' }
  | { phase: 'connected' }
  | { phase: 'failed'; reason: string }
  | { phase: 'closed' };

export type RtcSessionOptions = {
  role: RtcRole;
  roomId: string;
  sendSignal: (msg: WsServerMsg) => void;
  onStatus: (status: RtcStatus) => void;
  onRttMs?: (rttMs: number | null) => void;
  onDataMessage?: (data: string) => void;
};

const ICE_SERVERS: RTCIceServer[] = [
  // Free public STUN. Works in many cases; can be replaced later.
  { urls: ['stun:stun.l.google.com:19302'] },
];

export class WebRtcSession {
  private opts: RtcSessionOptions;
  private pc: RTCPeerConnection | null = null;
  public dc: RTCDataChannel | null = null;
  private closed = false;
  private pendingIce: string[] = [];
  private remoteDescSet = false;
  private pingTimer: number | null = null;
  private pingSeq = 0;
  private pendingPing = new Map<number, number>();

  constructor(opts: RtcSessionOptions) {
    this.opts = opts;
  }

  start() {
    if (this.pc || this.closed) return;
    this.opts.onStatus({ phase: 'signaling' });

    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;

    pc.addEventListener('icecandidate', (e) => {
      if (!e.candidate) return;
      this.opts.sendSignal({
        type: 'signal:ice',
        roomId: this.opts.roomId,
        candidate: JSON.stringify(e.candidate),
      });
    });

    pc.addEventListener('connectionstatechange', () => {
      const st = pc.connectionState;
      if (st === 'connected') this.opts.onStatus({ phase: 'connected' });
      else if (st === 'connecting') this.opts.onStatus({ phase: 'connecting' });
      else if (st === 'failed') this.opts.onStatus({ phase: 'failed', reason: 'pc_failed' });
      else if (st === 'closed') this.opts.onStatus({ phase: 'closed' });
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      const st = pc.iceConnectionState;
      if (st === 'failed') this.opts.onStatus({ phase: 'failed', reason: 'ice_failed' });
    });

    if (this.opts.role === 'host') {
      this.dc = pc.createDataChannel('hockey', { ordered: true });
      this.attachDataChannel(this.dc);
      void this.createAndSendOffer();
    } else {
      pc.addEventListener('datachannel', (e) => {
        this.dc = e.channel;
        this.attachDataChannel(this.dc);
      });
    }
  }

  async renegotiateOffer() {
    if (this.closed) return;
    if (!this.pc) this.start();
    if (this.opts.role !== 'host') return;
    await this.createAndSendOffer();
  }

  close() {
    this.closed = true;
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.opts.onRttMs?.(null);
    try {
      this.dc?.close();
    } catch {
      // ignore
    }
    try {
      this.pc?.close();
    } catch {
      // ignore
    }
    this.dc = null;
    this.pc = null;
    this.opts.onStatus({ phase: 'closed' });
  }

  isDataChannelOpen() {
    return this.dc?.readyState === 'open';
  }

  onSignal(msg: WsServerMsg) {
    if (this.closed) return;
    if (!this.pc) this.start();
    const pc = this.pc;
    if (!pc) return;

    if (msg.type === 'signal:offer') {
      void this.onOffer(msg.sdp);
      return;
    }
    if (msg.type === 'signal:answer') {
      void this.onAnswer(msg.sdp);
      return;
    }
    if (msg.type === 'signal:ice') {
      void this.onIce(msg.candidate);
      return;
    }
  }

  private attachDataChannel(dc: RTCDataChannel) {
    dc.addEventListener('open', () => this.opts.onStatus({ phase: 'connected' }));
    dc.addEventListener('close', () => this.opts.onStatus({ phase: 'closed' }));
    dc.addEventListener('error', () => this.opts.onStatus({ phase: 'failed', reason: 'dc_error' }));

    dc.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      this.opts.onDataMessage?.(e.data);
      if (!e.data.startsWith('ping:') && !e.data.startsWith('pong:')) return;
      const [kind, seqStr, tStr] = e.data.split(':');
      const seq = Number(seqStr);
      const t = Number(tStr);
      if (!Number.isFinite(seq) || !Number.isFinite(t)) return;

      if (kind === 'ping') {
        // Mirror back with original send time.
        try {
          dc.send(`pong:${seq}:${t}`);
        } catch {
          // ignore
        }
      } else if (kind === 'pong') {
        const start = this.pendingPing.get(seq);
        if (start === undefined) return;
        this.pendingPing.delete(seq);
        const rtt = Math.max(0, performance.now() - start);
        this.opts.onRttMs?.(Math.round(rtt));
      }
    });

    if (this.pingTimer === null) {
      this.pingTimer = window.setInterval(() => {
        if (dc.readyState !== 'open') return;
        const seq = ++this.pingSeq;
        const now = performance.now();
        this.pendingPing.set(seq, now);
        // encode send-time for symmetry/debug; rtt uses local start time.
        try {
          dc.send(`ping:${seq}:${Math.round(now)}`);
        } catch {
          // ignore
        }
        // Drop old entries so map doesn't grow forever.
        for (const [k, v] of this.pendingPing) {
          if (now - v > 10_000) this.pendingPing.delete(k);
        }
      }, 1000);
    }
  }

  private async createAndSendOffer() {
    const pc = this.pc;
    if (!pc) return;
    this.opts.onStatus({ phase: 'connecting' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.opts.sendSignal({
      type: 'signal:offer',
      roomId: this.opts.roomId,
      sdp: offer.sdp || '',
    });
  }

  private async onOffer(sdp: string) {
    const pc = this.pc;
    if (!pc) return;
    await pc.setRemoteDescription({ type: 'offer', sdp });
    this.remoteDescSet = true;
    await this.flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.opts.sendSignal({ type: 'signal:answer', roomId: this.opts.roomId, sdp: answer.sdp || '' });
  }

  private async onAnswer(sdp: string) {
    const pc = this.pc;
    if (!pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp });
    this.remoteDescSet = true;
    await this.flushIce();
  }

  private async onIce(candidateJson: string) {
    if (!this.pc) return;
    if (!this.remoteDescSet) {
      this.pendingIce.push(candidateJson);
      return;
    }
    try {
      const cand = JSON.parse(candidateJson);
      await this.pc.addIceCandidate(cand);
    } catch {
      // ignore
    }
  }

  private async flushIce() {
    if (!this.pc) return;
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) {
      try {
        const cand = JSON.parse(c);
        await this.pc.addIceCandidate(cand);
      } catch {
        // ignore
      }
    }
  }
}
