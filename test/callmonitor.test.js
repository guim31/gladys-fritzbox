import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallMonitor, CallTracker, parseLine } from '../src/fritz/callmonitor.js';
import { createFakeFritz, fixture } from './helpers/fakeFritz.js';

const LINES = fixture('callmonitor.txt').trim().split('\n');
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the four kinds of lines are parsed; anything else is ignored', () => {
  assert.deepEqual(parseLine(LINES[0]), {
    type: 'RING',
    id: '0',
    number: '01707654321',
    line: '301234567',
  });
  assert.deepEqual(parseLine(LINES[1]), {
    type: 'CONNECT',
    id: '0',
    extension: '10',
    number: '01707654321',
  });
  assert.deepEqual(parseLine(LINES[2]), { type: 'DISCONNECT', id: '0', duration: 203 });
  assert.deepEqual(parseLine(LINES[8]), {
    type: 'CALL',
    id: '3',
    extension: '11',
    line: '301234567',
    number: '0301234567',
  });
  assert.equal(parseLine('hello'), null);
  assert.equal(parseLine('12.10.26 18:02:11;HOLD;0;1;'), null);
  assert.equal(parseLine('yesterday;RING;0;1;2;'), null);
});

test('a session of calls gives the scene events', () => {
  let now = 0;
  const tracker = new CallTracker({ now: () => now });
  const fired = [];
  for (const line of LINES) {
    now += 5000;
    fired.push(...tracker.handle(parseLine(line)));
  }
  assert.deepEqual(fired, [
    {
      key: 'incoming_call',
      data: { number: '01707654321', line: '301234567', direction: 'incoming' },
    },
    {
      key: 'call_ended',
      data: {
        number: '01707654321',
        line: '301234567',
        direction: 'incoming',
        duration_seconds: 203,
      },
    },
    {
      key: 'incoming_call',
      data: { number: '089123456', line: '301234567', direction: 'incoming' },
    },
    {
      key: 'missed_call',
      data: {
        number: '089123456',
        line: '301234567',
        direction: 'incoming',
        ring_seconds: 5,
        answering_machine: 0,
      },
    },
    { key: 'incoming_call', data: { number: '', line: '301234567', direction: 'incoming' } },
    {
      key: 'missed_call',
      data: {
        number: '',
        line: '301234567',
        direction: 'incoming',
        ring_seconds: 5,
        answering_machine: 1,
      },
    },
    {
      key: 'call_ended',
      data: { number: '', line: '301234567', direction: 'incoming', duration_seconds: 30 },
    },
    {
      key: 'call_ended',
      data: {
        number: '0301234567',
        line: '301234567',
        direction: 'outgoing',
        duration_seconds: 250,
      },
    },
  ]);
  assert.equal(tracker.calls.size, 0);
});

test('a DISCONNECT without its RING, and a call left open for hours, are forgotten', () => {
  let now = 0;
  const tracker = new CallTracker({ now: () => now });
  assert.deepEqual(tracker.handle(parseLine('12.10.26 18:00:00;DISCONNECT;7;0;')), []);
  tracker.handle(parseLine(LINES[0]));
  now += 7 * 60 * 60 * 1000;
  tracker.handle(parseLine('12.10.26 18:00:00;CALL;5;11;1;2;SIP0;'));
  assert.deepEqual([...tracker.calls.keys()], ['5']);
});

test('the monitor reads lines split anywhere, and reconnects with a growing delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = createFakeFritz();
  const lines = [];
  const states = [];
  const monitor = new CallMonitor({
    host: fake.host,
    connect: fake.connectSocket,
    onLine: (event) => lines.push(event.type),
    onState: (state) => states.push(state),
  });
  monitor.start();
  await flush();
  assert.deepEqual(states, ['connected']);
  const [socket] = fake.sockets;
  socket.emit('data', '12.10.26 18:02:11;RING;0;0170;3012');
  socket.emit('data', '34567;SIP0;\r\n12.10.26 18:02:19;CONNECT;0;10;0170;\n');
  assert.deepEqual(lines, ['RING', 'CONNECT']);

  socket.destroy();
  await flush();
  assert.deepEqual(states, ['connected', 'lost']);
  fake.callMonitor = false; // #96*4*: the box refuses now
  t.mock.timers.tick(5000);
  await flush();
  await flush();
  assert.deepEqual(states, ['connected', 'lost', 'refused']);
  fake.callMonitor = true;
  t.mock.timers.tick(9999);
  await flush();
  assert.equal(fake.sockets.length, 0, 'second retry after 10 s, not before');
  t.mock.timers.tick(1);
  await flush();
  await flush();
  assert.equal(fake.sockets.length, 1);
  assert.equal(states.at(-1), 'connected');
  monitor.stop();
  await flush();
  assert.equal(fake.sockets.length, 0);
});
