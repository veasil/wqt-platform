// Add a write guard without rewriting or silently ending historical duplicate bindings.
export async function installOrganizationBindingUniqueness(tx) {
  await tx.run(`CREATE OR REPLACE FUNCTION wqt_guard_organization_identity_binding() RETURNS trigger AS $$
    DECLARE target_organization BIGINT;
    BEGIN
      IF NEW.ended_at IS NULL THEN
        -- All current bindings for one identity serialize on the same existing row.
        PERFORM id FROM identities WHERE id=NEW.identity_id FOR UPDATE;
        SELECT organization_id INTO target_organization FROM accounts WHERE id=NEW.account_id;
        IF EXISTS (
          SELECT 1 FROM account_bindings b JOIN accounts a ON a.id=b.account_id
          WHERE b.identity_id=NEW.identity_id AND b.ended_at IS NULL
            AND a.organization_id=target_organization AND b.id IS DISTINCT FROM NEW.id
        ) THEN
          RAISE EXCEPTION 'duplicate key value violates unique constraint account_bindings_one_identity_per_organization'
            USING ERRCODE='23505', CONSTRAINT='account_bindings_one_identity_per_organization';
        END IF;
      END IF;
      RETURN NEW;
    END;
  $$ LANGUAGE plpgsql`);
  await tx.run('DROP TRIGGER IF EXISTS account_bindings_organization_identity_unique ON account_bindings');
  await tx.run(`CREATE TRIGGER account_bindings_organization_identity_unique
    BEFORE INSERT OR UPDATE OF account_id,identity_id,ended_at ON account_bindings
    FOR EACH ROW EXECUTE FUNCTION wqt_guard_organization_identity_binding()`);
}
