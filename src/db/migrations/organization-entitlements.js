export async function installOrganizationEntitlements(tx) {
  await tx.run("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS entitlement_plan TEXT CHECK(entitlement_plan IN ('personal','group','city'))");
  // These two legacy checks coupled commercial tier and seat count. Other checks remain.
  await tx.run('ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_account_count_check');
  await tx.run('ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_check1');
  await tx.run(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='subscriptions'::regclass AND conname='subscriptions_capacity_range') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_capacity_range CHECK(account_count BETWEEN 1 AND 10000); END IF; END $$`);
  await tx.run(`CREATE OR REPLACE FUNCTION wqt_guard_subscription_capacity() RETURNS trigger AS $$
    DECLARE capacity INTEGER;
    BEGIN
      SELECT account_count INTO capacity FROM subscriptions WHERE organization_id=NEW.organization_id FOR UPDATE;
      IF NOT FOUND THEN
        SELECT CASE WHEN entitlement_plan IS NOT NULL THEN max_members ELSE NULL END INTO capacity
          FROM organizations WHERE id=NEW.organization_id FOR UPDATE;
      END IF;
      IF capacity IS NOT NULL AND (SELECT COUNT(*) FROM accounts WHERE organization_id=NEW.organization_id)>=capacity THEN
        RAISE EXCEPTION 'Organization account capacity exceeded' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
}
