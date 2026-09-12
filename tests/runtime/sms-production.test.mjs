import assert from "node:assert/strict";
import { test } from "node:test";
import { runNodeScript } from "../helpers/runtime-test-env.mjs";

test("production SMS never falls back to mock or reusable test code", async () => {
  const result = await runNodeScript(
    `
    import assert from 'node:assert/strict';
    const sms = await import('./src/services/sms.js');
    assert.throws(() => sms.initSms(),/SMS configuration required/);
    const sent = await sms.sendCode('15555550123','127.0.0.1');
    assert.equal(sent.ok,false); assert.equal(sent.status,503); assert.equal(sent.mockCode,undefined);
    const verified = await sms.verifyCode('15555550123','123456');
    assert.equal(verified.ok,false);
    console.log('PRODUCTION_SMS_FAIL_CLOSED_PASSED');
  `,
    {
      env: {
        NODE_ENV: "production",
        TEST_LOGIN_PHONES: "15555550123",
        TEST_LOGIN_CODE: "123456",
      },
    },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PRODUCTION_SMS_FAIL_CLOSED_PASSED/);
  assert.doesNotMatch(result.stdout, /123456|15555550123/);
});
