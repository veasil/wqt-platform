// Additive migration: historical ownership is unknown until independently verified.
// Never infer it from the creator's current organization or an activity association.
export async function migrateSessionOwnership(tx) {
  await tx.get("SELECT pg_advisory_xact_lock(20260912, 1)");
  await tx.run(
    "ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS organization_id BIGINT",
  );
  await tx.run(
    "ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS ownership_kind TEXT NOT NULL DEFAULT 'legacy_unknown'",
  );
  await tx.run(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_sessions_organization_fk' AND conrelid = 'game_sessions'::regclass) THEN
      ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_sessions_ownership_check' AND conrelid = 'game_sessions'::regclass) THEN
      ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_ownership_check CHECK (
        (ownership_kind = 'organization' AND organization_id IS NOT NULL) OR
        (ownership_kind IN ('personal', 'legacy_unknown') AND organization_id IS NULL)
      );
    END IF;
  END $$`);
  await tx.run(
    "CREATE INDEX IF NOT EXISTS idx_game_sessions_organization ON game_sessions(organization_id, started_at DESC) WHERE ownership_kind = 'organization'",
  );
  await tx.run(`CREATE OR REPLACE FUNCTION wqt_guard_session_ownership() RETURNS trigger AS $$
    BEGIN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.ownership_kind IS DISTINCT FROM OLD.ownership_kind THEN
        RAISE EXCEPTION 'Session ownership is immutable; a reviewed migration is required' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
  $$ LANGUAGE plpgsql`);
  await tx.run(
    "DROP TRIGGER IF EXISTS game_sessions_immutable_ownership ON game_sessions",
  );
  await tx.run(`CREATE TRIGGER game_sessions_immutable_ownership
    BEFORE UPDATE OF organization_id, ownership_kind ON game_sessions
    FOR EACH ROW EXECUTE FUNCTION wqt_guard_session_ownership()`);
  await tx.run(`CREATE TABLE IF NOT EXISTS session_files (
    id UUID PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE RESTRICT,
    user_id BIGINT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size BIGINT NOT NULL CHECK (size >= 0),
    created_at BIGINT NOT NULL
  )`);
  await tx.run(
    "CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id)",
  );
}
