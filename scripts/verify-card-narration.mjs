// Small paid provider smoke test only; never starts the app, opens PG, or prints credentials.
import { narrationConfig, synthesizeNarration } from '../src/services/card-narration.js';

if (!process.argv.includes('--live')) {
  console.error('Explicit live call required: node --env-file=.env scripts/verify-card-narration.mjs --live');
  process.exitCode = 1;
} else {
  const diagnostics = {};
  try {
    const settings = narrationConfig();
    const audio = await synthesizeNarration('小伍收到一条陌生消息。你会先核实来源吗？', settings, {
      fetchImpl: async (url, options) => {
        try {
          const response = await fetch(url, options);
          diagnostics.httpStatus = response.status;
          diagnostics.logId = response.headers.get('x-tt-logid');
          if (!response.ok) {
            const body = await response.clone().json().catch(() => ({}));
            if (typeof body.code === 'number') diagnostics.providerCode = body.code;
          }
          return response;
        } catch (error) {
          // Error messages can contain transport details; only expose a standard code.
          const code = error.cause?.code || error.code;
          if (typeof code === 'string' && /^[A-Z0-9_]{1,50}$/.test(code)) diagnostics.networkCode = code;
          throw error;
        }
      },
    });
    console.log(JSON.stringify({ ok: true, voice: settings.speaker, bytes: audio.length, ...diagnostics }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, status: error.status || 500, message: error.status ? error.message : 'Verification failed', ...diagnostics }));
    process.exitCode = 1;
  }
}
