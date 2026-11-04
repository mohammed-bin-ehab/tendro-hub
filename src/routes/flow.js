const express = require('express');
const { needLogin } = require('../auth');
const { db } = require('../db');
const { computeFlow } = require('../flow');
const { text, userName } = require('../i18n');
const { users } = require('../repo');
const { currentProject } = require('../projects');
const { esc, chip, pill, page, projectTabs, noProjectPage } = require('../views');

const router = express.Router();

// ---------- flow page ----------
router.get('/flow', needLogin, async (req, res) => {
  const project = await currentProject(req);
  if (!project.id) return res.send(noProjectPage(req));
  const all = await db.prepare('SELECT * FROM sections WHERE archived=0 AND project_id=? ORDER BY unit,pos').all(project.id);
  const edges = await db.prepare('SELECT d.section_id,d.depends_on_section_id,d.dependency_type FROM section_deps d JOIN sections s ON s.id=d.section_id WHERE s.project_id=?').all(project.id);
  const flow = computeFlow(all, edges);
  const U = Object.fromEntries((await users()).map((u) => [u.id, u]));
  const byId = new Map(all.map((x) => [x.id, x]));
  const title = (x) => esc(text(req, x.title));
  const ownerOf = (x) => x.owner_id && U[x.owner_id] ? userName(req, U[x.owner_id]) : text(req, 'بدون مسؤول');
  const stateLabel = (x) => {
    const f = flow.get(x.id);
    if (f.state === 'done') return text(req, 'مكتمل');
    if (f.state === 'waiting') return `${text(req, 'ينتظر:')} ${f.pendingRequired.map((id) => `${text(req, byId.get(id).title)} (${ownerOf(byId.get(id))})`).join('، ')}`;
    if (f.state === 'draft') return text(req, 'يقدر يبدأ بمسودة');
    return text(req, 'جاهز للبدء');
  };
  // my next steps: ready first, then draft, then waiting; earlier stages first
  const order = { ready: 0, draft: 1, waiting: 2 };
  const mine = all.filter((x) => x.owner_id === req.user.id && x.status !== 'done')
    .sort((a, b) => order[flow.get(a.id).state] - order[flow.get(b.id).state] || flow.get(a.id).stage - flow.get(b.id).stage || a.unit - b.unit || a.pos - b.pos);
  const nextHtml = `<section class="card flow-next"><h2>${text(req, 'خطواتي القادمة')}</h2>${mine.length ? `<ul>${mine.map((x) => `<li class="state-${flow.get(x.id).state}"><a href="/sections/${x.id}"><strong>${title(x)}</strong><span>${esc(stateLabel(x))}</span></a>${pill(x.status, req)}</li>`).join('')}</ul>` : `<p class="mut">${text(req, 'لا توجد خطوات قادمة، كل أقسامك مكتملة.')}</p>`}</section>`;

  const linked = all.filter((x) => flow.get(x.id).linked), free = all.filter((x) => !flow.get(x.id).linked);
  const maxStage = linked.reduce((m, x) => Math.max(m, flow.get(x.id).stage), 0);
  let stages = '';
  for (let n = 1; n <= maxStage; n++) {
    const group = linked.filter((x) => flow.get(x.id).stage === n);
    if (!group.length) continue;
    const cards = group.map((x) => {
      const f = flow.get(x.id);
      const pre = f.prereqs.map((p) => { const d = byId.get(p.id); return `<li class="${p.type}${d.status === 'done' ? ' met' : ''}"><i aria-hidden="true"></i><span>${esc(text(req, d.title))}</span><small>${text(req, p.type === 'mandatory' ? 'إلزامي' : 'مفيد')}</small></li>`; }).join('');
      const unlocks = f.dependents.length ? `<p class="flow-unlocks"><b>${text(req, 'يفتح:')}</b> ${f.dependents.map((id) => esc(text(req, byId.get(id).title))).join('، ')}</p>` : '';
      return `<a class="flow-card state-${f.state}${x.owner_id === req.user.id ? ' mine' : ''}" href="/sections/${x.id}" data-id="${x.id}">
        <div class="flow-card-top"><h3>${title(x)}</h3>${pill(x.status, req)}</div>
        <div class="flow-card-meta">${chip(U[x.owner_id], req.lang)}</div>
        <p class="flow-state">${esc(stateLabel(x))}</p>${pre ? `<ul class="flow-pre">${pre}</ul>` : ''}${unlocks}</a>`;
    }).join('');
    stages += `<li class="flow-stage" data-stage="${n}"><div class="flow-box"><div class="flow-label"><b>${text(req, 'المرحلة')} ${n}</b>${group.length > 1 ? `<span>${group.length} ${text(req, 'فروع متوازية')}</span>` : ''}</div><div class="flow-cards">${cards}</div></div></li>`;
  }
  const freeHtml = free.length ? `<section class="card flow-free"><h2>${text(req, 'مستقلة — لا تحتاج إلى غيرها')}</h2><div class="list">${free.map((x) => `<a class="row" href="/sections/${x.id}"><div class="t"><span class="section-title">${title(x)}</span></div><span class="meta">${chip(U[x.owner_id], req.lang)}${pill(x.status, req)}</span></a>`).join('')}</div></section>` : '';
  const legend = `<p class="flow-legend"><span class="solid">${text(req, 'إلزامي')}</span><span class="dashed">${text(req, 'مفيد')}</span></p>`;
  res.send(page(req, 'مسار العمل', `<section class="flow-page"><h1>${text(req, 'مسار العمل')}</h1>${projectTabs(req, project, 'flow')}<p class="mut">${esc(project.team_name)} · ${esc(project.name)}</p><p class="mut">${text(req, 'اضغط على أي بطاقة لفتح القسم. المسار يتقدّم من المراحل الأولى نحو الأخيرة.')}</p>${legend}${nextHtml}
    <div class="flow-scene" id="flow-scene"><svg class="flow-ribbon" aria-hidden="true" focusable="false"></svg><ol class="flow-stages" aria-label="${text(req, 'مسار العمل بالترتيب')}">${stages}</ol></div>${freeHtml}</section><script src="/static/flow.js?v=1" defer></script>`));
});

module.exports = router;
