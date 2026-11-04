const { SECURE } = require('./config');
const { db } = require('./db');
const { text } = require('./i18n');
const { isAdmin } = require('./permissions');
const { ready } = require('./seed');
const { page } = require('./views');

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
const setCookie = (res, v, age) => res.setHeader('Set-Cookie', `sid=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${SECURE ? '; Secure' : ''}`);
const sessionMiddleware = async (req, res, next) => {
  await ready;
  const cookie = cookies(req);
  req.lang = cookie.lang === 'en' ? 'en' : 'ar';
  const sid = cookie.sid;
  req.user = null;
  req.unread = 0;
  // these never need the user: skip the database round trip entirely
  if (req.path === '/theme.css' || req.path === '/sw.js' || req.path.startsWith('/.well-known/')) return next();
  if (sid) {
    // one round trip: session + user + unread count for the bell (the count is skipped on non-page requests)
    const withCount = req.method === 'GET' && !['/theme.css', '/sw.js', '/notifications/count'].includes(req.path);
    const row = await db.prepare(`SELECT s.csrf, u.id, u.name, u.role,
      ${withCount ? '(SELECT COUNT(*) FROM notifications n WHERE n.user_id=u.id AND n.read_at IS NULL)' : '0'} AS unread
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.created_at>? AND u.active=1`).get(sid, Date.now() - 14 * 864e5);
    if (row) { req.user = { id: row.id, name: row.name, role: row.role }; req.csrf = row.csrf; req.unread = Number(row.unread); }
  }
  next();
};

const needLogin = (req, res, next) => req.user ? next() : res.redirect('/login');
const needAdmin = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).send(page(req, 'غير مسموح', `<p class="form-alert">${text(req, 'لا تملك صلاحية فتح لوحة الإدارة.')}</p>`));
const sameToken = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
const needCsrf = (req, res, next) => (req.body && sameToken(req.body._csrf, req.csrf)) ? next() : res.status(403).send(page(req, 'غير مسموح', `<p class="card">${text(req, 'انتهت صلاحية الصفحة، ارجع وحدّثها ثم جرّب مرة ثانية.')}</p>`));

module.exports = { cookies, setCookie, needLogin, needAdmin, needCsrf, sessionMiddleware };
