const config = require('./config');
config.validate();
const { createApp } = require('./app');
const db = require('./db');

const server = createApp().listen(config.port, () => console.log(`[server] listening on :${config.port} (${config.env})`));

async function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(async () => { await db.close().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); shutdown('uncaughtException'); });
