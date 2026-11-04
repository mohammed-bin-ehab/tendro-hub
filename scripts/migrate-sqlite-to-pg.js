// One-off: copy an existing SQLite database (data/tendro.db) into PostgreSQL (Neon).
// Usage:  DATABASE_URL="postgresql://..." node --disable-warning=ExperimentalWarning scripts/migrate-sqlite-to-pg.js path/to/tendro.db
// The target database must be empty (the script stops if it already has users). The SQLite file is only read, never changed.
process.env.SKIP_SEED = '1';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const { pool, ready } = require('../server.js');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Usage: node scripts/migrate-sqlite-to-pg.js path/to/tendro.db'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(1); }

// order matters: parents before children. sessions are skipped (everyone just logs in again).
const TABLES = [
  ['users', 'id'], ['sections', 'id'], ['comments', 'id'], ['settings', null], ['section_deps', null],
];

(async () => {
  await ready;
  const src = new DatabaseSync(file, { readOnly: true });
  const existing = (await pool.query('SELECT COUNT(*)::int n FROM users')).rows[0].n;
  if (existing > 0) { console.error(`Target already has ${existing} users. Aborting so nothing is overwritten.`); process.exit(1); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [table, serial] of TABLES) {
      let rows;
      try { rows = src.prepare(`SELECT * FROM ${table}`).all(); } catch { console.log(`- ${table}: not in SQLite file, skipped`); continue; }
      const targetCols = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [table])).rows.map((r) => r.column_name);
      let n = 0;
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => targetCols.includes(c));
        const sql = `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')})`;
        await client.query(sql, cols.map((c) => row[c] ?? null));
        n++;
      }
      if (serial) await client.query(`SELECT setval(pg_get_serial_sequence('${table}','${serial}'), COALESCE((SELECT MAX(${serial}) FROM ${table}), 0) + 1, false)`);
      console.log(`- ${table}: ${n} rows copied (SQLite had ${rows.length})`);
    }
    await client.query('COMMIT');
    console.log('Done. Start the app and log in with the same passwords as before.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed, nothing was changed:', error.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
