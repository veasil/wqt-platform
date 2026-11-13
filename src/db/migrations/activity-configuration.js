export async function migrateActivityConfiguration(tx) {
  await tx.run('ALTER TABLE activities ADD COLUMN IF NOT EXISTS game_config_json TEXT');
  await tx.run(`CREATE TABLE IF NOT EXISTS activity_creation_notifications (
    activity_id BIGINT PRIMARY KEY REFERENCES activities(id) ON DELETE RESTRICT,
    created_at BIGINT NOT NULL, read_at BIGINT,
    read_by_identity_id BIGINT REFERENCES identities(id) ON DELETE RESTRICT)`);
}
