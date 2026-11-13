// Name-only upgrade for the original player UAT fixture. Never changes authority or IDs.
export async function refreshDemoDirectoryNames(client) {
  const target=client.connectionParameters;
  const database=(await client.query('SELECT current_database() AS name')).rows[0].name;
  if(!['127.0.0.1','localhost','::1'].includes(target.host) || !/^wqt_r1_[a-f0-9]{20}$/.test(database) || target.database!==database) throw new Error('Owned loopback UAT database required');
  const mappings=[
    ['16600000888','林知夏','林知夏咨询师（虚构）'],
    ['16600000889','周禾','暖禾社工室（虚构）']
  ];
  let organizations=0,accounts=0;
  await client.query('BEGIN');
  try {
    for(const [phone,person,organization] of mappings) {
      const entries=[
        ['验收个人合伙人账号',`${person} · 守望者账号`,organization],
        ['验收平台管理账号',`${person} · 平台管理`,`${person} · 演示运营（虚构）`],
        ['验收免费账号',`${person} · 免费体验`,`${person} · 免费体验组织（虚构）`]
      ];
      for(const [oldName,newName,newOrganization] of entries) {
        // Require both the original exact organization/account names and a fixed synthetic identity.
        const matches=(await client.query(`SELECT a.id,a.organization_id FROM accounts a
          JOIN organizations o ON o.id=a.organization_id
          JOIN account_bindings b ON b.account_id=a.id AND b.ended_at IS NULL
          JOIN identities i ON i.id=b.identity_id
          WHERE i.phone=$1 AND a.name=$2 AND o.name=$3 FOR UPDATE OF a,o`,[phone,oldName,oldName+'组织'])).rows;
        for(const row of matches) {
          organizations+=(await client.query('UPDATE organizations SET name=$1 WHERE id=$2 AND name=$3',[newOrganization,row.organization_id,oldName+'组织'])).rowCount;
          accounts+=(await client.query('UPDATE accounts SET name=$1 WHERE id=$2 AND name=$3',[newName,row.id,oldName])).rowCount;
        }
      }
    }
    await client.query('COMMIT');
    return {organizations,accounts};
  } catch(error) {await client.query('ROLLBACK');throw error}
}
