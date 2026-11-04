const express = require('express');
const { needLogin, needCsrf } = require('../auth');
const { db } = require('../db');
const { text } = require('../i18n');
const { notificationText } = require('../notifications');
const { esc, fmt, page, csrfField } = require('../views');

const router = express.Router();
const PAGE = 30;

router.get('/notifications/count', async (req, res) => {
  if (!req.user) return res.status(401).json({ unread: 0 });
  res.set('Cache-Control', 'no-store').json({ unread: (await db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id)).n });
});

router.get('/notifications', needLogin, async (req, res) => {
  const before = /^\d+$/.test(String(req.query.before || '')) ? Number(req.query.before) : null;
  const rows = await db.prepare(`SELECT n.*, a.name AS actor_name, s.title AS section_title
    FROM notifications n LEFT JOIN users a ON a.id=n.actor_id LEFT JOIN sections s ON s.id=n.section_id
    WHERE n.user_id=? ${before ? 'AND n.id<?' : ''} ORDER BY n.id DESC LIMIT ?`).all(...(before ? [req.user.id, before, PAGE + 1] : [req.user.id, PAGE + 1]));
  const more = rows.length > PAGE; const list = rows.slice(0, PAGE);
  const unread = (await db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id)).n;
  const items = list.map((n) => `<li class="notif${n.read_at ? '' : ' unread'}"><a href="/notifications/${n.id}/open"><span class="notif-text">${esc(notificationText(req, n))}</span><span class="mut notif-time">${esc(fmt(n.created_at, req.lang))}</span></a></li>`).join('');
  const body = `<section class="notifications-page"><div class="notif-head"><h1>${text(req, 'الإشعارات')}</h1>${unread ? `<form method="post" action="/notifications/read-all">${csrfField(req)}<button class="btn ghost" type="submit">${text(req, 'تحديد الكل كمقروء')}</button></form>` : ''}</div>
    ${items ? `<ul class="notif-list card">${items}</ul>` : `<p class="empty">${text(req, 'لا توجد إشعارات.')}</p>`}
    ${more ? `<p><a class="btn ghost" href="/notifications?before=${list[list.length - 1].id}">${text(req, 'عرض الأقدم')}</a></p>` : ''}</section>`;
  res.send(page(req, 'الإشعارات', body));
});

// opening a notification marks it read and goes to the section
router.get('/notifications/:id/open', needLogin, async (req, res) => {
  const n = await db.prepare('SELECT id,section_id FROM notifications WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
  if (!n) return res.redirect('/notifications');
  await db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND read_at IS NULL').run(new Date().toISOString(), n.id);
  res.redirect(n.section_id ? `/sections/${n.section_id}` : '/notifications');
});
router.post('/notifications/read-all', needLogin, needCsrf, async (req, res) => {
  await db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(new Date().toISOString(), req.user.id);
  res.redirect('/notifications');
});

module.exports = router;
