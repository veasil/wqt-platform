export async function migrateDownloads(run) {
  await run(`CREATE TABLE IF NOT EXISTS download_releases (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, version TEXT NOT NULL,
    filename TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
    size BIGINT NOT NULL CHECK(size > 0), sha256 TEXT NOT NULL,
    created_at BIGINT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS download_events (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, release_id TEXT,
    user_id BIGINT, organization_id BIGINT,
    event TEXT NOT NULL, status INTEGER, created_at BIGINT NOT NULL)`);
  await run('CREATE INDEX IF NOT EXISTS download_events_created ON download_events(created_at DESC)');
}
