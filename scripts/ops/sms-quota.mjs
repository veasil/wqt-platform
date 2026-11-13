// The observation must come from the provider's balance source for this app.
export function assessSmsQuota(observation, { threshold, maxAgeMs, now = Date.now() }) {
  if (!Number.isSafeInteger(threshold) || threshold < 1 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || !Number.isFinite(now)) {
    throw new RangeError('Invalid SMS quota monitor configuration');
  }

  const { remaining, observedAt } = observation ?? {};
  if (!Number.isSafeInteger(remaining) || remaining < 0 || !Number.isFinite(observedAt)) {
    return { status: 'unknown', reason: 'invalid_observation' };
  }
  if (observedAt > now || now - observedAt > maxAgeMs) {
    return { status: 'unknown', reason: 'invalid_observation_time' };
  }
  if (remaining === 0) return { status: 'exhausted', remaining, observedAt };
  if (remaining <= threshold) return { status: 'low', remaining, observedAt };
  return { status: 'healthy', remaining, observedAt };
}
