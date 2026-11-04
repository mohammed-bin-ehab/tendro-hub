const { app } = require('./src/app');
const { computeFlow } = require('./src/flow');
const { ready } = require('./src/seed');
const { pool, db } = require('./src/db');
const { PORT, IS_MAIN } = require('./src/config');

if (IS_MAIN) {
  ready.then(() => {
    const server = app.listen(PORT, () => console.log('TENDRO docs on :' + PORT));
    // sessions last 14 days; remove expired ones hourly so the table stays small
    const cleanup = () => Promise.all([
      db.prepare('DELETE FROM sessions WHERE created_at<?').run(Date.now() - 14 * 864e5),
      // read notifications are kept 30 days, any notification 180 days
      db.prepare('DELETE FROM notifications WHERE (read_at IS NOT NULL AND read_at<?) OR created_at<?').run(new Date(Date.now() - 30 * 864e5).toISOString(), new Date(Date.now() - 180 * 864e5).toISOString()),
    ]).catch((e) => console.error('Cleanup failed:', e.message));
    cleanup();
    setInterval(cleanup, 60 * 60 * 1000).unref();
    const stop = () => server.close(() => pool.end().finally(() => process.exit(0)));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  });
}
module.exports = { app, computeFlow, ready, pool };
