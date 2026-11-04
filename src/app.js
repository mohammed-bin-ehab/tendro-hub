const express = require('express');
const path = require('path');
const { sessionMiddleware } = require('./auth');
const { SECURE, ROOT } = require('./config');

const { colorValue } = require('./repo');
const { timing, stats } = require('./db');
const { contrastText } = require('./views');

const app = express();
app.disable('x-powered-by');
// behind Render/Heroku-style proxies set TRUST_PROXY=1 so req.ip is the real visitor (used by the login rate limit)
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});
// SERVER_TIMING=1: adds a Server-Timing header (browser DevTools > Network > Timing) and logs slow requests
if (process.env.SERVER_TIMING === '1') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/static/')) return next();
    const st = { n: 0, ms: 0 }, t0 = process.hrtime.bigint(), c0 = stats.connects;
    const writeHead = res.writeHead;
    res.writeHead = function (...args) {
      if (!res.headersSent) {
        const total = Number(process.hrtime.bigint() - t0) / 1e6;
        res.setHeader('Server-Timing', `db;dur=${st.ms.toFixed(0)};desc="${st.n} queries", app;dur=${(total - st.ms).toFixed(0)}, total;dur=${total.toFixed(0)}`);
        console.log(`[timing] ${req.method} ${req.path} total=${total.toFixed(0)}ms db=${st.ms.toFixed(0)}ms queries=${st.n} new_connections=${stats.connects - c0}`);
      }
      return writeHead.apply(this, args);
    };
    timing.run(st, next);
  });
}
app.use('/static', express.static(path.join(ROOT, 'public'), { maxAge: 0, etag: true, lastModified: true }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(sessionMiddleware);
// per-user limit on writes (spam / runaway scripts): 120 POSTs per minute
const writes = new Map();
app.use((req, res, next) => {
  if (req.method !== 'POST' || !req.user) return next();
  const now = Date.now(), w = writes.get(req.user.id) || { start: now, n: 0 };
  if (now - w.start > 60000) { w.start = now; w.n = 0; }
  w.n++; writes.set(req.user.id, w);
  if (writes.size > 5000) for (const [k, v] of writes) if (now - v.start > 60000) writes.delete(k);
  if (w.n > 120) return res.status(429).set('Retry-After', '60').send('Too many requests. Try again in a minute.');
  next();
});
app.get('/sw.js', async (req, res) => {
  res.set('Service-Worker-Allowed', '/').set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(ROOT, 'public', 'sw.js'));
});
app.get('/language/:lang', async (req, res) => {
  const lang = req.params.lang === 'en' ? 'en' : 'ar';
  res.setHeader('Set-Cookie', `lang=${lang}; SameSite=Lax; Path=/; Max-Age=31536000${SECURE ? '; Secure' : ''}`);
  let target = '/';
  const returnTo = String(req.query.returnTo || '');
  // same-site paths only: "//host" and "/\\host" are treated by browsers as other sites
  if (/^\/(?![/\\])[^\u0000-\u001f\\]*$/.test(returnTo)) target = returnTo;
  res.redirect(target);
});
app.get('/theme.css', async (req, res) => {
  const accent = (await colorValue('accent'));
  const common = `--brand-primary:${accent};--brand-ink:${contrastText(accent)};`;
  res.type('text/css').set('Cache-Control', 'no-store').send(
    `:root,:root[data-theme="light"]{${common}--page:${(await colorValue('lightPage'))};--surface:${(await colorValue('lightSurface'))};--ink:${(await colorValue('lightText'))}}` +
    `:root[data-theme="dark"]{${common}--page:${(await colorValue('darkPage'))};--surface:${(await colorValue('darkSurface'))};--ink:${(await colorValue('darkText'))}}`
  );
});

// routes
for (const name of ['auth', 'admin', 'projects', 'notifications', 'attachments', 'dashboard', 'flow', 'sections']) app.use(require('./routes/' + name));

// unknown paths and unexpected errors: generic pages, details only in the server log
app.use((req, res) => res.status(404).send('Not found'));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Unhandled error on', req.method, req.path, '-', err?.message);
  if (res.headersSent) return;
  res.status(500).send('Something went wrong. Please try again.');
});

module.exports = { app };
