const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { cookies, setCookie, needLogin, needCsrf } = require('../auth');
const { db } = require('../db');
const { text, userName } = require('../i18n');
const { users } = require('../repo');
const { esc, page, csrfField } = require('../views');

const router = express.Router();

// ---------- auth ----------
const fails = new Map();
router.get('/login', async (req, res) => {
  if (req.user) return res.redirect('/');
  const selectedUser = /^\d+$/.test(String(req.query.u || '')) ? Number(req.query.u) : 0;
  const opts = (await users()).map((u) => `<option value="${u.id}"${u.id === selectedUser ? ' selected' : ''}>${esc(userName(req, u))}</option>`).join('');
  const lockMessage = req.query.b ? `<p class="form-alert" role="alert">${text(req, 'محاولات كثيرة، جرّب بعد قليل')}</p>` : '';
  const nameError = req.query.e === 'user' ? text(req, 'يرجى اختيار اسمك.') : '';
  const passError = ['password', 'invalid'].includes(String(req.query.e || '')) ? text(req, req.query.e === 'password' ? 'أدخل كلمة المرور.' : 'الاسم أو كلمة السر غير صحيحة') : '';
  res.send(page(req, 'دخول', `<form class="card narrow auth-form" method="post" action="/login" data-loading-label="${text(req, 'جارٍ تسجيل الدخول...')}"><div class="login-brand"><img src="/static/tendro-hub.svg" alt=""><strong>TENDRO HUB</strong></div><h1>${text(req, 'أهلًا بكم 👋')}</h1><p class="mut">${text(req, 'اختر اسمك وأدخل كلمة السر الخاصة بك.')}</p>${lockMessage}
  <label class="${nameError ? 'has-error' : ''}">${text(req, 'الاسم')}<select name="user" required aria-invalid="${Boolean(nameError)}" aria-describedby="user-error"><option value="">${text(req, 'يرجى اختيار اسمك.')}</option>${opts}</select><span class="field-error" id="user-error" role="alert">${nameError}</span></label>
  <label class="${passError ? 'has-error' : ''}">${text(req, 'كلمة السر')}<span class="password-control"><input id="login-password" type="password" name="password" required autocomplete="current-password" aria-invalid="${Boolean(passError)}" aria-describedby="password-error"><button class="password-toggle" type="button" data-password-toggle="login-password" data-show-label="${text(req, 'أظهر كلمة المرور')}" data-hide-label="${text(req, 'أخفِ كلمة المرور')}" aria-label="${text(req, 'أظهر كلمة المرور')}">${text(req, 'أظهر كلمة المرور')}</button></span><span class="field-error" id="password-error" role="alert">${passError}</span></label><button class="btn auth-submit" type="submit">${text(req, 'دخول')}</button></form>`));
});
router.post('/login', async (req, res) => {
  const key = req.ip + ':' + req.body.user;
  const f = fails.get(key) || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 10 * 60e3) return res.redirect('/login?b=1');
  const userId = Number(req.body.user);
  if (!userId) return res.redirect('/login?e=user');
  const password = String(req.body.password || '');
  if (!password) return res.redirect('/login?e=password');
  const u = await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!u || !(await bcrypt.compare(password, u.pass_hash))) {
    if (fails.size > 2000) for (const [k, v] of fails) if (Date.now() - v.t > 10 * 60e3) fails.delete(k); // keep the map small
    fails.set(key, { n: f.n + 1, t: Date.now() });
    return res.redirect(`/login?e=invalid&u=${Number(req.body.user) || ''}`);
  }
  fails.delete(key);
  const sid = crypto.randomBytes(24).toString('hex');
  await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sid, u.id, crypto.randomBytes(16).toString('hex'), Date.now());
  setCookie(res, sid, 14 * 86400);
  res.redirect('/?welcome=1');
});
router.post('/logout', needLogin, needCsrf, async (req, res) => {
  await db.prepare('DELETE FROM sessions WHERE id=?').run(cookies(req).sid);
  setCookie(res, '', 0); res.redirect('/login');
});
router.get('/password', needLogin, async (req, res) => {
  const currentError = req.query.e === 'old' ? text(req, 'كلمة المرور الحالية غير صحيحة.') : '';
  const newError = req.query.e === 'short' ? text(req, 'كلمة المرور الجديدة يجب أن تتكون من 8 أحرف على الأقل.') : '';
  const confirmError = req.query.e === 'match' ? text(req, 'كلمتا المرور الجديدتان غير متطابقتين.') : '';
  const success = req.query.ok ? `<p class="form-success" role="status">${text(req, 'تم تغيير كلمة السر')}</p>` : '';
  const passField = (id, name, label, error, autocomplete, match = false) => `<label class="${error ? 'has-error' : ''}">${label}<span class="password-control"><input id="${id}" type="password" name="${name}" required ${match || name === 'old' ? '' : 'minlength="8"'} autocomplete="${autocomplete}" ${match ? 'data-match-password="new"' : ''} aria-invalid="${Boolean(error)}" aria-describedby="${id}-error"><button class="password-toggle" type="button" data-password-toggle="${id}" data-show-label="${text(req, 'أظهر كلمة المرور')}" data-hide-label="${text(req, 'أخفِ كلمة المرور')}" aria-label="${text(req, 'أظهر كلمة المرور')}">${text(req, 'أظهر كلمة المرور')}</button></span><span class="field-error" id="${id}-error" role="alert">${error}</span></label>`;
  res.send(page(req, 'كلمة السر', `<form class="card narrow auth-form" method="post" action="/password" data-loading-label="${text(req, 'جارٍ حفظ كلمة المرور...')}"><h1>${text(req, 'تغيير كلمة السر')}</h1>${success}${csrfField(req)}
  ${passField('current-password', 'old', text(req, 'الحالية'), currentError, 'current-password')}
  ${passField('new-password', 'new', text(req, 'الجديدة'), newError, 'new-password')}
  ${passField('confirm-password', 'confirm', text(req, 'تأكيد كلمة المرور الجديدة'), confirmError, 'new-password', true)}
  <p class="mut password-hint">${text(req, 'إنشاء كلمة مرور قوية')}</p><button class="btn auth-submit" type="submit">${text(req, 'حفظ')}</button></form>`));
});
router.post('/password', needLogin, needCsrf, async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const nw = String(req.body.new || '');
  if (!(await bcrypt.compare(String(req.body.old || ''), u.pass_hash))) return res.redirect('/password?e=old');
  if (nw.length < 8) return res.redirect('/password?e=short');
  if (nw !== String(req.body.confirm || '')) return res.redirect('/password?e=match');
  await db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(await bcrypt.hash(nw, 10), u.id);
  await db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(u.id, cookies(req).sid); // sign out every other device
  res.redirect('/password?ok=1');
});

module.exports = router;
