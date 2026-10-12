// -----------------------------------------------------------------------------
// The FRITZ!Box call monitor: a plain TCP stream on port 1012, switched on
// from a phone plugged into the box by dialing #96*5* (#96*4* switches it
// off). One line per event, fields separated by semicolons (format by AVM,
// also read by fritzconnection and Home Assistant `fritzbox_callmonitor`):
//
//   28.11.20 15:17:43;RING;2;<caller>;<called line>;SIP0;
//   28.11.20 15:17:43;CALL;1;<extension>;<own line>;<called>;SIP0;
//   28.11.20 15:17:47;CONNECT;2;<extension>;<other party>;
//   28.11.20 15:17:50;DISCONNECT;2;<duration in seconds>;
//
// `CallTracker` turns them into the integration's scene events:
//   incoming_call  the phone rings (RING);
//   missed_call    an incoming call ended without a person answering it
//                  (no CONNECT, or the answering machine took it: extensions
//                  40 to 49 are the answering machines of the box);
//   call_ended     a call that was answered ended (both directions).
//
// Phone numbers are personal data: nothing here logs them.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'fritzbox-calls' });

export const CALL_MONITOR_PORT = 1012;
export const TRIGGERS = {
  INCOMING: 'incoming_call',
  MISSED: 'missed_call',
  ENDED: 'call_ended',
};

const ANSWERING_MACHINE = /^4\d$/;
// A call whose DISCONNECT never came (the box restarted…) is forgotten.
const STALE_CALL_MS = 6 * 60 * 60 * 1000;
const MAX_LINE = 1024;

/** One line of the call monitor, or null when it is not one. */
export function parseLine(line) {
  const parts = String(line ?? '')
    .trim()
    .split(';');
  if (parts.length < 4) {
    return null;
  }
  const [date, type, id] = parts;
  if (!/^\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(date) || !/^\d+$/.test(id)) {
    return null;
  }
  switch (type) {
    case 'RING':
      return { type, id, number: parts[3] ?? '', line: parts[4] ?? '' };
    case 'CALL':
      return { type, id, extension: parts[3] ?? '', line: parts[4] ?? '', number: parts[5] ?? '' };
    case 'CONNECT':
      return { type, id, extension: parts[3] ?? '', number: parts[4] ?? '' };
    case 'DISCONNECT': {
      const duration = Number(parts[3]);
      return { type, id, duration: Number.isFinite(duration) ? duration : 0 };
    }
    default:
      return null;
  }
}

export class CallTracker {
  /**
   * @param {object} [options]
   * @param {Function} [options.now] clock in ms
   */
  constructor({ now } = {}) {
    this.now = now ?? (() => Date.now());
    this.calls = new Map();
  }

  /**
   * Fold one parsed line in; resolves the scene events it produces:
   * `[{ key, data: { number, line, direction, … } }]` (no name: the caller
   * adds it from the phone book).
   */
  handle(event) {
    if (!event) {
      return [];
    }
    const now = this.now();
    for (const [id, call] of this.calls) {
      if (now - call.since > STALE_CALL_MS) {
        this.calls.delete(id);
      }
    }
    switch (event.type) {
      case 'RING':
        this.calls.set(event.id, {
          direction: 'incoming',
          number: event.number,
          line: event.line,
          since: now,
          connectedAt: null,
          answeringMachine: false,
        });
        return [
          {
            key: TRIGGERS.INCOMING,
            data: { number: event.number, line: event.line, direction: 'incoming' },
          },
        ];
      case 'CALL':
        this.calls.set(event.id, {
          direction: 'outgoing',
          number: event.number,
          line: event.line,
          since: now,
          connectedAt: null,
          answeringMachine: false,
        });
        return [];
      case 'CONNECT': {
        const call = this.calls.get(event.id);
        if (call) {
          call.connectedAt = now;
          call.answeringMachine = ANSWERING_MACHINE.test(event.extension);
        }
        return [];
      }
      case 'DISCONNECT': {
        const call = this.calls.get(event.id);
        this.calls.delete(event.id);
        if (!call) {
          return [];
        }
        const base = { number: call.number, line: call.line, direction: call.direction };
        const events = [];
        if (call.direction === 'incoming' && (call.connectedAt === null || call.answeringMachine)) {
          events.push({
            key: TRIGGERS.MISSED,
            data: {
              ...base,
              ring_seconds: Math.round(((call.connectedAt ?? now) - call.since) / 1000),
              answering_machine: call.answeringMachine ? 1 : 0,
            },
          });
        }
        if (call.connectedAt !== null) {
          events.push({
            key: TRIGGERS.ENDED,
            data: { ...base, duration_seconds: event.duration },
          });
        }
        return events;
      }
      default:
        return [];
    }
  }
}

/**
 * Keeps a TCP connection to the call monitor, reconnecting with a growing
 * delay (5 s to 5 min), and hands every parsed line to `onLine`.
 */
export class CallMonitor {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {(event: object) => void} options.onLine
   * @param {(state: 'connected'|'refused'|'lost') => void} [options.onState]
   * @param {Function} [options.connect] test seam: `({ host, port }) => socket`
   * @param {object} [options.delays] `{ minMs, maxMs }`
   */
  constructor({ host, port = CALL_MONITOR_PORT, onLine, onState, connect, delays = {} }) {
    this.host = host;
    this.port = port;
    this.onLine = onLine;
    this.onState = onState ?? (() => {});
    this.connect = connect ?? ((target) => net.createConnection(target));
    this.minDelay = delays.minMs ?? 5000;
    this.maxDelay = delays.maxMs ?? 5 * 60 * 1000;
    this.delay = this.minDelay;
    this.socket = null;
    this.timer = null;
    this.stopped = false;
    this.state = null;
  }

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.socket?.destroy();
    this.socket = null;
  }

  setState(state) {
    if (state !== this.state) {
      this.state = state;
      this.onState(state);
    }
  }

  open() {
    if (this.stopped) {
      return;
    }
    let buffer = '';
    let opened = false;
    const socket = this.connect({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setEncoding?.('utf8');
    socket.setKeepAlive?.(true, 60000);
    socket.on('connect', () => {
      opened = true;
      this.delay = this.minDelay;
      logger.info(`Call monitor connected (${this.host}:${this.port})`);
      this.setState('connected');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      if (buffer.length > MAX_LINE) {
        buffer = '';
      }
      for (const line of lines) {
        const event = parseLine(line);
        if (event) {
          this.onLine(event);
        }
      }
    });
    socket.on('error', (err) => {
      if (!opened) {
        logger.warn(`Call monitor unavailable (${err.code ?? err.message})`);
        this.setState(err.code === 'ECONNREFUSED' ? 'refused' : 'lost');
      }
    });
    socket.on('close', () => {
      if (this.socket !== socket || this.stopped) {
        return;
      }
      this.socket = null;
      if (opened) {
        logger.warn('Call monitor connection lost');
        this.setState('lost');
      }
      this.timer = setTimeout(() => this.open(), this.delay);
      this.timer.unref?.();
      this.delay = Math.min(this.delay * 2, this.maxDelay);
    });
  }
}
