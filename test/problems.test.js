import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProblemLog } from '../src/problems.js';

function recorder() {
  const lines = [];
  const log = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (message) => lines.push([level, message]),
    ]),
  );
  return { log, lines };
}

test('a repeated failure is logged once, then at debug; a new message is logged again', () => {
  const { log, lines } = recorder();
  const problems = new ProblemLog(log);
  assert.equal(problems.fail('read', 'timeout'), true);
  assert.equal(problems.fail('read', 'timeout'), false);
  assert.equal(problems.fail('read', 'timeout'), false);
  assert.equal(problems.fail('read', 'refused', 'error'), true);
  assert.deepEqual(lines, [
    ['warn', 'timeout'],
    ['debug', 'timeout'],
    ['debug', 'timeout'],
    ['error', 'refused'],
  ]);
});

test('the end of a problem is logged once, and only when it was logged', () => {
  const { log, lines } = recorder();
  const problems = new ProblemLog(log);
  assert.equal(problems.recover('read', 'back'), false);
  problems.fail('read', 'timeout');
  problems.fail('other', 'refused');
  assert.equal(problems.recover('read', 'back'), true);
  assert.equal(problems.recover('read', 'back'), false);
  assert.equal(problems.recover('other'), true);
  assert.deepEqual(lines, [
    ['warn', 'timeout'],
    ['warn', 'refused'],
    ['info', 'back'],
  ]);
  // After its end, the same failure is news again.
  assert.equal(problems.fail('read', 'timeout'), true);
});
