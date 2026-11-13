import assert from 'node:assert/strict';
import { startRuntime } from '../../../src/runtime.js';
import { dbGet, dbRun } from '../../../src/db.js';
import { cardsDbAll, cardsDbGet } from '../../../src/cards-db.js';
import { signToken } from '../../../src/middleware/auth.js';
import { rotateSession } from '../../../src/services/sessions.js';
import { PERMANENT_UNTIL } from '../../../src/account.js';

if (process.env.WQT_RUNTIME_TEST_CHILD !== '1') throw new Error('owned test harness required');

export async function run() {
  let runtime;
  try {
    runtime = await startRuntime({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    const org = await dbRun("INSERT INTO organizations(name, owner_user_id, valid_until) VALUES('card-test-org',0,?)", [PERMANENT_UNTIL]);
    const tokens = {};
    for (const role of ['watcher', 'enterprise', 'operator', 'boss']) {
      const user = await dbRun('INSERT INTO users(username, role, enterprise_id, valid_until) VALUES(?,?,?,?)', [`card-test-${role}`, role, role === 'enterprise' ? org.lastID : null, PERMANENT_UNTIL]);
      const row = await dbGet('SELECT * FROM users WHERE id=?', [user.lastID]);
      // Deliberately claim boss in JWT: authorization must use the current DB role.
      tokens[role] = { id: row.id, token: signToken({ ...row, role: 'boss', jti: await rotateSession(row.id) }) };
    }
    async function request(method, path, token, body = {}) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    const created = await request('POST', '/api/cards', tokens.boss.token, { key: 987654, safetyType: 'social', phase: '启蒙期', event: 'permission-test', options: [{ text: 'one', attributeEffects: {} }] });
    assert.equal(created.status, 200, JSON.stringify(created));
    const cardId = created.body.id;
    const card = await cardsDbGet('SELECT * FROM cards WHERE id=?', [cardId]);
    const writes = [
      ['POST', '/api/cards'], ['PUT', `/api/cards/${cardId}`], ['DELETE', `/api/cards/${cardId}`],
      ['POST', '/api/admin/card-groups'], ['PUT', '/api/admin/card-groups/1'], ['DELETE', '/api/admin/card-groups/1'],
      ['POST', '/api/admin/generate-card'], ['POST', '/api/admin/cards/bulk-release'], ['POST', '/api/admin/cards/bulk-publish'],
      ['POST', '/api/admin/cards/bulk-upsert'], ['DELETE', `/api/admin/cards/${cardId}/versions/${card.current_version_id}`],
      ['POST', `/api/admin/cards/${cardId}/notes`], ['PUT', `/api/admin/cards/${cardId}/notes/1`], ['DELETE', `/api/admin/cards/${cardId}/notes/1`],
      ['POST', `/api/admin/cards/${cardId}/branch`], ['PUT', `/api/admin/card-versions/${card.current_version_id}`],
      ['POST', `/api/admin/card-versions/${card.current_version_id}/promote`], ['POST', `/api/admin/cards/${cardId}/release`],
    ];
    async function snapshot() {
      return Promise.all(['cards', 'card_versions', 'cards_released', 'card_groups'].map(table => cardsDbAll(`SELECT * FROM ${table} ORDER BY id`)));
    }
    const before = await snapshot();
    for (const [method, path] of writes) {
      for (const role of ['watcher', 'enterprise', 'operator']) {
        const result = await request(method, path, tokens[role].token, { secretKey: 'sj0127wqt', authorId: tokens.boss.id, cards: [], cardIds: [cardId], card_ids: [cardId], name: 'unauthorized', content: 'unauthorized' });
        assert.equal(result.status, 403, `${role} ${method} ${path}: ${JSON.stringify(result)}`);
      }
      assert.equal((await request(method, path, null, { secretKey: 'sj0127wqt' })).status, 401, path);
    }
    assert.deepEqual(await snapshot(), before);
    // Boss can publish indirectly through group creation, and through the direct endpoint.
    const group = await request('POST', '/api/admin/card-groups', tokens.boss.token, { name: 'authorized', card_ids: [cardId] });
    assert.equal(group.status, 200, JSON.stringify(group));
    assert.equal((await request('POST', `/api/admin/cards/${cardId}/release`, tokens.boss.token)).status, 200);
    assert.equal((await request('POST','/api/admin/cards/bulk-publish',tokens.boss.token,{cardIds:[cardId]})).status,200);
    // A supplied author ID must not impersonate somebody else in the external upsert API.
    const upsert = await request('POST', '/api/admin/cards/bulk-upsert', tokens.boss.token, { authorId: tokens.watcher.id, cards: [{ key: 987655, safetyType: 'social', event: 'upsert', options: [] }] });
    assert.equal(upsert.status, 200, JSON.stringify(upsert));
    assert.equal((await cardsDbGet('SELECT author_id FROM cards WHERE key=?', [987655])).author_id, tokens.boss.id);
    await dbRun("UPDATE users SET role='watcher' WHERE id=?", [tokens.boss.id]);
    assert.equal((await request('DELETE', `/api/cards/${cardId}`, tokens.boss.token)).status, 403);
    assert.equal((await dbGet('SELECT role FROM users WHERE id=?', [tokens.operator.id])).role, 'operator');
    console.log(JSON.stringify({ cardWritesProtected: writes.length, authorRecorded: true, roleRevocation: true }));
  } finally { if (runtime) await runtime.stop(); }
}
