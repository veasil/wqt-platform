import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { readTeamApps, registeredRedirect, allowedTeamRequest } from '../src/platform/team-apps/registry.js';
import { pkceChallenge, authorizationInput } from '../src/platform/team-apps/routes.js';
import { signTeamToken, verifyTeamRequest, teamTokenBoundary, TEAM_AUDIENCE } from '../src/platform/team-apps/tokens.js';
import { authenticateIdentity } from '../src/platform/accounts/auth.js';

const app = {clientId:'emma', name:'Emma sample', redirectUris:['https://course.example/callback.html'], identityIds:[1]};
const env = entries => ({NODE_ENV:'production', WQT_TEAM_APPS:JSON.stringify(entries)});
test('application registry requires exact safe redirects and explicit identities', () => {
  assert.deepEqual(readTeamApps({}), []);
  assert.deepEqual(readTeamApps(env([app])), [app]);
  for (const uri of ['https://course.example', 'https://user:pass@course.example/callback', 'https://course.example/callback#fragment',
    'http://course.example/callback', 'https://course.example/callback?next=x', 'https://course.example/../callback']) {
    assert.throws(() => readTeamApps(env([{...app, redirectUris:[uri]}])), {status:503});
  }
  assert.throws(() => readTeamApps(env([app, app])), {status:503});
  assert.throws(() => readTeamApps(env([{...app, identityIds:[]}])), {status:503});
  assert.throws(() => readTeamApps(env([{...app, identityIds:['1']}])), {status:503});
  assert.throws(() => registeredRedirect(app, 'https://course.example/callback.html/extra'), {status:400});
  const local={...app, redirectUris:['http://127.0.0.1:8081/callback.html']};
  assert.throws(() => readTeamApps(env([local])), {status:503});
  assert.equal(readTeamApps({...env([local]),NODE_ENV:'test'}).length,1);
});

test('PKCE uses RFC 7636 S256 vector and rejects malformed verifiers', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  for (const value of ['', 'x'.repeat(42), 'x'.repeat(129), ' '.repeat(43), null]) assert.throws(() => pkceChallenge(value), {status:400});
});

test('player-only route scope is an exact allowlist, not a URL prefix', () => {
  for (const [method,path] of [['POST','/api/player/start'],['POST','/api/player/action'],['GET','/api/player/cards/1'],['GET','/api/player/session/2'],['GET','/api/connect/session']])
    assert.equal(allowedTeamRequest(method,path),true);
  for (const [method,path] of [['POST','/api/auth/select-account'],['GET','/api/admin/accounts'],['POST','/api/game/start'],['POST','/api/player/narration/1/2'],['HEAD','/api/player/session/1'],['GET','/api/player/session/1/'],['GET','/api/player/session/1%2f'],['GET','/api/player/session/0']])
    assert.equal(allowedTeamRequest(method,path),false);
});

test('team tokens stay distinct and respect application, origin, environment, lifetime and path', async t => {
  const oldEnv={...process.env}, oldConfig={...config};
  t.after(()=>{for(const k of ['NODE_ENV','WQT_ACCOUNT_MODEL','WQT_TEAM_APPS']){if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k]} for(const k of Object.keys(config))delete config[k];Object.assign(config,oldConfig)});
  process.env.NODE_ENV='test';process.env.WQT_ACCOUNT_MODEL='accounts';process.env.WQT_TEAM_APPS=JSON.stringify([app]);
  config.JWT_SECRET='synthetic-team-application-unit-test-key';config.SERVER_ENV='test';
  const record={clientId:'emma',redirectUri:app.redirectUris[0],identityId:1,accountId:2,jti:'fixture-session',credentialVersion:0};
  const token=signTeamToken(record,Date.now()+300_000);
  const req={method:'GET',path:'/api/connect/session',headers:{authorization:`Bearer ${token}`,origin:'https://course.example'}};
  assert.equal(verifyTeamRequest(req).scope,'player:session');
  // Expiration and signature failures must fail before any database/session lookup.
  const expired=signTeamToken(record,Date.now()-2000);
  assert.throws(()=>verifyTeamRequest({...req,headers:{...req.headers,authorization:`Bearer ${expired}`}}),{status:401});
  const [header,payload,signature]=token.split('.');
  const changedPayload=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(payload,'base64url').toString()),accountId:999})).toString('base64url');
  assert.throws(()=>verifyTeamRequest({...req,headers:{...req.headers,authorization:`Bearer ${header}.${changedPayload}.${signature}`}}),{status:401});
  const wrongAudience=jwt.sign({type:'team_app',...record,scope:'player:session',env:'test',exp:Math.floor(Date.now()/1000)+100},config.JWT_SECRET,{audience:'other-service',issuer:'wqt:platform'});
  assert.throws(()=>verifyTeamRequest({...req,headers:{...req.headers,authorization:`Bearer ${wrongAudience}`}}),{status:401});

  assert.throws(()=>verifyTeamRequest({...req,path:'/api/admin/stats/overview'}),{status:403});
  assert.throws(()=>verifyTeamRequest({...req,headers:{...req.headers,origin:'https://evil.example'}}),{status:403});
  assert.throws(()=>verifyTeamRequest({...req,headers:{authorization:`Bearer ${token}`}}),{status:403});
  assert.throws(()=>verifyTeamRequest({...req,headers:{...req.headers,authorization:`Bearer ${signTeamToken(record,Date.now()+1000_000)}`}}),{status:401});
  process.env.WQT_TEAM_APPS=JSON.stringify([{...app,identityIds:[2]}]);
  assert.throws(()=>verifyTeamRequest(req),{status:403});
  process.env.WQT_TEAM_APPS='[]';assert.throws(()=>verifyTeamRequest(req),{status:403});
  process.env.WQT_TEAM_APPS=JSON.stringify([app]);process.env.WQT_ACCOUNT_MODEL='legacy';
  let rejected;teamTokenBoundary(req,{set(){},vary(){}},error=>{rejected=error});assert.equal(rejected.status,403);
  process.env.WQT_ACCOUNT_MODEL='accounts';config.SERVER_ENV='other';assert.throws(()=>verifyTeamRequest(req),{status:401});config.SERVER_ENV='test';
  // Identity-only endpoints reject app and audience-confused identity credentials before DB access.
  for(const candidate of [token,jwt.sign({type:'identity',identityId:1,env:'test',aud:TEAM_AUDIENCE},config.JWT_SECRET)]) {
    let status;const res={status(value){status=value;return this},json(){return this}};
    await authenticateIdentity({headers:{authorization:`Bearer ${candidate}`}},res,()=>assert.fail('must not authenticate'));
    assert.equal(status,401);
  }
  const input={client_id:'emma',redirect_uri:app.redirectUris[0],state:'s'.repeat(32),code_challenge:'c'.repeat(43),code_challenge_method:'S256'};
  assert.equal(authorizationInput(input).app.clientId,'emma');
  assert.throws(()=>authorizationInput({...input,code_challenge_method:'plain'}),{status:400});
  assert.throws(()=>authorizationInput({...input,state:'short'}),{status:400});
});
