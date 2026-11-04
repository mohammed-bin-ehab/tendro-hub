// Starts an in-memory PostgreSQL (PGlite) on a local TCP port for tests. Usage: const { start } = require('./pg-server')
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
async function start(port = 0) {
  const pg = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' });
  await server.start();
  const bound = port || server.server?.address?.().port;
  return { url: `postgresql://postgres:postgres@127.0.0.1:${bound}/postgres`, stop: async () => { await server.stop(); await pg.close(); } };
}
module.exports = { start };
