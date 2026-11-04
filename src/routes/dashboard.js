const express = require('express');
const { needLogin } = require('../auth');
const { db } = require('../db');
const { STATUS, text, unitName, statusName, userName } = require('../i18n');
const { dependencyRowsFor, users } = require('../repo');
const { currentProject } = require('../projects');
const { esc, chip, pill, page, projectTabs, noProjectPage, dependencyPresentation, dependencyNoteMarkup } = require('../views');

const router = express.Router();

// ---------- dashboard ----------
router.get('/', needLogin, async (req, res) => {
  const project = await currentProject(req);
  if (!project.id) return res.send(noProjectPage(req));
  const mine = req.query.mine === '1';
  const memberId = /^\d+$/.test(String(req.query.member || '')) ? Number(req.query.member) : null;
  const memberView = memberId && memberId !== req.user.id ? memberId : null;
  const all = await db.prepare('SELECT s.*, (SELECT COUNT(*) FROM comments c WHERE c.section_id=s.id) cc FROM sections s WHERE s.archived=0 AND s.project_id=? ORDER BY unit,pos').all(project.id);
  const U = Object.fromEntries((await users()).map((u) => [u.id, u]));
  const dependenciesBySection = await dependencyRowsFor(all.map((section) => section.id));
  const members = await db.prepare(`SELECT u.id,u.name,COUNT(s.id) AS section_count
    FROM users u JOIN sections s ON s.owner_id=u.id AND s.archived=0 AND s.project_id=?
    WHERE u.id<>? GROUP BY u.id,u.name ORDER BY u.id`).all(project.id, req.user.id);
  const cnt = { todo: 0, doing: 0, review: 0, done: 0 };
  all.forEach((s) => cnt[s.status]++);
  const pct = all.length ? Math.round((cnt.done / all.length) * 100) : 0;
  const savedSectionId = /^\d+$/.test(String(req.query.saved || '')) ? Number(req.query.saved) : 0;
  const savedSection = savedSectionId ? all.find((section) => section.id === savedSectionId) : null;
  const deletedSectionId = /^\d+$/.test(String(req.query.deleted || '')) ? Number(req.query.deleted) : 0;
  const deletedSection = deletedSectionId ? all.find((section) => section.id === deletedSectionId) : null;
  const dashboardToast = savedSection ? `<div class="save-toast dashboard-toast" role="status">${req.lang === 'en' ? `Task “${esc(text(req,savedSection.title))}” saved (Unit ${savedSection.unit}).` : `تم حفظ تغييرات المهمة «${esc(text(req,savedSection.title))}» في الوحدة ${savedSection.unit}`}</div>` : deletedSection ? `<div class="save-toast dashboard-toast" role="status">${req.lang === 'en' ? `Comment deleted from “${esc(text(req,deletedSection.title))}”.` : `تم حذف التعليق من مهمة «${esc(text(req,deletedSection.title))}»`}</div>` : '';
  let html = `${dashboardToast}${req.query.welcome ? `<p class="form-success" role="status">${text(req, 'تم تسجيل الدخول بنجاح')}</p>` : ''}<section class="hero card"><div><h1>${text(req, 'أهلًا')} ${esc(userName(req, req.user))}</h1><p class="mut">${text(req, 'كل الأقسام ظاهرة للجميع، وتعدّل فقط على الأقسام التي تخصّك. وتقدر تكتب تعليقًا على أي قسم.')}</p></div>
  <div class="prog"><progress max="100" value="${pct}"></progress><b>${pct}%</b></div>
  <div class="counts">${Object.keys(STATUS).map((k) => `<span class="pill ${k}">${statusName(req, k)} · ${cnt[k]}</span>`).join('')}</div></section>
  ${projectTabs(req, project)}<p class="mut project-name">${esc(project.team_name)} · ${esc(project.name)}</p>
  <div class="tabs"><a class="${!mine && !memberView ? 'on' : ''}" href="/">${text(req, 'كل الأقسام')}</a><a class="${mine ? 'on' : ''}" href="/?mine=1">${text(req, 'أقسامي')}</a>${members.map((u) => `<a class="${memberView === u.id ? 'on' : ''}" href="/?member=${u.id}">${esc(userName(req, u))} <small>(${u.section_count})</small></a>`).join('')}</div>`;
  for (const n of [1, 2, 3, 4]) {
    const list = all.filter((s) => s.unit === n
      && (mine ? (s.owner_id === req.user.id || s.owner_id == null)
        : memberView ? s.owner_id === memberView : true));
    if (!list.length) continue;
    html += `<h2>${text(req, 'الوحدة')} ${n} · ${unitName(req, n)}</h2><div class="list">` + list.map((s) => {
      const presentation = dependencyPresentation(req, s, dependenciesBySection.get(s.id) || []);
      const editLabel = s.edit_mode === 'team' ? text(req, 'مفتوح التعديل للجميع') : s.edit_mode === 'person' && s.editor_id ? `${text(req, 'مفتوح التعديل لـ')} ${userName(req, U[s.editor_id])}` : '';
      return `<a class="row" id="section-${s.id}" href="/sections/${s.id}">
      <div class="t"><span class="section-title">${esc(text(req, s.title))}</span>${dependencyNoteMarkup(req, presentation)}</div><span class="meta">${chip(U[s.owner_id], req.lang)}${editLabel ? `<span class="open">${esc(editLabel)}</span>` : ''}${s.cc ? `<span class="cc">💬 ${s.cc}</span>` : ''}${pill(s.status, req)}</span></a>`;
    }).join('') + '</div>';
  }
  res.send(page(req, 'الأقسام', html));
});

module.exports = router;
