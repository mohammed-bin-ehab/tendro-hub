const { enText, text, statusName, userName } = require('./i18n');
const { isAdmin } = require('./permissions');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowIso = () => new Date().toISOString();
const fmt = (iso, lang = 'ar') => iso ? new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-u-nu-latn', { timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short' }) : '';
const chip = (u, lang = 'ar') => u ? `<span class="who"><i class="c${u.id % 6}"></i>${esc(lang === 'en' ? enText(u.name) : u.name)}</span>` : `<span class="who"><i class="team"></i>${lang === 'en' ? 'Team' : 'الفريق'}</span>`;
function dependencyPresentation(req, section, dependencies = []) {
  if (section.status === 'done') return null;
  const pendingRequired = dependencies.filter((dep) => dep.dependency_type === 'mandatory' && dep.status !== 'done');
  const pendingHelpful = dependencies.filter((dep) => dep.dependency_type === 'helpful' && dep.status !== 'done');
  const ownerName = (dep) => dep.owner_name ? userName(req, { id: dep.owner_id, name: dep.owner_name }) : text(req, 'بدون مسؤول');
  let summary;
  if (pendingRequired.length === 1) {
    const dep = pendingRequired[0];
    summary = `${text(req, 'بعد:')} ${text(req, dep.title)} (${ownerName(dep)})`;
  } else if (pendingRequired.length > 1) {
    summary = `${text(req, 'ينتظر:')} ${pendingRequired.map((dep) => `${text(req, dep.title)} (${ownerName(dep)})`).join('، ')}`;
  } else if (pendingHelpful.length) summary = text(req, 'يقدر يبدأ بمسودة');
  else summary = text(req, 'جاهز للبدء');
  return { summary, dependencies: dependencies.map((dep) => ({
    title: text(req, dep.title), owner: ownerName(dep), status: statusName(req, dep.status),
    type: text(req, dep.dependency_type === 'mandatory' ? 'إلزامي' : 'مفيد'),
    note: req.lang === 'en' ? dep.note_en : dep.note_ar
  })) };
}
function dependencyNoteMarkup(req, presentation, detailed = false) {
  if (!presentation) return '';
  const list = detailed && presentation.dependencies.length ? `<div class="dependency-list"><strong>${text(req, 'أحتاج من:')}</strong><ul>${presentation.dependencies.map((dep) => `<li><span>${esc(dep.title)} · ${esc(dep.owner)} · ${esc(dep.status)} · ${esc(dep.type)}</span>${dep.note ? `<small>${text(req,'ملاحظة:')} ${esc(dep.note)}</small>` : ''}</li>`).join('')}</ul></div>` : '';
  return `<div class="dependency-note${detailed ? ' dependency-panel' : ''}"><span><strong>${text(req,'ملاحظة:')}</strong> ${esc(presentation.summary)}</span>${list}</div>`;
}
const SUN = '<svg class="ic-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const MOON = '<svg class="ic-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
function page(req, title, body) {
  const lang = req.lang || 'ar';
  const ar = lang === 'ar';
  const path = req.path || '/';
  const on = (match) => (match(path) ? ' class="on" aria-current="page"' : '');
  const links = req.user ? `<nav class="mainnav" aria-label="${ar ? 'التنقل الرئيسي' : 'Main navigation'}">
      <a href="/"${on((p) => p === '/' || p.startsWith('/sections/'))}>${text(req, 'الأقسام')}</a>
      <a href="/flow"${on((p) => p === '/flow')}>${text(req, 'مسار العمل')}</a>
      ${isAdmin(req.user) ? `<a href="/admin"${on((p) => p.startsWith('/admin'))}>${text(req, 'لوحة الإدارة')}</a>` : ''}</nav>` : '';
  const bell = req.user ? `<a class="tool bell${path.startsWith('/notifications') ? ' on' : ''}" href="/notifications" aria-label="${text(req, 'الإشعارات')}" title="${text(req, 'الإشعارات')}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="bell-count" id="bell-count"${req.unread ? '' : ' hidden'}>${req.unread > 9 ? '9+' : req.unread}</span></a>` : '';
  const themeBtn = `<button class="tool theme-toggle" type="button" id="theme-toggle" data-icon="1" data-light-label="${ar ? 'الوضع الفاتح' : 'Light mode'}" data-dark-label="${ar ? 'الوضع الداكن' : 'Dark mode'}" aria-label="${ar ? 'الوضع الداكن' : 'Dark mode'}" title="${ar ? 'تبديل الوضع الفاتح/الداكن' : 'Switch light / dark'}">${MOON}${SUN}</button>`;
  const langLink = `<a class="tool lang-switch" href="/language/${ar ? 'en' : 'ar'}?returnTo=${encodeURIComponent(req.originalUrl || '/')}" hreflang="${ar ? 'en' : 'ar'}" lang="${ar ? 'en' : 'ar'}">${ar ? 'English' : 'العربية'}</a>`;
  const userMenu = req.user ? `<details class="usermenu"><summary aria-label="${ar ? 'قائمة الحساب' : 'Account menu'}">${chip(req.user, lang)}<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="menu"><a href="/password"${path === '/password' ? ' aria-current="page"' : ''}>${text(req, 'كلمة السر')}</a>
      <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(req.csrf)}"><button type="submit">${text(req, 'خروج')}</button></form></div></details>` : '';
  const brandName = ar ? 'تندرو هب' : 'TENDRO HUB';
  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(text(req, title))} — ${brandName}</title><link rel="stylesheet" href="/static/style.css?v=16"><link rel="stylesheet" href="/theme.css"><script src="/static/app.js?v=14" defer></script></head><body>
<header class="topbar"><a class="brand" href="/" aria-label="${brandName}"><img class="brand-logo" src="/static/tendro-hub.svg" alt=""><span>${brandName}</span></a>${links}<div class="tools">${bell}${themeBtn}${langLink}${userMenu}</div></header><div id="network-status" class="network-status" role="status" aria-live="polite" hidden></div><main>${body}</main></body></html>`;
}
const csrfField = (req) => `<input type="hidden" name="_csrf" value="${esc(req.csrf)}">`;
const pill = (st, req) => `<span class="pill ${st}">${statusName(req, st)}</span>`;
const contrastText = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.42 ? '#111111' : '#ffffff';
};

// project switcher (only when the person can see more than one project)
const projectTabs = (req, info, to = '') => info.all.length > 1
  ? `<div class="tabs project-tabs" aria-label="${req.lang === 'en' ? 'Projects' : 'المشاريع'}">${info.all.map((p) => `<a class="${p.id === info.id ? 'on' : ''}" href="/project/${p.id}${to ? '?to=' + to : ''}">${esc(p.name)}</a>`).join('')}</div>` : '';
const noProjectPage = (req) => page(req, 'الأقسام', `<section class="card"><h1>${text(req, 'لا يوجد مشروع بعد')}</h1><p class="mut">${text(req, 'لست عضوًا في أي فريق. اطلب من المدير إضافتك إلى فريق.')}</p></section>`);

module.exports = { projectTabs, noProjectPage, esc, nowIso, fmt, chip, pill, page, csrfField, contrastText, dependencyPresentation, dependencyNoteMarkup };
