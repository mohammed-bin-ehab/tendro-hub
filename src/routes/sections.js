const express = require('express');
const { needLogin, needCsrf } = require('../auth');
const { db } = require('../db');
const { STATUS, text, unitName, statusName, userName } = require('../i18n');
const { canEdit, canManage } = require('../permissions');
const { dependencyRowsFor, users, userById } = require('../repo');
const { bilingualText, sectionText, commentText } = require('../translate');
const { canViewProject, projectMembers } = require('../projects');
const { notifyProject, notifyUser, notifySome } = require('../notifications');
const A = require('../attachments');
const { esc, nowIso, fmt, chip, pill, page, csrfField, dependencyPresentation, dependencyNoteMarkup } = require('../views');

const router = express.Router();

// ---------- section ----------
const notFound = (req, res) => { res.status(404).send(page(req, 'غير موجود', `<p class="card">${text(req, 'القسم غير موجود')}</p>`)); return null; };
async function loadSection(req, res) {
  const s = await db.prepare('SELECT * FROM sections WHERE id=? AND archived=0').get(Number(req.params.id));
  if (s && !(await canViewProject(req.user, s.project_id))) return notFound(req, res);
  if (!s) { res.status(404).send(page(req, 'غير موجود', `<p class="card">${text(req, 'القسم غير موجود')}</p>`)); return null; }
  return s;
}
router.get('/sections/:id', needLogin, async (req, res) => {
  const s = await loadSection(req, res); if (!s) return;
  if (process.env.GOOGLE_TRANSLATE_API_KEY && s.content && (!s.content_ar || !s.content_en)) {
    const pair = await bilingualText(s.content);
    if (pair.translated) {
      await db.prepare('UPDATE sections SET content_ar=?,content_en=?,content_source_lang=? WHERE id=?')
        .run(pair.ar, pair.en, pair.sourceLang, s.id);
      s.content_ar = pair.ar; s.content_en = pair.en; s.content_source_lang = pair.sourceLang;
    }
  }
  const owner = s.owner_id ? await userById(s.owner_id) : null;
  const edit = canEdit(req.user, s), manage = canManage(req.user, s);
  const dependencyPresentationForSection = dependencyPresentation(req, s, (await dependencyRowsFor([s.id])).get(s.id) || []);
  const U = Object.fromEntries((await users()).map((u) => [u.id, u]));
  // long threads: show the latest COMMENTS_PAGE comments; ?comments=all shows everything
  const COMMENTS_PAGE = 30;
  const totalComments = (await db.prepare('SELECT COUNT(*) n FROM comments WHERE section_id=?').get(s.id)).n;
  const showAllComments = req.query.comments === 'all' || totalComments <= COMMENTS_PAGE;
  const com = showAllComments
    ? await db.prepare('SELECT * FROM comments WHERE section_id=? ORDER BY id').all(s.id)
    : await db.prepare('SELECT * FROM (SELECT * FROM comments WHERE section_id=? ORDER BY id DESC LIMIT ?) t ORDER BY id').all(s.id, COMMENTS_PAGE);
  if (process.env.GOOGLE_TRANSLATE_API_KEY) {
    await Promise.all(com.filter((c) => c.body && (!c.body_ar || !c.body_en)).map(async (c) => {
      const pair = await bilingualText(c.body);
      if (!pair.translated) return;
      await db.prepare('UPDATE comments SET body_ar=?,body_en=?,source_lang=? WHERE id=?').run(pair.ar, pair.en, pair.sourceLang, c.id);
      c.body_ar = pair.ar; c.body_en = pair.en; c.source_lang = pair.sourceLang;
    }));
  }
  let h = `<p class="crumb"><a href="/">${text(req, '← كل الأقسام')}</a> · ${text(req, 'الوحدة')} ${s.unit}: ${unitName(req, s.unit)}</p>${dependencyNoteMarkup(req, dependencyPresentationForSection, true)}
  <form id="section-form" class="section-form" method="post" action="/sections/${s.id}/save-all" data-baseline="${esc(JSON.stringify({ content: s.content, status: s.status, mode: s.edit_mode, editor: s.editor_id == null ? '' : String(s.editor_id) }))}">${csrfField(req)}
  <section class="card"><div class="top"><h1>${esc(text(req, s.title))}</h1>${pill(s.status, req)}</div>
  <p class="meta2">${text(req, 'المسؤول:')} ${chip(owner, req.lang)}${s.edit_mode === 'team' && owner ? ` · ${text(req, 'التعديل مفتوح للفريق')}` : ''}${s.edit_mode === 'person' ? ` · ${text(req, 'يعدّل معه:')} ${chip(U[s.editor_id], req.lang)}` : ''}${s.updated_at ? ` · ${text(req, 'آخر تعديل')} ${esc(fmt(s.updated_at, req.lang))} ${text(req, 'بواسطة')} ${esc(userName(req, U[s.updated_by]) || '')}` : ''}</p>
  ${s.hint ? `<p class="hint">💡 ${esc(text(req, s.hint))}</p>` : ''}`;
  const displayedContent = sectionText(s, req.lang);
  if (edit) {
    h += `<label>${text(req, 'الحالة')}<select name="status">${Object.entries(STATUS).map(([k]) => `<option value="${k}"${k === s.status ? ' selected' : ''}>${statusName(req, k)}</option>`).join('')}</select></label>
    <label>${text(req, 'المحتوى')}<textarea name="content" rows="14" maxlength="50000" placeholder="${text(req, 'اكتب هنا...')}">${esc(displayedContent)}</textarea></label>`;
  } else {
    h += displayedContent ? `<div class="content">${esc(displayedContent)}</div>` : `<p class="mut">${text(req, 'لم يُكتب شيء بعد.')}</p>`;
    h += `<p class="lock">${text(req, '🔒 للعرض فقط — تقدر تكتب تعليقًا بالأسفل.')}</p>`;
  }
  h += '</section>';
  if (manage && owner) {
    const others = (await projectMembers(s.project_id)).filter((u) => u.active && u.id !== s.owner_id);
    h += `<section class="card"><h2>${text(req, 'من يقدر يعدّل هذا القسم؟')}</h2>
    <label class="r"><input type="radio" name="mode" value="owner"${s.edit_mode === 'owner' ? ' checked' : ''}> ${text(req, 'أنا فقط')}</label>
    <label class="r"><input type="radio" name="mode" value="team"${s.edit_mode === 'team' ? ' checked' : ''}> ${text(req, 'الفريق كله')}</label>
    <label class="r"><input type="radio" name="mode" value="person"${s.edit_mode === 'person' ? ' checked' : ''}> ${text(req, 'شخص محدد:')}
      <select name="editor">${others.map((u) => `<option value="${u.id}"${u.id === s.editor_id ? ' selected' : ''}>${esc(userName(req, u))}</option>`).join('')}</select></label>
    </section>`;
  }
  h += `<section class="card" id="comments-card"><h2>${text(req, 'التعليقات')} (<span id="comment-count">${totalComments}</span>)</h2>${showAllComments ? '' : `<p class="mut older-note">${text(req, 'يظهر آخر 30 تعليقًا.')} <a href="/sections/${s.id}?comments=all">${text(req, 'عرض كل التعليقات')}</a></p>`}<div id="comments-list">${com.map((c) => `<div class="cm" data-comment-id="${c.id}"><div class="cmh">${chip(U[c.user_id], req.lang)}<span class="mut">${esc(fmt(c.created_at, req.lang))}</span>
    ${c.user_id === req.user.id ? `<span class="delete-comment"><button class="link" type="button" data-delete-comment="${c.id}" data-csrf="${esc(req.csrf)}">${text(req, 'حذف')}</button></span>` : ''}</div><p>${esc(commentText(c, req.lang))}</p></div>`).join('') || `<p class="mut" data-empty-comments>${text(req, 'لا توجد تعليقات.')}</p>`}</div>
  <label>${text(req, 'أضف تعليقًا')}<textarea id="comment-draft" name="comment" rows="3" maxlength="2000" placeholder="${text(req, 'ملاحظة أو اقتراح...')}"></textarea></label></section>
  <div class="save-all-wrap save-toolbar"><span id="save-state" class="save-state" role="status" aria-live="polite">${text(req, 'لا توجد تغييرات غير محفوظة')}</span><button class="btn" type="submit" id="save-all">${text(req, 'حفظ التغييرات')}</button></div>`;
  // ---- files and links (separate forms, outside the main section form) ----
  const attachments = await db.prepare('SELECT id,kind,name,url,mime,size,user_id,created_at FROM attachments WHERE section_id=? ORDER BY id').all(s.id);
  const attMessages = { ok: ['ok', 'تمت الإضافة.'], deleted: ['ok', 'تم الحذف.'], type: ['err', 'نوع الملف غير مسموح أو محتواه لا يطابق امتداده.'], size: ['err', 'الملف أكبر من الحد المسموح.'],
    limit: ['err', 'وصلت لأقصى عدد مرفقات لهذا القسم.'], full: ['err', 'مساحة التخزين ممتلئة. تواصل مع المدير.'], link: ['err', 'الرابط غير صالح. استخدم رابط http أو https.'], invalid: ['err', 'تعذّر رفع الملف.'], denied: ['err', 'لا تملك صلاحية حذف هذا المرفق.'] };
  const att = attMessages[req.query.att];
  const maxMb = Math.round(A.MAX_FILE_BYTES / 1048576);
  h += `</form><section class="card" id="attachments"><h2>${text(req, 'الملفات والروابط')} (${attachments.length})</h2>
  ${att ? `<p class="${att[0] === 'ok' ? 'form-success' : 'form-alert'}" role="status">${text(req, att[1])}</p>` : ''}
  <ul class="att-list">${attachments.map((a) => {
    const isImg = a.kind === 'file' && A.INLINE.has(A.extOf(a.name));
    const who = U[a.user_id];
    const target = a.kind === 'link' ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(a.name)}</a> <span class="mut att-host">${esc(new URL(a.url).hostname)}</span>`
      : `<a href="/attachments/${a.id}${isImg ? '' : '?dl=1'}"${isImg ? ' target="_blank" rel="noopener"' : ''}>${esc(a.name)}</a> <span class="mut">${A.prettySize(a.size)}</span>`;
    const canDelete = a.user_id === req.user.id || manage;
    return `<li class="att">${isImg ? `<img class="att-thumb" src="/attachments/${a.id}" alt="" loading="lazy" width="56" height="56">` : `<span class="att-kind">${a.kind === 'link' ? text(req, 'رابط') : esc(A.extOf(a.name).toUpperCase())}</span>`}
      <div class="att-main">${target}<div class="mut att-meta">${chip(who, req.lang)} · ${esc(fmt(a.created_at, req.lang))}</div></div>
      ${canDelete ? `<form method="post" action="/attachments/${a.id}/delete" class="att-del">${csrfField(req)}<button class="link" type="submit">${text(req, 'حذف')}</button></form>` : ''}</li>`;
  }).join('') || `<li class="mut">${text(req, 'لا توجد ملفات أو روابط.')}</li>`}</ul>
  <div class="att-forms">
    <form method="post" action="/sections/${s.id}/attachments" enctype="multipart/form-data" class="att-form">${csrfField(req)}
      <label>${text(req, 'رفع ملف (Word أو PDF أو صورة…)')}<input type="file" name="file" accept="${A.ACCEPT}" required></label>
      <p class="mut att-hint">${text(req, 'الحد الأقصى')} ${maxMb} MB</p><button class="btn ghost" type="submit">${text(req, 'رفع')}</button></form>
    <form method="post" action="/sections/${s.id}/links" class="att-form">${csrfField(req)}
      <label>${text(req, 'رابط لملف')}<input type="url" name="url" maxlength="500" placeholder="https://" required></label>
      <label>${text(req, 'عنوان (اختياري)')}<input name="title" maxlength="120"></label><button class="btn ghost" type="submit">${text(req, 'إضافة الرابط')}</button></form>
  </div></section>`;

  res.send(page(req, s.title, h));
});
router.post('/sections/:id/save', needLogin, needCsrf, async (req, res) => {
  const s = await loadSection(req, res); if (!s) return;
  if (!canEdit(req.user, s)) return res.status(403).send(page(req, 'غير مسموح', `<p class="card">${text(req, 'ما عندك صلاحية تعديل هذا القسم.')}</p>`));

  const sets = [], values = [];
  if (Object.prototype.hasOwnProperty.call(req.body, 'content')) {
    sets.push('content=?');
    values.push(String(req.body.content).slice(0, 50000));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'status') && STATUS[req.body.status]) {
    sets.push('status=?');
    values.push(req.body.status);
  }
  if (!sets.length) return res.redirect(`/sections/${s.id}`);

  sets.push('updated_at=?', 'updated_by=?');
  values.push(nowIso(), req.user.id, s.id);
  const newStatus = Object.prototype.hasOwnProperty.call(req.body, 'status') && STATUS[req.body.status] ? req.body.status : s.status;
  await db.tx(async (tx) => {
    await tx.prepare(`UPDATE sections SET ${sets.join(',')} WHERE id=?`).run(...values);
    if (newStatus !== s.status) await notifyProject(tx, { projectId: s.project_id, actorId: req.user.id, type: 'status', sectionId: s.id, data: { from: s.status, to: newStatus } });
  });
  res.redirect(`/sections/${s.id}?ok=1`);
});
router.post('/sections/:id/save-all', needLogin, needCsrf, async (req, res) => {
  const s = await loadSection(req, res); if (!s) return;
  if (!canEdit(req.user, s) && Object.prototype.hasOwnProperty.call(req.body, 'content')) return res.status(403).json({ error: req.lang === 'en' ? 'You are not allowed to edit this section.' : 'لا تملك صلاحية تعديل المحتوى.' });
  if (!canManage(req.user, s) && Object.prototype.hasOwnProperty.call(req.body, 'mode')) return res.status(403).json({ error: req.lang === 'en' ? 'You are not allowed to change section permissions.' : 'لا تملك صلاحية تغيير صلاحيات القسم.' });
  const contentChanged = Object.prototype.hasOwnProperty.call(req.body, 'content')
    && String(req.body.content || '').slice(0, 50000) !== sectionText(s, req.lang);
  const contentPair = contentChanged ? await bilingualText(req.body.content) : null;
  const newComment = String(req.body.comment || '').trim().slice(0, 2000);
  const commentPair = newComment ? await bilingualText(newComment) : null;
  const requestId = /^[\da-f-]{36}$/i.test(String(req.body.client_request_id || '')) ? String(req.body.client_request_id) : null;
  await db.tx(async (tx) => {
  let newStatus = s.status;
  const commentAlreadySaved = requestId && newComment
    ? await tx.prepare('SELECT id FROM comments WHERE client_request_id=? AND user_id=?').get(requestId, req.user.id)
    : null;
  if (contentPair && canEdit(req.user, s)) {
    const st = STATUS[req.body.status] ? req.body.status : s.status;
    await tx.prepare('UPDATE sections SET content=?, content_ar=?, content_en=?, content_source_lang=?, status=?, updated_at=?, updated_by=? WHERE id=?')
      .run(String(req.body.content || '').slice(0, 50000), contentPair.ar, contentPair.en, contentPair.sourceLang, st, nowIso(), req.user.id, s.id);
    newStatus = st;
  } else if (Object.prototype.hasOwnProperty.call(req.body, 'content') && canEdit(req.user, s)) {
    const st = STATUS[req.body.status] ? req.body.status : s.status;
    if (st !== s.status) await tx.prepare('UPDATE sections SET status=?, updated_at=?, updated_by=? WHERE id=?').run(st, nowIso(), req.user.id, s.id);
    newStatus = st;
  } else if (Object.prototype.hasOwnProperty.call(req.body, 'status') && STATUS[req.body.status] && canEdit(req.user, s)) {
    await tx.prepare('UPDATE sections SET status=?, updated_at=?, updated_by=? WHERE id=?')
      .run(req.body.status, nowIso(), req.user.id, s.id);
    newStatus = req.body.status;
  }
  if (newStatus !== s.status) await notifyProject(tx, { projectId: s.project_id, actorId: req.user.id, type: 'status', sectionId: s.id, data: { from: s.status, to: newStatus } });

  if (Object.prototype.hasOwnProperty.call(req.body, 'mode') && canManage(req.user, s) && s.owner_id) {
    const mode = ['owner', 'team', 'person'].includes(req.body.mode) ? req.body.mode : 'owner';
    let editor = null;
    if (mode === 'person') {
      editor = Number(req.body.editor);
      if (!(await tx.prepare('SELECT 1 AS ok FROM projects p JOIN team_members tm ON tm.team_id=p.team_id WHERE p.id=? AND tm.user_id=?').get(s.project_id, editor)) || editor === s.owner_id) editor = s.editor_id || null;
    }
    await tx.prepare('UPDATE sections SET edit_mode=?, editor_id=? WHERE id=?').run(mode, editor, s.id);
  }

  if (newComment && !commentAlreadySaved) {
    await tx.prepare('INSERT INTO comments(section_id,user_id,body,created_at,body_ar,body_en,source_lang,client_request_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(s.id, req.user.id, newComment, nowIso(), commentPair.ar, commentPair.en, commentPair.sourceLang, requestId);
    // told: the section owner, the person allowed to edit it, and everyone who already commented on it
    const earlier = (await tx.prepare('SELECT DISTINCT user_id FROM comments WHERE section_id=? AND user_id<>?').all(s.id, req.user.id)).map((r) => r.user_id);
    await notifySome(tx, { projectId: s.project_id, userIds: [s.owner_id, s.edit_mode === 'person' ? s.editor_id : null, ...earlier], actorId: req.user.id, type: 'comment_added', sectionId: s.id });
  }
  });
  if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true, savedAt: nowIso(), sectionId: s.id, sectionTitle: s.title, unit: s.unit, translationPending: Boolean((contentPair && !contentPair.translated) || (commentPair && !commentPair.translated)) });
  res.redirect(`/sections/${s.id}?ok=1`);
});
router.post('/comments/:id/delete', needLogin, needCsrf, async (req, res) => {
  const c = await db.prepare('SELECT * FROM comments WHERE id=?').get(Number(req.params.id));
  const cs = c ? await db.prepare('SELECT project_id FROM sections WHERE id=?').get(c.section_id) : null;
  if (!c || c.user_id !== req.user.id || !cs || !(await canViewProject(req.user, cs.project_id))) {
    if (req.get('X-Requested-With') === 'fetch') return res.status(c ? 403 : 404).json({ error: req.lang === 'en' ? 'Could not delete the comment.' : 'تعذّر حذف التعليق.' });
    return res.redirect(c ? `/sections/${c.section_id}` : '/');
  }
  const sec = await db.prepare('SELECT owner_id FROM sections WHERE id=?').get(c.section_id);
  await db.tx(async (tx) => {
    await tx.prepare('DELETE FROM comments WHERE id=?').run(c.id);
    await notifyUser(tx, { userId: sec?.owner_id, actorId: req.user.id, type: 'comment_deleted', sectionId: c.section_id });
  });
  if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true, id: c.id, sectionId: c.section_id });
  res.redirect(c ? `/sections/${c.section_id}` : '/');
});

// ---------- legacy URLs (old bookmarks, old cached pages, queued offline drafts) ----------
router.get('/s/:id', needLogin, (req, res) => res.redirect(301, `/sections/${Number(req.params.id) || 0}`));
router.post('/s/:id/save', (req, res) => res.redirect(307, `/sections/${Number(req.params.id) || 0}/save`));
router.post('/s/:id/save-all', (req, res) => res.redirect(307, `/sections/${Number(req.params.id) || 0}/save-all`));
router.post('/c/:id/delete', (req, res) => res.redirect(307, `/comments/${Number(req.params.id) || 0}/delete`));

module.exports = router;
