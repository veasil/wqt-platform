import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { startRuntime } from "../../../src/runtime.js";
import { dbRun, dbGet } from "../../../src/db.js";
import { cardsDbRun } from "../../../src/cards-db.js";
import {Client} from 'pg';
import {provisionUatReviewer} from '../../helpers/uat-reviewer.mjs';
export async function run() {
  let runtime, browser, provider;
  try {
    runtime = await startRuntime({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${runtime.server.address().port}`,
      now = Date.now();
    const phone = "16600000881",
      password = "PlayerTestOnly!";
    const identity = (
      await dbRun(
        "INSERT INTO identities(phone,password_hash,guardian_name,created_at) VALUES(?,?,?,?)",
        [phone, bcrypt.hashSync(password, 10), "玩家验收", now],
      )
    ).lastID;
    const accounts = [];
    for (const name of ["账号A", "账号B"]) {
      const org=(await dbRun('INSERT INTO organizations(name,owner_user_id) VALUES(?,0)',[`玩家测试组织 · ${name}`])).lastID;
      const id = (
        await dbRun(
          "INSERT INTO accounts(organization_id,name,valid_until,created_at) VALUES(?,?,?,?)",
          [org, name, now + 86400000, now],
        )
      ).lastID;
      await dbRun(
        "INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)",
        [id, identity, now],
      );
      accounts.push(id);
    }
    await dbRun(
      "INSERT INTO activities(name,organizer,activity_code,status) VALUES('验收活动','验收地点','PLAYERAB','active')",
    );
    const options = {
      A: {
        text: "边看手机边吃饭",
        consequence: "忽略了身体的信号。",
        reason: "安全力-1：继续忽视身体信号",
        attributeEffects: { 安全力: -1 },
      },
      B: {
        text: "放下手机",
        consequence: "注意到了身体",
        reason: "安全力+1：暂停屏幕",
        attributeEffects: { 安全力: 1 },
      },
      C: {
        text: "与家人交流",
        consequence: "听见了伙伴",
        reason: "沟通力+1：表达感受",
        attributeEffects: { 沟通力: 1 },
      },
    };
    const cardId = (
      await cardsDbRun(
        "INSERT INTO cards(key,safety_type,event,phase,options_json,status,title,card_code) VALUES(99001,'身体','吃饭时手机响了','启蒙期',?,'released','吃饭与屏幕','2026B01')",
        [JSON.stringify(options)],
      )
    ).lastID;
    const release = (
      await cardsDbRun(
        "INSERT INTO cards_released(card_id,key,safety_type,event,phase,options_json,released_at,title,card_code) VALUES(?,99001,'身体','吃饭时手机响了','青春期',?,?,'吃饭与屏幕','2026B01')",
        [cardId, JSON.stringify(options), now],
      )
    ).lastID;
    await cardsDbRun("UPDATE card_groups SET is_default=0");
    const group = (
      await cardsDbRun(
        "INSERT INTO card_groups(name,released_ids_json,is_default,created_at,max_scores_json) VALUES('验收卡组',?,1,?,?)",
        [
          JSON.stringify([release]),
          now,
          JSON.stringify({
            安全力: 5,
            脑波力: 5,
            实感力: 5,
            创心力: 5,
            沟通力: 5,
          }),
        ],
      )
    ).lastID;
    let calls = 0;
    provider = createServer((_req, res) => {
      calls++;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  safe: true,
                  feedback:
                    "小伍暂停屏幕，重新感受食物和身体，也让家人听见自己的想法。这个选择带来了可以一起交流的新机会。",
                }),
              },
            },
          ],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    await dbRun(
      "INSERT INTO system_settings(key,value) VALUES('DEFAULT_LLM_PROVIDER','OpenAI'),('OPENAI_API_KEY','synthetic-key'),('OPENAI_BASE_URL',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [`http://127.0.0.1:${provider.address().port}/chat`],
    );
    const api = async (path, body, token) => {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json() };
    };
    const login = await api("/api/auth/login", {
      phone,
      password,
      verificationMethod: "password",
    });
    assert.equal(login.status, 200);
    let selected = await api(
      "/api/auth/select-account",
      { accountId: accounts[0] },
      login.data.token,
    );
    const token = selected.data.token;
    const startInput = {
      requestId: randomUUID(),
      activityCode: "PLAYERAB",
      location:"验收地点",
      cardGroupId: group,
      settings: { duration: 300, counts: [1, 0, 0] },
    };
    const started = await api("/api/player/start", startInput, token);
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.equal(
      (await api("/api/player/start", startInput, token)).data.sessionId,
      started.data.sessionId,
    );
    let state = (
      await api("/api/player/session/" + started.data.sessionId, null, token)
    ).data.state;
    const creativeStart = await api(
      "/api/player/start",
      { ...startInput, requestId: randomUUID() },
      token,
    );
    const creativeSkill = await api(
      "/api/player/action",
      {
        requestId: randomUUID(),
        sessionId: creativeStart.data.sessionId,
        revision: 0,
        action: "skill",
        skill: "创心力",
        cardId,
        text: "先放下手机再交流",
      },
      token,
    );
    assert.equal(creativeSkill.status, 200);
    const aiInput = {
      sessionId: creativeStart.data.sessionId,
      cardId,
      purpose: "creative",
    };
    const generated = await api("/api/player/ai-feedback", aiInput, token);
    assert.equal(generated.status, 200, JSON.stringify(generated.data));
    assert.equal(
      (await api("/api/player/ai-feedback", aiInput, token)).data.cached,
      true,
    );
    assert.equal(calls, 1);
    const d = await api(
      "/api/player/action",
      {
        requestId: randomUUID(),
        sessionId: creativeStart.data.sessionId,
        revision: 1,
        action: "choice",
        cardId,
        choice: "D",
      },
      token,
    );
    assert.deepEqual(d.data.state.values, creativeSkill.data.state.values);
    const actionInput = {
      requestId: randomUUID(),
      sessionId: started.data.sessionId,
      revision: state.revision,
      action: "choice",
      cardId,
      choice: "A",
    };
    const chosen = await api("/api/player/action", actionInput, token);
    assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
    assert.equal(chosen.data.state.values[0], 2);
    assert.deepEqual(chosen.data.state.done,[1,0,0]);
    assert.equal(chosen.data.state.phase,0);
    assert.equal(chosen.data.state.choices[0].phase,0);
    assert.equal(chosen.data.payload.phase,'青春期');
    assert.equal(
      (await api("/api/player/action", actionInput, token)).data.state.revision,
      1,
    );
    assert.equal(
      (
        await dbGet(
          "SELECT COUNT(*) AS n FROM game_events WHERE session_id=? AND type='card_choice'",
          [started.data.sessionId],
        )
      ).n,
      1,
    );
    const ended = await api(
      "/api/player/action",
      {
        requestId: randomUUID(),
        sessionId: started.data.sessionId,
        revision: 1,
        action: "finish",
      },
      token,
    );
    assert.equal(ended.status, 200);
    assert.equal(
      (await api("/api/player/feedback", null, token)).data.pending.length,
      1,
    );
    const survey = await api(
      "/api/player/feedback",
      {
        requestId: randomUUID(),
        sessionId: started.data.sessionId,
        answers: {
          participation: "很投入",
          learning: "注意身体",
          improvement: "多交流",
        },
      },
      token,
    );
    assert.equal(survey.status, 200);
    assert.equal((await dbGet('SELECT COUNT(*) AS n FROM user_feedback WHERE session_id=?',[started.data.sessionId])).n,1);
    assert.equal(
      (await api("/api/player/feedback", null, token)).data.pending.length,
      0,
    );
    const other = await api(
      "/api/auth/select-account",
      { accountId: accounts[1] },
      login.data.token,
    );
    assert.equal(
      (
        await api(
          "/api/player/session/" + started.data.sessionId,
          null,
          other.data.token,
        )
      ).status,
      404,
    );
    assert.equal((await api("/api/downloads", null, token)).status, 200);
    await dbRun("UPDATE accounts SET valid_until=? WHERE id=?", [
      now - 1,
      accounts[0],
    ]);
    assert.equal((await api("/api/downloads", null, token)).status, 403);
    await dbRun("UPDATE accounts SET valid_until=? WHERE id=?", [
      now + 86400000,
      accounts[0],
    ]);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1365, height: 980 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/player/");
    await page.getByRole("button", { name: "进入守望者系统" }).click();
    await page.locator("[name=phone]").fill(phone);
    await page.locator("[name=password]").fill(password);
    await page.locator("#auth-form .primary").click();
    await page.locator('#manual-account').click();
    await page.locator('[data-account="' + accounts[1] + '"]').click();
    assert.equal(await page.locator(".activity-card").count(), 0);
    await page.locator("[name=code]").fill("PLAYERAB");
    await page.locator("#code-form .primary").click();
    await page.locator("#select-activity").click();
    await page.locator("[name=count0]").fill("1");
    await page.locator("[name=count1]").fill("0");
    await page.locator("[name=count2]").fill("0");
    await page.locator("#config-form .primary").click();
    await page.locator("#pick").click();
    await page.locator('[data-card="' + cardId + '"]').click();
    await page.locator("[data-choice=A]").click();
    await page.locator("#confirm").click();
    await page.locator("#next").waitFor();
    await page.locator("#next").click();
    await page.locator("#advance").click();
    await page.locator("#review").waitFor();
    assert.equal(errors.length, 0, errors.join(";"));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    );
    await page.locator('#practice').click();
    await page.locator('#pick').click();
    await page.locator('[data-card="'+cardId+'"]').click();
    await page.locator('[data-choice=B]').click();
    await page.locator('#confirm').click();
    assert.equal((await dbGet("SELECT COUNT(*) AS n FROM game_events WHERE session_id=? AND type='card_choice'",[started.data.sessionId])).n,1);
    const oldStarted=Date.now()-4*3600000;
    const expired=JSON.parse((await dbGet('SELECT player_state_json FROM game_sessions WHERE id=?',[creativeStart.data.sessionId])).player_state_json);
    expired.startedAt=oldStarted;
    await dbRun('UPDATE game_sessions SET started_at=?,player_state_json=? WHERE id=?',[oldStarted,JSON.stringify(expired),creativeStart.data.sessionId]);
    await runtime.stop();
    runtime=await startRuntime({port:0,host:'127.0.0.1'});
    // Startup schedules recovery in the background; observe its durable result
    // rather than assuming the HTTP listener means that recovery has completed.
    let recovered;
    const recoveryDeadline=Date.now()+10000;
    do {
      recovered=await dbGet('SELECT * FROM game_sessions WHERE id=?',[creativeStart.data.sessionId]);
      if(recovered.ended_at)break;
      await new Promise(resolve=>setTimeout(resolve,25));
    } while(Date.now()<recoveryDeadline);
    assert.ok(recovered.ended_at);
    assert.equal(JSON.parse(recovered.player_state_json).ended,true);
    assert.notEqual(recovered.final_score,null);
    const reviewerClient=new Client({connectionString:process.env.DATABASE_URL});
    await reviewerClient.connect();
    try {
      const options={phone:'16600000882',password:'ReviewerSynthetic2026!'};
      const reviewer=await provisionUatReviewer(reviewerClient,options);
      assert.deepEqual(await provisionUatReviewer(reviewerClient,options),reviewer);
      assert.equal(reviewer.accounts.watcher,reviewer.accounts.enterprise,'organization admin plays through the same city account');
      const bindings=(await reviewerClient.query('SELECT a.id,a.organization_id,a.role FROM accounts a JOIN account_bindings b ON b.account_id=a.id AND b.ended_at IS NULL WHERE b.identity_id=$1',[reviewer.identityId])).rows;
      assert.equal(bindings.length,3);
      assert.equal(new Set(bindings.map(row=>row.organization_id)).size,3,'platform, city and free accounts belong to distinct organizations');
      assert.notEqual(Number(bindings.find(row=>row.role==='boss').organization_id),0);
      assert.equal((await reviewerClient.query('SELECT COUNT(*)::int AS count FROM accounts WHERE organization_id=$1',[reviewer.organizationId])).rows[0].count,20);
    } finally {await reviewerClient.end()}
    console.log("PLAYER_INTEGRATION_OK");
  } finally {
    await browser?.close();
    if (provider) await new Promise((resolve) => provider.close(resolve));
    await runtime?.stop();
  }
}
