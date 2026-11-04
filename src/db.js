const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

types.setTypeParser(20, (v) => Number(v)); // COUNT(*) / BIGINT -> number

// ---------- database (PostgreSQL) ----------
// Same call shape as before (prepare(sql).get/all/run, exec), but every call is async.
// "?" placeholders are converted to $1, $2, ...
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 5, idleTimeoutMillis: 30000 });
// per-request query timing (used only when SERVER_TIMING=1, see app.js)
const timing = new AsyncLocalStorage();
const stats = { connects: 0 };
pool.on('connect', () => { stats.connects++; });
const timed = async (fn) => {
  const st = timing.getStore();
  if (!st) return fn();
  const t = process.hrtime.bigint();
  try { return await fn(); } finally { st.n++; st.ms += Number(process.hrtime.bigint() - t) / 1e6; }
};
pool.on('error', (error) => console.error('Postgres pool error:', error.message));
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
function dbApi(runner) {
  return {
    prepare(sql) {
      const text = toPg(sql);
      return {
        get: async (...params) => (await runner(text, params)).rows[0],
        all: async (...params) => (await runner(text, params)).rows,
        run: async (...params) => { const r = await runner(text, params); return { changes: r.rowCount, rows: r.rows }; },
      };
    },
    exec: (sql) => runner(sql, []),
  };
}
const db = dbApi((text, params) => timed(() => pool.query(text, params.length ? params : undefined)));
db.tx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(dbApi((text, params) => timed(() => client.query(text, params.length ? params : undefined))));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw error;
  } finally { client.release(); }
};

async function initSchema() {
  await db.exec(`
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, username TEXT UNIQUE, name TEXT, pass_hash TEXT, role TEXT DEFAULT 'member', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER, csrf TEXT, created_at BIGINT);
CREATE TABLE IF NOT EXISTS sections(
  id SERIAL PRIMARY KEY, unit INTEGER, pos INTEGER, title TEXT, hint TEXT DEFAULT '',
  owner_id INTEGER, status TEXT DEFAULT 'todo', content TEXT DEFAULT '',
  edit_mode TEXT DEFAULT 'owner', editor_id INTEGER, updated_at TEXT, updated_by INTEGER,
  content_ar TEXT DEFAULT '', content_en TEXT DEFAULT '', content_source_lang TEXT DEFAULT '', archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS comments(id SERIAL PRIMARY KEY, section_id INTEGER, user_id INTEGER, body TEXT, created_at TEXT,
  body_ar TEXT DEFAULT '', body_en TEXT DEFAULT '', source_lang TEXT DEFAULT '', client_request_id TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS section_deps(
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  depends_on_section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK(dependency_type IN ('mandatory','helpful')),
  note_ar TEXT NOT NULL DEFAULT '', note_en TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(section_id, depends_on_section_id),
  CHECK(section_id <> depends_on_section_id));
CREATE TABLE IF NOT EXISTS teams(id SERIAL PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS team_members(
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(team_id, user_id));
CREATE TABLE IF NOT EXISTS projects(
  id SERIAL PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL, archived INTEGER DEFAULT 0);
ALTER TABLE sections ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS sections_project ON sections(project_id, archived, unit, pos);
CREATE INDEX IF NOT EXISTS team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS sections_active_order ON sections(archived, unit, pos);
CREATE INDEX IF NOT EXISTS sections_owner ON sections(owner_id);
CREATE INDEX IF NOT EXISTS comments_section ON comments(section_id, id);
CREATE INDEX IF NOT EXISTS section_deps_prereq ON section_deps(depends_on_section_id);
CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created_at);
CREATE TABLE IF NOT EXISTS attachments(
  id SERIAL PRIMARY KEY, section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('file','link')),
  name TEXT NOT NULL, url TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0, data BYTEA, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS attachments_section ON attachments(section_id, id);
CREATE TABLE IF NOT EXISTS notifications(
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, section_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, read_at TEXT);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id DESC);
CREATE INDEX IF NOT EXISTS notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS comments_client_request_id ON comments(client_request_id) WHERE client_request_id IS NOT NULL;
`);
}

module.exports = { pool, db, initSchema, timing, stats };
