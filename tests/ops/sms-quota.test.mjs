import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessSmsQuota } from '../../scripts/ops/sms-quota.mjs';

const policy = { threshold: 100, maxAgeMs: 500, now: 1_000 };

test('warns before exhaustion, including exactly at the threshold', () => {
  for (const [remaining, status] of [[101, 'healthy'], [100, 'low'], [1, 'low'], [0, 'exhausted']]) {
    assert.deepEqual(assessSmsQuota({ remaining, observedAt: 500 }, policy),
      { status, remaining, observedAt: 500 });
  }
});

test('missing, malformed, stale or future data cannot report a healthy balance', () => {
  for (const observation of [
    null, { remaining: '1000', observedAt: 900 }, { remaining: -1, observedAt: 900 },
    { remaining: 1000, observedAt: 499 }, { remaining: 0, observedAt: 1_001 },
  ]) {
    assert.equal(assessSmsQuota(observation, policy).status, 'unknown');
  }
  assert.throws(() => assessSmsQuota(null, { ...policy, threshold: 0 }), RangeError);
});
