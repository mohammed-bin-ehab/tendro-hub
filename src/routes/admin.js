const express = require('express');
const bcrypt = require('bcryptjs');
const { needLogin, needAdmin, needCsrf } = require('../auth');
const { db } = require('../db');
const { STATUS, text, unitName, statusName, userName } = require('../i18n');
const { userById, invalidateUsers, settingsDefaults, colorValue, saveSetting } = require('../repo');
const { currentProject, isProjectMember } = require('../projects');
const { esc, page, csrfField } = require('../views');

const router = express.Router();

// ---------- admin dashboard ----------
const adminFlashText = {
  member: 'تمت إضافة العضو', 'member-updated': 'تم تحديث العضو', section: 'تم إنشاء القسم',
  'section-updated': 'تم تحديث القسم', archived: 'تمت أرشفة القسم', restored: 'تمت استعادة القسم', 'permanently-deleted': 'تم حذف القسم نهائيًا', settings: 'تم حفظ الإعدادات',
  team: 'تم حفظ الفريق', 'team-members': 'تم حفظ أعضاء الفريق', project: 'تم حفظ المشروع',
  duplicate: 'اسم المستخدم مستخدم بالفعل.', password: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.', lastAdmin: 'لا يمكن إيقاف آخر مدير.', invalid: 'راجع بيانات النموذج وحاول مجددًا.'
};
router.get('/admin', needLogin, needAdmin, async (req, res) => {
  const colors = Object.fromEntries(await Promise.all(Object.keys(settingsDefaults).map(async (k) => [k, await colorValue(k)])));
  const members = await db.prepare('SELECT id,name,username,role,active FROM users ORDER BY id').all();
  const sections = await db.prepare('SELECT s.*, p.name AS project_name FROM sections s LEFT JOIN projects p ON p.id=s.project_id ORDER BY s.archived,s.project_id,s.unit,s.pos,s.id').all();
  const teams = await db.prepare('SELECT id,name FROM teams ORDER BY id').all();
  const teamMembers = await db.prepare('SELECT team_id,user_id FROM team_members').all();
  const projects = await db.prepare('SELECT p.id,p.name,p.team_id,p.archived FROM projects p ORDER BY p.id').all();
  const activeProjects = projects.filter((p) => !p.archived);
  const cur = await currentProject(req);
  const teamOptions = (selected) => teams.map((t) => `<option value="${t.id}"${t.id === selected ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  const activeUsers = members.filter((u) => u.active);
  const owners = `<option value="">${text(req, 'بدون مسؤول')}</option>` + activeUsers.map((u) => `<option value="${u.id}">${esc(userName(req, u))}</option>`).join('');
  const flash = adminFlashText[req.query.ok] ? `<p class="form-success" role="status">${text(req, adminFlashText[req.query.ok])}</p>` : req.query.e ? `<p class="form-alert" role="alert">${text(req, adminFlashText[req.query.e] || adminFlashText.invalid)}</p>` : '';
  let html = `${flash}<section class="hero card admin-hero"><div><h1>${text(req, 'لوحة الإدارة')}</h1><p class="mut">${text(req, 'إدارة الفريق والأقسام والألوان والصلاحيات من مكان واحد.')}</p></div><div class="admin-stats"><b>${members.length}</b><span>${text(req, 'الأعضاء')}</span><b>${sections.filter((s) => !s.archived).length}</b><span>${text(req, 'الأقسام')}</span></div></section>
    <section class="card admin-card"><h2>${text(req, 'إضافة عضو')}</h2><form class="admin-grid" method="post" action="/admin/members">${csrfField(req)}
      <label>${text(req, 'اسم العرض')}<input name="name" maxlength="80" required></label><label>${text(req, 'اسم المستخدم')}<input name="username" pattern="[A-Za-z0-9._-]{3,32}" minlength="3" maxlength="32" required autocomplete="off"></label>
      <label>${text(req, 'كلمة مرور أولية')}<input type="password" name="password" minlength="8" required autocomplete="new-password"></label><label>${text(req, 'الفريق')}<select name="team_id"><option value="">—</option>${teamOptions(teams[0]?.id)}</select></label><label>${text(req, 'الدور')}<select name="role"><option value="member">${text(req, 'عضو')}</option><option value="admin">${text(req, 'مدير')}</option></select></label>
      <button class="btn" type="submit">${text(req, 'حفظ العضو')}</button></form></section>
    <section class="card admin-card"><h2>${text(req, 'إدارة الأعضاء')}</h2><div class="admin-list">${members.map((u) => `<form class="admin-row" method="post" action="/admin/members/${u.id}/update">${csrfField(req)}
      <div class="admin-fields"><label>${text(req, 'اسم العرض')}<input name="name" value="${esc(u.name)}" maxlength="80" required></label><label>${text(req, 'اسم المستخدم')}<input name="username" value="${esc(u.username)}" pattern="[A-Za-z0-9._-]{3,32}" minlength="3" maxlength="32" required></label>
      <label>${text(req, 'الدور')}<select name="role"><option value="member"${u.role === 'member' ? ' selected' : ''}>${text(req, 'عضو')}</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>${text(req, 'مدير')}</option></select></label>
      <label>${text(req, 'الحالة')}<select name="active"><option value="1"${u.active ? ' selected' : ''}>${text(req, 'نشط')}</option><option value="0"${!u.active ? ' selected' : ''}>${text(req, 'موقوف')}</option></select></label><label>${text(req, 'كلمة مرور أولية')}<input type="password" name="password" minlength="8" placeholder="••••••"></label></div>
      <button class="btn alt" type="submit">${text(req, 'حفظ العضو')}</button></form>`).join('')}</div></section>
    <section class="card admin-card"><h2>${text(req, 'إضافة قسم')}</h2><form class="admin-grid" method="post" action="/admin/sections">${csrfField(req)}
      <label>${text(req, 'المشروع')}<select name="project_id" required>${activeProjects.map((p) => `<option value="${p.id}"${p.id === cur.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><label>${text(req, 'عنوان القسم')}<input name="title" maxlength="180" required></label><label>${text(req, 'الوحدة')}<select name="unit">${[1,2,3,4].map((n) => `<option value="${n}">${text(req,'الوحدة')} ${n} · ${unitName(req,n)}</option>`).join('')}</select></label>
      <label>${text(req, 'المسؤول:')}<select name="owner_id">${owners}</select></label><label>${text(req, 'الصلاحية')}<select name="edit_mode"><option value="owner">${text(req, 'المسؤول فقط')}</option><option value="team">${text(req, 'الفريق كله')}</option></select></label>
      <label class="wide">${text(req, 'التلميح')}<textarea name="hint" maxlength="500"></textarea></label><button class="btn" type="submit">${text(req, 'حفظ القسم')}</button></form></section>
    <section class="card admin-card"><h2>${text(req, 'إدارة الأقسام')}</h2><div class="admin-list">${sections.filter((s) => !s.archived).map((s) => `<div class="admin-row"><form class="admin-section-form" method="post" action="/admin/sections/${s.id}/update">${csrfField(req)}<p class="mut project-tag">${esc(s.project_name || '')}</p>
      <div class="admin-fields"><label>${text(req, 'عنوان القسم')}<input name="title" value="${esc(s.title)}" maxlength="180" required></label><label>${text(req, 'الوحدة')}<select name="unit">${[1,2,3,4].map((n) => `<option value="${n}"${s.unit === n ? ' selected' : ''}>${text(req,'الوحدة')} ${n} · ${unitName(req,n)}</option>`).join('')}</select></label>
      <label>${text(req, 'المسؤول:')}<select name="owner_id"><option value="">${text(req, 'بدون مسؤول')}</option>${activeUsers.map((u) => `<option value="${u.id}"${u.id === s.owner_id ? ' selected' : ''}>${esc(userName(req,u))}</option>`).join('')}${s.owner_id && !activeUsers.some((u) => u.id === s.owner_id) ? `<option value="${s.owner_id}" selected disabled>${text(req,'عضو موقوف')}</option>` : ''}</select></label><label>${text(req, 'الحالة')}<select name="status">${Object.entries(STATUS).map(([key]) => `<option value="${key}"${key === s.status ? ' selected' : ''}>${statusName(req,key)}</option>`).join('')}</select></label>
      <label>${text(req, 'الصلاحية')}<select name="edit_mode"><option value="owner"${s.edit_mode === 'owner' ? ' selected' : ''}>${text(req, 'المسؤول فقط')}</option><option value="team"${s.edit_mode === 'team' ? ' selected' : ''}>${text(req, 'الفريق كله')}</option><option value="person"${s.edit_mode === 'person' ? ' selected' : ''}>${text(req, 'شخص محدد')}</option></select></label><label>${text(req, 'شخص محدد')}<select name="editor_id"><option value="">${text(req,'اختر المسؤول')}</option>${activeUsers.filter((u) => u.id !== s.owner_id).map((u) => `<option value="${u.id}"${u.id === s.editor_id ? ' selected' : ''}>${esc(userName(req,u))}</option>`).join('')}</select></label>
      <label class="wide">${text(req, 'التلميح')}<textarea name="hint" maxlength="500">${esc(s.hint)}</textarea></label></div><button class="btn alt" type="submit">${text(req, 'تعديل القسم')}</button></form>
      <form method="post" action="/admin/sections/${s.id}/archive">${csrfField(req)}<button class="link danger-link" type="submit">${text(req, 'أرشفة')}</button></form></div>`).join('') || `<p class="mut">${text(req, 'لا توجد أقسام.')}</p>`}</div>
      <h2>${text(req, 'الأقسام المؤرشفة')}</h2><p class="mut archive-note">${text(req,'أرشيف الأقسام لا تنتهي مدته تلقائيًا.')}</p><div class="admin-list">${sections.filter((s) => s.archived).map((s) => `<div class="archived-row"><span>${esc(text(req,s.title))} · ${text(req,'الوحدة')} ${s.unit}</span><div class="archive-actions"><form method="post" action="/admin/sections/${s.id}/restore">${csrfField(req)}<button class="btn alt" type="submit">${text(req, 'استعادة')}</button></form><form method="post" action="/admin/sections/${s.id}/delete" data-confirm="${text(req,'تأكيد الحذف النهائي لهذا القسم وتعليقاته؟ لا يمكن التراجع عن ذلك.')}">${csrfField(req)}<button class="btn danger-btn" type="submit">${text(req,'حذف نهائي')}</button></form></div></div>`).join('') || `<p class="mut">—</p>`}</div></section>
    <section class="card admin-card"><h2>${text(req, 'الفرق والمشاريع')}</h2>
      <form class="admin-grid" method="post" action="/admin/teams">${csrfField(req)}<label>${text(req, 'اسم الفريق')}<input name="name" maxlength="80" required></label><button class="btn" type="submit">${text(req, 'فريق جديد')}</button></form>
      <form class="admin-grid" method="post" action="/admin/projects">${csrfField(req)}<label>${text(req, 'الفريق')}<select name="team_id" required>${teamOptions()}</select></label><label>${text(req, 'اسم المشروع')}<input name="name" maxlength="120" required></label><button class="btn" type="submit">${text(req, 'مشروع جديد')}</button></form>
      <div class="admin-list">${teams.map((t) => `<form class="admin-row" method="post" action="/admin/teams/${t.id}/members">${csrfField(req)}<div class="admin-fields"><strong class="wide">${esc(t.name)} · ${projects.filter((p) => p.team_id === t.id).map((p) => esc(p.name) + (p.archived ? ' (' + text(req, 'مؤرشف') + ')' : '')).join('، ') || '—'}</strong>
        <div class="wide team-members">${members.map((u) => `<label class="r"><input type="checkbox" name="member_ids" value="${u.id}"${teamMembers.some((m) => m.team_id === t.id && m.user_id === u.id) ? ' checked' : ''}> ${esc(userName(req, u))}</label>`).join('')}</div></div><button class="btn alt" type="submit">${text(req, 'حفظ الأعضاء')}</button></form>`).join('') || `<p class="mut">${text(req, 'لا توجد فرق.')}</p>`}</div>
      <div class="admin-list">${projects.map((p) => `<form class="admin-row" method="post" action="/admin/projects/${p.id}/update">${csrfField(req)}<div class="admin-fields"><label>${text(req, 'اسم المشروع')}<input name="name" value="${esc(p.name)}" maxlength="120" required></label><label>${text(req, 'الحالة')}<select name="archived"><option value="0"${!p.archived ? ' selected' : ''}>${text(req, 'نشط')}</option><option value="1"${p.archived ? ' selected' : ''}>${text(req, 'مؤرشف')}</option></select></label></div><button class="btn alt" type="submit">${text(req, 'حفظ المشروع')}</button></form>`).join('')}</div></section>
    <section class="card admin-card"><h2>${text(req, 'ألوان الواجهة')}</h2><form class="admin-grid color-grid" method="post" action="/admin/settings">${csrfField(req)}
      ${[['accent','لون التمييز'],['lightPage','خلفية الصفحة'],['lightSurface','خلفية البطاقات'],['lightText','لون النص'],['darkPage','خلفية الصفحة الداكنة'],['darkSurface','البطاقات الداكنة'],['darkText','النص الداكن']].map(([key,label]) => `<label>${text(req,label)}<input class="color-input" type="color" name="${key}" value="${colors[key]}"></label>`).join('')}
      <button class="btn" type="submit">${text(req, 'حفظ الإعدادات')}</button></form></section>`;
  res.send(page(req, 'لوحة الإدارة', html));
});
router.post('/admin/members', needLogin, needAdmin, needCsrf, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0,80), username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || ''), role = req.body.role === 'admin' ? 'admin' : 'member';
  if (!name || !/^[a-z0-9._-]{3,32}$/.test(username)) return res.redirect('/admin?e=invalid');
  if (password.length < 8) return res.redirect('/admin?e=password');
  const teamId = req.body.team_id ? Number(req.body.team_id) : null;
  try {
    const created = await db.prepare('INSERT INTO users(username,name,pass_hash,role,active) VALUES(?,?,?,?,1) RETURNING id').get(username,name,await bcrypt.hash(password,10),role);
    if (teamId) await db.prepare('INSERT INTO team_members(team_id,user_id) SELECT id, ? FROM teams WHERE id=? ON CONFLICT DO NOTHING').run(created.id, teamId);
  } catch { return res.redirect('/admin?e=duplicate'); }
  invalidateUsers();
  res.redirect('/admin?ok=member');
});
router.post('/admin/members/:id/update', needLogin, needAdmin, needCsrf, async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
  if (!u) return res.redirect('/admin?e=invalid');
  const name = String(req.body.name || '').trim().slice(0,80), username = String(req.body.username || '').trim().toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'member', active = req.body.active === '1' ? 1 : 0, password = String(req.body.password || '');
  if (!name || !/^[a-z0-9._-]{3,32}$/.test(username) || (password && password.length < 8)) return res.redirect(`/admin?e=${password && password.length < 8 ? 'password' : 'invalid'}`);
  const adminsLeft = Number((await db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?").get(u.id)).n);
  if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && adminsLeft === 0) return res.redirect('/admin?e=lastAdmin');
  try {
    if (password) await db.prepare('UPDATE users SET name=?,username=?,role=?,active=?,pass_hash=? WHERE id=?').run(name,username,role,active,await bcrypt.hash(password,10),u.id);
    else await db.prepare('UPDATE users SET name=?,username=?,role=?,active=? WHERE id=?').run(name,username,role,active,u.id);
  } catch { return res.redirect('/admin?e=duplicate'); }
  if (password || !active) await db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); // new password or disabled account: sign them out everywhere
  invalidateUsers();
  res.redirect('/admin?ok=member-updated');
});
router.post('/admin/sections', needLogin, needAdmin, needCsrf, async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0,180), hint = String(req.body.hint || '').trim().slice(0,500);
  const unit = Number(req.body.unit), owner = req.body.owner_id ? Number(req.body.owner_id) : null, projectId = Number(req.body.project_id);
  const project = await db.prepare('SELECT id FROM projects WHERE id=? AND archived=0').get(projectId);
  if (!project || !title || ![1,2,3,4].includes(unit) || (owner && !(await userById(owner))?.active) || (owner && !(await isProjectMember(project.id, owner)))) return res.redirect('/admin?e=invalid');
  const pos = Number((await db.prepare('SELECT COALESCE(MAX(pos),-1)+1 p FROM sections WHERE unit=? AND project_id=?').get(unit, project.id)).p);
  const mode = ['owner','team','person'].includes(req.body.edit_mode) ? req.body.edit_mode : 'owner';
  await db.prepare('INSERT INTO sections(unit,pos,title,hint,owner_id,status,content,edit_mode,project_id) VALUES(?,?,?,?,?,?,?,?,?)').run(unit,pos,title,hint,owner,'todo','',owner ? mode : 'team',project.id);
  res.redirect('/admin?ok=section');
});
router.post('/admin/sections/:id/update', needLogin, needAdmin, needCsrf, async (req, res) => {
  const section = await db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.params.id));
  const title = String(req.body.title || '').trim().slice(0,180), hint = String(req.body.hint || '').trim().slice(0,500);
  const unit = Number(req.body.unit), owner = req.body.owner_id ? Number(req.body.owner_id) : null, status = STATUS[req.body.status] ? req.body.status : section?.status;
  const mode = ['owner','team','person'].includes(req.body.edit_mode) ? req.body.edit_mode : 'owner';
  let editor = req.body.editor_id ? Number(req.body.editor_id) : null;
  if (!section || !title || ![1,2,3,4].includes(unit) || (owner && !(await userById(owner))?.active)) return res.redirect('/admin?e=invalid');
  if (mode === 'person' && (!editor || !(await userById(editor))?.active || editor === owner)) return res.redirect('/admin?e=invalid');
  if ((owner && !(await isProjectMember(section.project_id, owner))) || (mode === 'person' && !(await isProjectMember(section.project_id, editor)))) return res.redirect('/admin?e=invalid');
  await db.prepare('UPDATE sections SET unit=?,title=?,hint=?,owner_id=?,status=?,edit_mode=?,editor_id=? WHERE id=?').run(unit,title,hint,owner,status,mode,mode === 'person' ? editor : null,section.id);
  res.redirect('/admin?ok=section-updated');
});
router.post('/admin/sections/:id/archive', needLogin, needAdmin, needCsrf, async (req, res) => {
  await db.prepare('UPDATE sections SET archived=1 WHERE id=?').run(Number(req.params.id));
  res.redirect('/admin?ok=archived');
});
router.post('/admin/sections/:id/restore', needLogin, needAdmin, needCsrf, async (req, res) => {
  await db.prepare('UPDATE sections SET archived=0 WHERE id=?').run(Number(req.params.id));
  res.redirect('/admin?ok=restored');
});
router.post('/admin/sections/:id/delete', needLogin, needAdmin, needCsrf, async (req, res) => {
  const id = Number(req.params.id);
  const section = await db.prepare('SELECT id FROM sections WHERE id=? AND archived=1').get(id);
  if (!section) return res.redirect('/admin?e=invalid');
  await db.tx(async (tx) => {
    await tx.prepare('DELETE FROM comments WHERE section_id=?').run(id);
    await tx.prepare('DELETE FROM sections WHERE id=? AND archived=1').run(id);
  });
  res.redirect('/admin?ok=permanently-deleted');
});
router.post('/admin/teams', needLogin, needAdmin, needCsrf, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.redirect('/admin?e=invalid');
  await db.prepare('INSERT INTO teams(name) VALUES(?)').run(name);
  res.redirect('/admin?ok=team');
});
router.post('/admin/teams/:id/members', needLogin, needAdmin, needCsrf, async (req, res) => {
  const teamId = Number(req.params.id);
  if (!(await db.prepare('SELECT id FROM teams WHERE id=?').get(teamId))) return res.redirect('/admin?e=invalid');
  const ids = [...new Set([].concat(req.body.member_ids || []).map(Number).filter(Number.isInteger))];
  await db.tx(async (tx) => {
    await tx.prepare('DELETE FROM team_members WHERE team_id=?').run(teamId);
    for (const id of ids) await tx.prepare('INSERT INTO team_members(team_id,user_id) SELECT ?, id FROM users WHERE id=? ON CONFLICT DO NOTHING').run(teamId, id);
  });
  res.redirect('/admin?ok=team-members');
});
router.post('/admin/projects', needLogin, needAdmin, needCsrf, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120), teamId = Number(req.body.team_id);
  if (!name || !(await db.prepare('SELECT id FROM teams WHERE id=?').get(teamId))) return res.redirect('/admin?e=invalid');
  await db.prepare('INSERT INTO projects(team_id,name) VALUES(?,?)').run(teamId, name);
  res.redirect('/admin?ok=project');
});
router.post('/admin/projects/:id/update', needLogin, needAdmin, needCsrf, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120), archived = req.body.archived === '1' ? 1 : 0;
  if (!name || !(await db.prepare('SELECT id FROM projects WHERE id=?').get(Number(req.params.id)))) return res.redirect('/admin?e=invalid');
  await db.prepare('UPDATE projects SET name=?, archived=? WHERE id=?').run(name, archived, Number(req.params.id));
  res.redirect('/admin?ok=project');
});
router.post('/admin/settings', needLogin, needAdmin, needCsrf, async (req, res) => {
  for (const key of Object.keys(settingsDefaults)) {
    const value = String(req.body[key] || '');
    if (!/^#[\da-fA-F]{6}$/.test(value)) return res.redirect('/admin?e=invalid');
    await saveSetting.run(key, value.toLowerCase());
  }
  res.redirect('/admin?ok=settings');
});

module.exports = router;
