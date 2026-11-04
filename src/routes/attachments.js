const express = require('express');
const multer = require('multer');
const { needLogin, needCsrf } = require('../auth');
const { db } = require('../db');
const { text } = require('../i18n');
const { canManage } = require('../permissions');
const { canViewProject } = require('../projects');
const { notifyProject } = require('../notifications');
const { nowIso, page } = require('../views');
const A = require('../attachments');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: A.MAX_FILE_BYTES, files: 1, parts: 8, fields: 6, fieldSize: 2048 } });
const back = (res, id, code) => res.redirect(`/sections/${id}?att=${code}#attachments`);
const notFound = (req, res) => res.status(404).send(page(req, 'غير موجود', `<p class="card">${text(req, 'القسم غير موجود')}</p>`));

async function visibleSection(req, res) {
  const s = await db.prepare('SELECT id,title,owner_id,project_id FROM sections WHERE id=? AND archived=0').get(Number(req.params.id));
  if (!s || !(await canViewProject(req.user, s.project_id))) { notFound(req, res); return null; }
  return s;
}
// a section may hold few attachments and the whole database a bounded amount of file data
async function roomFor(sectionId, bytes) {
  const n = (await db.prepare('SELECT COUNT(*) n FROM attachments WHERE section_id=?').get(sectionId)).n;
  if (n >= A.MAX_PER_SECTION) return 'limit';
  const total = Number((await db.prepare('SELECT COALESCE(SUM(size),0) t FROM attachments').get()).t);
  return total + bytes > A.MAX_TOTAL_BYTES ? 'full' : null;
}

// upload a file (multipart). CSRF is checked after the body is parsed because the token is a form field.
router.post('/sections/:id/attachments', needLogin, (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  return back(res, Number(req.params.id) || 0, err.code === 'LIMIT_FILE_SIZE' ? 'size' : 'invalid');
}), needCsrf, async (req, res) => {
  const s = await visibleSection(req, res); if (!s) return;
  const f = req.file;
  if (!f || !f.size) return back(res, s.id, 'invalid');
  const name = A.cleanName(f.originalname), ext = A.extOf(name);
  if (!A.TYPES[ext]) return back(res, s.id, 'type');
  if (!A.contentMatches(ext, f.buffer)) return back(res, s.id, 'type');
  const full = await roomFor(s.id, f.size);
  if (full) return back(res, s.id, full);
  await db.tx(async (tx) => {
    await tx.prepare('INSERT INTO attachments(section_id,user_id,kind,name,mime,size,data,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(s.id, req.user.id, 'file', name, A.TYPES[ext], f.size, f.buffer, nowIso());
    await notifyProject(tx, { projectId: s.project_id, actorId: req.user.id, type: 'attachment_added', sectionId: s.id, data: { kind: 'file', name } });
  });
  back(res, s.id, 'ok');
});

// add a link to a file somewhere else
router.post('/sections/:id/links', needLogin, needCsrf, async (req, res) => {
  const s = await visibleSection(req, res); if (!s) return;
  const u = A.parseLink(req.body.url);
  if (!u) return back(res, s.id, 'link');
  const full = await roomFor(s.id, 0);
  if (full === 'limit') return back(res, s.id, 'limit');
  const name = String(req.body.title || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || u.hostname;
  await db.tx(async (tx) => {
    await tx.prepare('INSERT INTO attachments(section_id,user_id,kind,name,url,created_at) VALUES(?,?,?,?,?,?)').run(s.id, req.user.id, 'link', name, u.href, nowIso());
    await notifyProject(tx, { projectId: s.project_id, actorId: req.user.id, type: 'attachment_added', sectionId: s.id, data: { kind: 'link', name } });
  });
  back(res, s.id, 'ok');
});

// download / show an image. Served as an isolated, non-executable document.
router.get('/attachments/:id', needLogin, async (req, res) => {
  const a = await db.prepare('SELECT a.id,a.kind,a.name,a.mime,a.size,a.data,s.project_id FROM attachments a JOIN sections s ON s.id=a.section_id WHERE a.id=? AND s.archived=0').get(Number(req.params.id));
  if (!a || a.kind !== 'file' || !(await canViewProject(req.user, a.project_id))) return notFound(req, res);
  const ext = A.extOf(a.name);
  const inline = A.INLINE.has(ext) && req.query.dl !== '1';
  res.set({
    'Content-Type': a.mime, 'Content-Length': String(a.data.length), 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=0, must-revalidate',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download.${ext}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
  });
  res.end(a.data);
});

router.post('/attachments/:id/delete', needLogin, needCsrf, async (req, res) => {
  const a = await db.prepare('SELECT a.id,a.user_id,a.section_id,s.owner_id,s.project_id FROM attachments a JOIN sections s ON s.id=a.section_id WHERE a.id=?').get(Number(req.params.id));
  if (!a || !(await canViewProject(req.user, a.project_id))) return notFound(req, res);
  if (a.user_id !== req.user.id && !canManage(req.user, { owner_id: a.owner_id })) return back(res, a.section_id, 'denied');
  await db.prepare('DELETE FROM attachments WHERE id=?').run(a.id);
  back(res, a.section_id, 'deleted');
});

module.exports = router;
