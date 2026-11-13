// Negative real-provider probe: no SMS, no real user ticket, no credentials in output.
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
dotenv.config({quiet:true});
const {verifyCaptcha,CAPTCHA_ENABLED}=await import('../../src/services/captcha.js');
assert.equal(CAPTCHA_ENABLED,true);
const result=await verifyCaptcha({ticket:'wqt-invalid-ticket-probe',randstr:'wqt-invalid-rand-probe',ip:'127.0.0.1'});
assert.equal(result.ok,false,'Invalid tickets must be rejected');
assert.equal(typeof result.providerCode,'number','Provider auth or connectivity did not reach ticket validation');
console.log(JSON.stringify({realCaptchaApi:true,invalidTicketRejected:true,providerCode:result.providerCode}));
