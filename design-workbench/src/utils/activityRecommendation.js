const LIVE_STATUSES = new Set(['active', 'live', 'ongoing', '进行中', '可参与']);
const BLOCKED_STATUSES = new Set(['ended', 'closed', 'cancelled', 'canceled', 'suspended', '已结束', '已取消', '已停用']);

function timestamp(activity, keys) {
  for (const key of keys) {
    const value = activity?.[key];
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function coordinates(activity) {
  const source = activity?.coordinates || activity?.locationCoordinates || activity || {};
  const latitude = Number(source.latitude ?? source.lat);
  const longitude = Number(source.longitude ?? source.lng ?? source.lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function distanceInKm(from, to) {
  if (!from || !to) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6371;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

function activityState(activity, now) {
  const status = String(activity?.status || 'active').toLowerCase();
  const startsAt = timestamp(activity, ['startsAt', 'startedAt', 'started_at', 'startTime']);
  const endsAt = timestamp(activity, ['endsAt', 'endedAt', 'ended_at', 'endTime']);
  if (BLOCKED_STATUSES.has(status) || (endsAt && endsAt < now)) return { key: 'ended', label: '已结束', startsAt, endsAt };
  if (startsAt && startsAt > now) return { key: 'upcoming', label: '即将开始', startsAt, endsAt };
  if ((startsAt && startsAt <= now && (!endsAt || endsAt >= now)) || LIVE_STATUSES.has(status)) return { key: 'live', label: '进行中', startsAt, endsAt };
  return { key: 'available', label: '可参与', startsAt, endsAt };
}

function scoreActivity(activity, position, now) {
  const state = activityState(activity, now);
  if (state.key === 'ended') return null;
  const distanceKm = distanceInKm(position, coordinates(activity));
  let score = state.key === 'live' ? 10_000 : state.key === 'upcoming' ? 7_000 : 5_000;
  if (state.key === 'upcoming' && state.startsAt) score -= Math.min(2400, Math.max(0, state.startsAt - now) / 3_600_000 * 40);
  if (distanceKm != null) score -= Math.min(distanceKm, 200) * 24;
  return { activity, state, distanceKm, score };
}

export function recommendActivity(activities, position = null, now = Date.now()) {
  return activities
    .map((activity) => scoreActivity(activity, position, now))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || Number(right.activity.id || 0) - Number(left.activity.id || 0))[0] || null;
}

export function activityRecommendationLabel(recommendation) {
  if (!recommendation) return '可参与';
  const distance = recommendation.distanceKm;
  return distance == null ? recommendation.state.label : `${recommendation.state.label} · ${distance < 1 ? `${Math.max(1, Math.round(distance * 1000))}m` : `${distance.toFixed(1)}km`}`;
}
