// Additive state; existing history and ownership are never backfilled from membership.
export async function migratePlayer(tx) {
  await tx.run(
    "ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS player_state_json TEXT",
  );
  await tx.run(`CREATE TABLE IF NOT EXISTS player_feedback (
 session_id BIGINT PRIMARY KEY REFERENCES game_sessions(id) ON DELETE RESTRICT,
 account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 identity_id BIGINT NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
 questionnaire_json TEXT NOT NULL, answers_json TEXT NOT NULL, created_at BIGINT NOT NULL)`);
  await tx.run(`CREATE TABLE IF NOT EXISTS player_ai_feedback (
 session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE RESTRICT,
 card_code TEXT NOT NULL, input_hash TEXT NOT NULL, feedback TEXT NOT NULL,
 provider TEXT NOT NULL, model TEXT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(session_id,card_code,input_hash))`);
}
