import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { assessSmsQuota } from './sms-quota.mjs';

// Run from an operations host with a configured lark-cli bot identity.
// The snapshot must be supplied by a trusted collector for the production Bmob app.
const [snapshotPath, threshold, maxAgeMinutes] = process.argv.slice(2);
const chatId = process.env.WQT_SMS_ALERT_CHAT_ID;
if (!snapshotPath || !/^oc_[a-z0-9]+$/i.test(chatId ?? '')) {
  console.error('Usage: set WQT_SMS_ALERT_CHAT_ID and run node scripts/ops/check-sms-quota.mjs <snapshot.json> <threshold> <max-age-minutes>');
  process.exit(2);
}

let observation;
try {
  observation = JSON.parse(readFileSync(snapshotPath, 'utf8'));
} catch {
  // Missing or malformed snapshots are reported as unknown, without exposing their contents.
}

try {
  const result = assessSmsQuota(observation, {
    threshold: Number(threshold),
    maxAgeMs: Number(maxAgeMinutes) * 60_000,
  });
  if (result.status === 'healthy') {
    console.log('SMS quota healthy');
  } else {
    const message = result.status === 'unknown'
      ? '【伍力全开生产】短信余额未知。请检查 Bmob 控制台及余额采集任务。'
      : `【伍力全开生产】短信额度${result.status === 'low' ? '偏低' : '已耗尽'}，剩余 ${result.remaining} 条（${new Date(result.observedAt).toISOString()}）。请到 Bmob 控制台处理。`;
    // Keep the key stable for repeat checks in the same UTC day, including retries.
    const day = new Date().toISOString().slice(0, 10);
    // Windows npm installs a PowerShell shim. A JS entry allows shell-free execution.
    const cliEntry = process.env.WQT_LARK_CLI_JS;
    const { stdout } = await promisify(execFile)(cliEntry ? process.execPath : 'lark-cli', [
      ...(cliEntry ? [cliEntry] : []),
      'im', '+messages-send', '--as', 'bot', '--chat-id', chatId,
      '--text', message, '--idempotency-key', `wqt-sms-${result.status}-${day}`,
    ], { timeout: 15_000, windowsHide: true });
    if (JSON.parse(stdout).ok !== true) throw new Error('Notification rejected');
    console.log(`SMS quota notification accepted: ${result.status}`);
  }
} catch {
  console.error('SMS quota check or notification failed');
  process.exitCode = 1;
}
