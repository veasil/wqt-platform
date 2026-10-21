// Additive: historical activities are never guessed from time or organizer text.
export async function migrateAutomaticActivities(tx) {
  await tx.run('ALTER TABLE activities ADD COLUMN IF NOT EXISTS auto_day TEXT');
  await tx.run('ALTER TABLE activities ADD COLUMN IF NOT EXISTS auto_location TEXT');
  await tx.run('CREATE UNIQUE INDEX IF NOT EXISTS activities_auto_day_location ON activities(auto_day,auto_location) WHERE auto_day IS NOT NULL AND auto_location IS NOT NULL');
}
