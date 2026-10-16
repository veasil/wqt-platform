import {operationHash} from '../../services/operation-hash.js';
import { withTransaction } from '../../db.js';
import { accountActor } from '../../platform/accounts/context.js';
import { domainError } from '../activities/link.js';

// The result and game changes commit together, so a retry after a lost response is safe.
export function gameTransaction(actor, input, kind, work) {
  if (typeof actor !== 'object') return withTransaction(work);
  const { requestId, ...payload } = input;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{8,120}$/.test(requestId))
    throw domainError(400, '关键写入需要8至120位唯一requestId');
  const hash = operationHash([kind,actor.identityId,actor.accountId,payload]);
  return withTransaction(async tx => {
    await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', [`wqt-game-operation:${requestId}`]);
    // Replays must still respect revocation; stored success is never an authorization bypass.
    if (!await accountActor(actor,tx.get,{lock:true})) throw domainError(403, '账号绑定已失效或已停用');
    const previous = await tx.get('SELECT * FROM account_operations WHERE request_id=?',[requestId]);
    if (previous) {
      if (previous.input_hash !== hash || previous.operation !== kind) throw domainError(409, 'requestId已用于不同操作');
      return JSON.parse(previous.result_json);
    }
    const result = await work(tx);
    await tx.run(`INSERT INTO account_operations(request_id,operation,actor_identity_id,actor_account_id,target_account_id,input_hash,result_json,created_at)
      VALUES(?,?,?,?,?,?,?,?)`,[requestId,kind,actor.identityId,actor.accountId,actor.accountId,hash,JSON.stringify(result),Date.now()]);
    return result;
  });
}
