// In-app notifications. Rows are written by notify*(); texts are built when shown, in the reader's language.
const { text, enText, statusName } = require('./i18n');

const nowIso = () => new Date().toISOString();

// everyone in the team that owns the section's project (except the person who did it)
async function notifyProject(conn, { projectId, actorId, type, sectionId, data = {} }) {
  if (!projectId) return;
  await conn.prepare(`INSERT INTO notifications(user_id,type,section_id,actor_id,data,created_at)
    SELECT tm.user_id, ?, ?, ?, ?, ? FROM projects p
    JOIN team_members tm ON tm.team_id=p.team_id JOIN users u ON u.id=tm.user_id AND u.active=1
    WHERE p.id=? AND tm.user_id<>?`).run(type, sectionId, actorId, JSON.stringify(data), nowIso(), projectId, actorId);
}
// one person (skipped when it is the actor or nobody)
async function notifyUser(conn, { userId, actorId, type, sectionId, data = {} }) {
  if (!userId || userId === actorId) return;
  await conn.prepare(`INSERT INTO notifications(user_id,type,section_id,actor_id,data,created_at)
    SELECT u.id, ?, ?, ?, ?, ? FROM users u WHERE u.id=? AND u.active=1`).run(type, sectionId, actorId, JSON.stringify(data), nowIso(), userId);
}

// a given set of people, limited to active members of the project's team (never the actor)
async function notifySome(conn, { projectId, userIds, actorId, type, sectionId, data = {} }) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== actorId);
  if (!projectId || !ids.length) return;
  await conn.prepare(`INSERT INTO notifications(user_id,type,section_id,actor_id,data,created_at)
    SELECT tm.user_id, ?, ?, ?, ?, ? FROM projects p
    JOIN team_members tm ON tm.team_id=p.team_id JOIN users u ON u.id=tm.user_id AND u.active=1
    WHERE p.id=? AND tm.user_id IN (${ids.map(() => '?').join(',')})`).run(type, sectionId, actorId, JSON.stringify(data), nowIso(), projectId, ...ids);
}

// ---- texts (no gendered verbs in Arabic: "name — action") ----
const q = (s) => `«${s}»`;
function notificationText(req, n) {
  const en = req.lang === 'en';
  const actor = n.actor_name ? (en ? enText(n.actor_name) : n.actor_name) : (en ? 'Someone' : 'أحد الأعضاء');
  const title = n.section_title ? text(req, n.section_title) : '';
  let d = {}; try { d = JSON.parse(n.data || '{}'); } catch { /* ignore */ }
  const t = en ? `“${title}”` : q(title);
  if (n.type === 'status') {
    if (d.to === 'doing') return en ? `${actor} started working on ${t}` : `${actor} — بدء العمل على ${t}`;
    if (d.to === 'review') return en ? `${actor} marked ${t} ready for review` : `${actor} — ${t} جاهز للمراجعة`;
    if (d.to === 'done') return en ? `${actor} completed ${t}` : `${actor} — اكتمال ${t}`;
    if (d.to === 'todo') return en ? `${actor} moved ${t} back to “${statusName(req, 'todo')}”` : `${actor} — إعادة ${t} إلى ${q(statusName(req, 'todo'))}`;
  }
  if (n.type === 'attachment_added') {
    const name = d.name || '';
    return d.kind === 'link'
      ? (en ? `${actor} added a link “${name}” to ${t}` : `${actor} — إضافة رابط ${q(name)} إلى ${t}`)
      : (en ? `${actor} added a file “${name}” to ${t}` : `${actor} — إضافة ملف ${q(name)} إلى ${t}`);
  }
  if (n.type === 'comment_added') return en ? `${actor} commented on ${t}` : `${actor} — تعليق جديد على ${t}`;
  if (n.type === 'comment_deleted') return en ? `${actor} deleted a comment on ${t}` : `${actor} — حذف تعليق من ${t}`;
  return en ? `${actor} updated ${t}` : `${actor} — تحديث ${t}`;
}

module.exports = { notifyProject, notifyUser, notifySome, notificationText };
