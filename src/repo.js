const { db } = require('./db');

async function dependencyRowsFor(sectionIds) {
  if (!sectionIds.length) return new Map();
  const placeholders = sectionIds.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT d.section_id,d.dependency_type,d.note_ar,d.note_en,
    prerequisite.id AS prerequisite_id,prerequisite.title,prerequisite.status,prerequisite.owner_id,
    owner.name AS owner_name,prerequisite.archived
    FROM section_deps d JOIN sections prerequisite ON prerequisite.id=d.depends_on_section_id
    LEFT JOIN users owner ON owner.id=prerequisite.owner_id
    WHERE d.section_id IN (${placeholders})
    ORDER BY d.section_id,CASE d.dependency_type WHEN 'mandatory' THEN 0 ELSE 1 END,prerequisite.unit,prerequisite.pos`).all(...sectionIds);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.section_id)) grouped.set(row.section_id, []);
    grouped.get(row.section_id).push(row);
  }
  return grouped;
}
// the member list is read on almost every page: cache it for a few seconds, and drop the cache when members change
let usersCache = null, usersAt = 0;
const users = async () => {
  if (!usersCache || Date.now() - usersAt > 10000) {
    usersCache = await db.prepare('SELECT id,name,username,role,active FROM users ORDER BY id').all();
    usersAt = Date.now();
  }
  return usersCache.map((u) => ({ ...u }));
};
const invalidateUsers = () => { usersCache = null; };
const userById = async (id) => db.prepare('SELECT id,name,username,role,active FROM users WHERE id=?').get(id);
const settingsDefaults = { accent: '#171717', lightPage: '#f6f6f5', lightSurface: '#ffffff', lightText: '#171717', darkPage: '#151515', darkSurface: '#222222', darkText: '#f1f1f1' };
// all settings in one query, cached for a few seconds (every page loads /theme.css)
let settingsCache = null, settingsAt = 0;
async function allSettings() {
  if (!settingsCache || Date.now() - settingsAt > 10000) {
    const rows = await db.prepare('SELECT key,value FROM settings').all();
    settingsCache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    settingsAt = Date.now();
  }
  return settingsCache;
}
const getSetting = async (key) => (await allSettings())[key] || settingsDefaults[key];
const colorValue = async (key) => { const v = await getSetting(key); return /^#[\da-fA-F]{6}$/.test(v || '') ? v : settingsDefaults[key]; };
const saveSettingSql = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const saveSetting = { run: async (key, value) => { const r = await saveSettingSql.run(key, value); settingsCache = null; return r; } };

module.exports = { dependencyRowsFor, users, invalidateUsers, userById, settingsDefaults, getSetting, colorValue, saveSetting };
