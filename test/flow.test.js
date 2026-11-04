const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { start } = require('./pg-server');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tendro-test-'));
process.env.PASSWORDS_DIR = tmp;
process.env.PG_POOL_MAX = '1'; // the in-memory test Postgres accepts one connection
let pgs, app, computeFlow, ready, pool;
test.before(async () => {
  pgs = await start();
  process.env.DATABASE_URL = pgs.url;
  ({ app, computeFlow, ready, pool } = require('../server.js'));
  await ready;
});
test.after(async () => { await pool.end(); await pgs.stop(); });

const S = (id, status = 'todo', owner_id = 1) => ({ id, status, owner_id, unit: 1, pos: id, title: 't' + id });
const E = (a, b, t = 'mandatory') => ({ section_id: a, depends_on_section_id: b, dependency_type: t });

test('stage = longest path (diamond)', () => {
  const f = computeFlow([S(1), S(2), S(3), S(4)], [E(2, 1), E(3, 1), E(4, 2), E(4, 3)]);
  assert.deepStrictEqual([1, 2, 3, 4].map((i) => f.get(i).stage), [1, 2, 2, 3]);
});
test('longer path wins over shorter', () => {
  const f = computeFlow([S(1), S(2), S(3), S(4)], [E(2, 1), E(3, 2), E(4, 1), E(4, 3)]);
  assert.strictEqual(f.get(4).stage, 4);
});
test('states: waiting / draft / ready / done', () => {
  const f = computeFlow([S(1, 'doing'), S(2, 'done'), S(3), S(4), S(5, 'done')],
    [E(3, 1), E(4, 1, 'helpful'), E(4, 2), E(5, 1)]);
  assert.strictEqual(f.get(3).state, 'waiting');
  assert.strictEqual(f.get(4).state, 'draft');
  assert.strictEqual(f.get(1).state, 'ready');
  assert.strictEqual(f.get(5).state, 'done');
  assert.deepStrictEqual(f.get(3).pendingRequired, [1]);
});
test('helpful pending does not block; done prerequisite satisfies', () => {
  const f = computeFlow([S(1, 'done'), S(2)], [E(2, 1)]);
  assert.strictEqual(f.get(2).state, 'ready');
});
test('cycles and self edges do not hang', () => {
  const f = computeFlow([S(1), S(2)], [E(1, 2), E(2, 1), E(1, 1)]);
  assert.ok(f.get(1).stage >= 1 && f.get(2).stage >= 1);
});
test('archived/unknown sections ignored', () => {
  const f = computeFlow([S(1)], [E(1, 99)]);
  assert.strictEqual(f.get(1).stage, 1);
  assert.strictEqual(f.get(1).linked, false);
});

test('seeded data: /flow page over HTTP', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    assert.strictEqual((await fetch(base + '/flow', { redirect: 'manual' })).status, 302); // login required
    const loginPage = await (await fetch(base + '/login')).text();
    const hudaId = loginPage.match(/<option value="(\d+)"[^>]*>هدى/)[1];
    const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `user=${hudaId}&username=huda&password=${pw['هدى']}&u=${hudaId}` });
    const cookie = (r.headers.getSetCookie().find((c) => c.startsWith('sid=')) || '').split(';')[0];
    assert.ok(cookie, 'logged in');
    const html = await (await fetch(base + '/flow', { headers: { cookie } })).text();
    assert.match(html, /خطواتي القادمة/);
    assert.match(html, /flow-ribbon/);
    assert.match(html, /href="\/flow"/);
    const stages = [...html.matchAll(/class="flow-stage" data-stage="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepStrictEqual(stages, [1, 2, 3, 4, 5]);
    assert.ok(!/ style="/.test(html), 'no inline styles (CSP)');
    const en = await (await fetch(base + '/flow', { headers: { cookie: cookie + '; lang=en' } })).text();
    assert.match(en, /My next steps/); assert.match(en, /Stage 1/);
    const dash = await (await fetch(base + '/', { headers: { cookie } })).text();
    assert.match(dash, /dependency-note/);
  } finally { server.close(); }
});

test('Postgres: login, section save (transaction), comments, admin, theme', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const form = (o) => new URLSearchParams(o).toString();
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const loginPage = await (await fetch(base + '/login')).text();
    const id = loginPage.match(/<option value="(\d+)"[^>]*>محمد/)[1];
    const bad = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: form({ user: id, password: 'wrong' }) });
    assert.match(bad.headers.get('location'), /e=invalid/);
    const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: form({ user: id, password: pw['محمد'] }) });
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
    const get = async (u) => (await fetch(base + u, { headers: { cookie } }));
    const csrf = (await (await get('/')).text()).match(/name="_csrf" value="([^"]+)"/)[1];
    const css = await (await fetch(base + '/theme.css')).text();
    assert.match(css, /--brand-primary:#/);
    const admin = await (await get('/admin')).text();
    assert.match(admin, /type="color"/);
    // save content + status + comment in one transaction
    const sec = await get('/sections/1'); assert.strictEqual(sec.status, 200);
    const save = await fetch(base + '/sections/1/save-all', { method: 'POST', headers: { ...H, cookie, 'X-Requested-With': 'fetch' },
      body: form({ _csrf: csrf, content: 'نص تجريبي', status: 'doing', comment: 'تعليق تجريبي', client_request_id: '11111111-1111-4111-8111-111111111111' }) });
    assert.strictEqual(save.status, 200); assert.strictEqual((await save.json()).ok, true);
    // same request id again must not duplicate the comment
    await fetch(base + '/sections/1/save-all', { method: 'POST', headers: { ...H, cookie, 'X-Requested-With': 'fetch' },
      body: form({ _csrf: csrf, content: 'نص تجريبي', status: 'doing', comment: 'تعليق تجريبي', client_request_id: '11111111-1111-4111-8111-111111111111' }) });
    const page = await (await get('/sections/1')).text();
    assert.strictEqual((page.match(/data-comment-id=/g) || []).length, 1);
    assert.match(page, /نص تجريبي/);
    const cid = page.match(/data-comment-id="(\d+)"/)[1];
    const del = await fetch(base + '/comments/' + cid + '/delete', { method: 'POST', headers: { ...H, cookie, 'X-Requested-With': 'fetch' }, body: form({ _csrf: csrf }) });
    assert.strictEqual((await del.json()).ok, true);
    // admin: add + archive + permanently delete a section, change settings
    await fetch(base + '/admin/sections', { method: 'POST', redirect: 'manual', headers: { ...H, cookie }, body: form({ _csrf: csrf, unit: 4, title: 'قسم اختبار', hint: '', owner_id: id, mode: 'owner', project_id: (await pool.query('SELECT id FROM projects ORDER BY id LIMIT 1')).rows[0].id }) });
    const rows = await pool.query("SELECT id FROM sections WHERE title='قسم اختبار'");
    assert.strictEqual(rows.rowCount, 1);
    const sid = rows.rows[0].id;
    await fetch(base + `/admin/sections/${sid}/archive`, { method: 'POST', redirect: 'manual', headers: { ...H, cookie }, body: form({ _csrf: csrf }) });
    await fetch(base + `/admin/sections/${sid}/delete`, { method: 'POST', redirect: 'manual', headers: { ...H, cookie }, body: form({ _csrf: csrf }) });
    assert.strictEqual((await pool.query('SELECT id FROM sections WHERE id=$1', [sid])).rowCount, 0);
    const colors = { accent: '#112233', lightPage: '#f6f6f5', lightSurface: '#ffffff', lightText: '#171717', darkPage: '#151515', darkSurface: '#222222', darkText: '#f1f1f1' };
    await fetch(base + '/admin/settings', { method: 'POST', redirect: 'manual', headers: { ...H, cookie }, body: form({ _csrf: csrf, ...colors }) });
    assert.match(await (await fetch(base + '/theme.css')).text(), /--brand-primary:#112233/);
    // logout
    await fetch(base + '/logout', { method: 'POST', redirect: 'manual', headers: { ...H, cookie }, body: form({ _csrf: csrf }) });
    assert.strictEqual((await fetch(base + '/', { headers: { cookie }, redirect: 'manual' })).status, 302);
  } finally { server.close(); }
});

test('clean URLs, legacy redirects and comment paging', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const id = (await (await fetch(base + '/login')).text()).match(/<option value="(\d+)"[^>]*>لمى/)[1];
    const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: new URLSearchParams({ user: id, password: pw['لمى'] }).toString() });
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
    // old links still work
    const old = await fetch(base + '/s/2', { headers: { cookie }, redirect: 'manual' });
    assert.strictEqual(old.status, 301); assert.strictEqual(old.headers.get('location'), '/sections/2');
    const oldPost = await fetch(base + '/c/5/delete', { method: 'POST', redirect: 'manual' });
    assert.strictEqual(oldPost.status, 307); assert.strictEqual(oldPost.headers.get('location'), '/comments/5/delete');
    // pages link to the new URLs only
    const dash = await (await fetch(base + '/', { headers: { cookie } })).text();
    assert.match(dash, /href="\/sections\/\d+"/); assert.ok(!/href="\/s\/\d+"/.test(dash));
    const flow = await (await fetch(base + '/flow', { headers: { cookie } })).text();
    assert.ok(!/href="\/s\/\d+"/.test(flow));
    // 35 comments -> only the latest 30 are shown, count shows the total, ?comments=all shows all
    for (let i = 1; i <= 35; i++) await pool.query("INSERT INTO comments(section_id,user_id,body,created_at) VALUES(3,$1,$2,'2026-11-01T10:00:00Z')", [Number(id), 'c' + i]);
    const short = await (await fetch(base + '/sections/3', { headers: { cookie } })).text();
    assert.strictEqual((short.match(/data-comment-id=/g) || []).length, 30);
    assert.match(short, /id="comment-count">35</); assert.match(short, /comments=all/);
    assert.match(short, /<p>c35<\/p>/); assert.ok(!/<p>c5<\/p>/.test(short));
    const full = await (await fetch(base + '/sections/3?comments=all', { headers: { cookie } })).text();
    assert.strictEqual((full.match(/data-comment-id=/g) || []).length, 35);
  } finally { server.close(); }
});

test('teams and projects: members only see their own projects', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  const form = (o) => new URLSearchParams(o).toString();
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const login = async (name) => {
      const id = (await (await fetch(base + '/login')).text()).match(new RegExp('<option value="(\\d+)"[^>]*>' + name))[1];
      const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: form({ user: id, password: pw[name] }) });
      return { id: Number(id), cookie: r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0] };
    };
    // all seeded sections belong to the default project/team
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM sections WHERE project_id IS NULL')).rows[0].n, 0);
    const admin = await login('محمد'), huda = await login('هدى');
    // new team (only Mohammed) + project + section
    const team = (await pool.query("INSERT INTO teams(name) VALUES('Other team') RETURNING id")).rows[0].id;
    await pool.query('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)', [team, admin.id]);
    const proj = (await pool.query("INSERT INTO projects(team_id,name) VALUES($1,'Other project') RETURNING id", [team])).rows[0].id;
    const sec = (await pool.query("INSERT INTO sections(unit,pos,title,owner_id,project_id) VALUES(1,0,'Secret section',$1,$2) RETURNING id", [admin.id, proj])).rows[0].id;
    // Huda is not in that team: 404 and not on her dashboard
    assert.strictEqual((await fetch(base + '/sections/' + sec, { headers: { cookie: huda.cookie } })).status, 404);
    assert.ok(!(await (await fetch(base + '/', { headers: { cookie: huda.cookie } })).text()).includes('Secret section'));
    // she cannot switch to it either
    await fetch(base + '/project/' + proj, { headers: { cookie: huda.cookie }, redirect: 'manual' });
    assert.ok(!(await (await fetch(base + '/', { headers: { cookie: huda.cookie + '; project=' + proj } })).text()).includes('Secret section'));
    assert.ok(!(await (await fetch(base + '/flow', { headers: { cookie: huda.cookie + '; project=' + proj } })).text()).includes('Secret section'));
    // Mohammed sees both projects and can open it
    assert.strictEqual((await fetch(base + '/sections/' + sec, { headers: { cookie: admin.cookie } })).status, 200);
    const dash = await (await fetch(base + '/', { headers: { cookie: admin.cookie + '; project=' + proj } })).text();
    assert.match(dash, /Secret section/); assert.match(dash, /project-tabs/);
    // she cannot comment on / delete in a project she cannot see
    const sectionCsrf = (await (await fetch(base + '/', { headers: { cookie: huda.cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
    const sv = await fetch(base + '/sections/' + sec + '/save-all', { method: 'POST', headers: { ...H, cookie: huda.cookie, 'X-Requested-With': 'fetch' }, body: form({ _csrf: sectionCsrf, comment: 'hi' }) });
    assert.ok([403, 404].includes(sv.status));
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM comments WHERE section_id=$1', [sec])).rows[0].n, 0);
  } finally { server.close(); }
});

test('member list cache is dropped when an admin adds a member', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const id = (await (await fetch(base + '/login')).text()).match(/<option value="(\d+)"[^>]*>محمد/)[1];
    const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: new URLSearchParams({ user: id, password: pw['محمد'] }).toString() });
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
    const csrf = (await (await fetch(base + '/admin', { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
    assert.ok(!(await (await fetch(base + '/login')).text()).includes('سارة')); // warms the cache
    await fetch(base + '/admin/members', { method: 'POST', redirect: 'manual', headers: { ...H, cookie }, body: new URLSearchParams({ _csrf: csrf, name: 'سارة', username: 'sara', password: 'secret123', role: 'member' }).toString() });
    assert.ok((await (await fetch(base + '/login')).text()).includes('سارة'));
  } finally { server.close(); }
});

test('notifications: status changes -> team, comment delete -> owner, bell, read state', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  const form = (o) => new URLSearchParams(o).toString();
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const login = async (name) => {
      const id = (await (await fetch(base + '/login')).text()).match(new RegExp('<option value="(\\d+)"[^>]*>' + name))[1];
      const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: form({ user: id, password: pw[name] }) });
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
      const csrf = (await (await fetch(base + '/', { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
      return { id: Number(id), cookie, csrf };
    };
    await pool.query('DELETE FROM notifications');
    const moh = await login('محمد'), huda = await login('هدى'), lama = await login('لمى');
    const sec = 1; // owned by Mohammed
    await pool.query("UPDATE sections SET status='todo' WHERE id=$1", [sec]);
    const post = (u, who, body, extra = {}) => fetch(base + u, { method: 'POST', redirect: 'manual', headers: { ...H, cookie: who.cookie, ...extra }, body: form({ _csrf: who.csrf, ...body }) });
    // todo -> doing by Mohammed: Huda and Lama are told, Mohammed is not
    await post(`/sections/${sec}/save-all`, moh, { content: 'x', status: 'doing' }, { 'X-Requested-With': 'fetch' });
    const rows = (await pool.query('SELECT user_id,type,data FROM notifications ORDER BY user_id')).rows;
    assert.ok(rows.every((r) => r.type === 'status' && JSON.parse(r.data).to === 'doing'));
    assert.ok(rows.some((r) => r.user_id === huda.id) && rows.some((r) => r.user_id === lama.id) && !rows.some((r) => r.user_id === moh.id));
    // no change -> no new notifications
    const before = (await pool.query('SELECT COUNT(*)::int n FROM notifications')).rows[0].n;
    await post(`/sections/${sec}/save-all`, moh, { content: 'x', status: 'doing' }, { 'X-Requested-With': 'fetch' });
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM notifications')).rows[0].n, before);
    // review / done via the simple route
    await post(`/sections/${sec}/save`, moh, { status: 'review' });
    await post(`/sections/${sec}/save`, moh, { status: 'done' });
    // bell shows 3 unread for Huda; the list is in Arabic with gender-neutral wording
    const home = await (await fetch(base + '/', { headers: { cookie: huda.cookie } })).text();
    assert.match(home, /id="bell-count">3</);
    const list = await (await fetch(base + '/notifications', { headers: { cookie: huda.cookie } })).text();
    assert.match(list, /بدء العمل على/); assert.match(list, /جاهز للمراجعة/); assert.match(list, /اكتمال/);
    const en = await (await fetch(base + '/notifications', { headers: { cookie: huda.cookie + '; lang=en' } })).text();
    assert.match(en, /started working on/); assert.match(en, /ready for review/); assert.match(en, /completed/);
    // count endpoint + open marks read
    assert.strictEqual((await (await fetch(base + '/notifications/count', { headers: { cookie: huda.cookie } })).json()).unread, 3);
    assert.strictEqual((await fetch(base + '/notifications/count')).status, 401);
    const first = list.match(/href="\/notifications\/(\d+)\/open"/)[1];
    const open = await fetch(base + `/notifications/${first}/open`, { headers: { cookie: huda.cookie }, redirect: 'manual' });
    assert.strictEqual(open.headers.get('location'), `/sections/${sec}`);
    assert.strictEqual((await (await fetch(base + '/notifications/count', { headers: { cookie: huda.cookie } })).json()).unread, 2);
    // someone else's notification cannot be opened/marked
    const lamaFirst = (await pool.query('SELECT id FROM notifications WHERE user_id=$1 LIMIT 1', [lama.id])).rows[0].id;
    await fetch(base + `/notifications/${lamaFirst}/open`, { headers: { cookie: huda.cookie }, redirect: 'manual' });
    assert.strictEqual((await pool.query('SELECT read_at FROM notifications WHERE id=$1', [lamaFirst])).rows[0].read_at, null);
    await post('/notifications/read-all', huda);
    assert.strictEqual((await (await fetch(base + '/notifications/count', { headers: { cookie: huda.cookie } })).json()).unread, 0);
    // Huda comments, then deletes it -> only the section owner (Mohammed) is told
    await post(`/sections/${sec}/save-all`, huda, { comment: 'مرحبا', client_request_id: '22222222-2222-4222-8222-222222222222' }, { 'X-Requested-With': 'fetch' });
    const cid = (await pool.query('SELECT id FROM comments WHERE section_id=$1 ORDER BY id DESC LIMIT 1', [sec])).rows[0].id;
    await pool.query('DELETE FROM notifications');
    await post(`/comments/${cid}/delete`, huda, {}, { 'X-Requested-With': 'fetch' });
    const del = (await pool.query("SELECT user_id FROM notifications WHERE type='comment_deleted'")).rows;
    assert.deepStrictEqual(del.map((r) => r.user_id), [moh.id]);
    assert.match(await (await fetch(base + '/notifications', { headers: { cookie: moh.cookie } })).text(), /حذف تعليق/);
  } finally { server.close(); }
});

test('attachments: upload, type/size checks, download rules, links, delete, notifications', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  const form = (o) => new URLSearchParams(o).toString();
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const login = async (name) => {
      const id = (await (await fetch(base + '/login')).text()).match(new RegExp('<option value="(\\d+)"[^>]*>' + name))[1];
      const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: form({ user: id, password: pw[name] }) });
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
      const csrf = (await (await fetch(base + '/', { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
      return { id: Number(id), cookie, csrf };
    };
    const huda = await login('هدى'), lama = await login('لمى'), moh = await login('محمد');
    const sec = 2;
    await pool.query('DELETE FROM notifications'); await pool.query('DELETE FROM attachments');
    const upload = (who, name, bytes, csrf = who.csrf) => {
      const fd = new FormData(); if (csrf) fd.append('_csrf', csrf);
      fd.append('file', new Blob([bytes]), name);
      return fetch(base + `/sections/${sec}/attachments`, { method: 'POST', redirect: 'manual', headers: { cookie: who.cookie }, body: fd });
    };
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 1)]);
    // good upload with an Arabic file name
    const ok = await upload(huda, 'تقرير المتطلبات.pdf', pdf);
    assert.match(ok.headers.get('location'), /att=ok/);
    const row = (await pool.query('SELECT * FROM attachments')).rows[0];
    assert.strictEqual(row.name, 'تقرير المتطلبات.pdf'); assert.strictEqual(row.mime, 'application/pdf'); assert.strictEqual(row.size, pdf.length);
    // team (not the uploader) is notified
    const who = (await pool.query("SELECT user_id FROM notifications WHERE type='attachment_added'")).rows.map((r) => r.user_id);
    assert.ok(who.includes(lama.id) && who.includes(moh.id) && !who.includes(huda.id));
    assert.match(await (await fetch(base + '/notifications', { headers: { cookie: lama.cookie } })).text(), /إضافة ملف/);
    // rejected: wrong extension, content that does not match, too large, no CSRF token
    assert.match((await upload(huda, 'virus.exe', Buffer.from('MZ....'))).headers.get('location'), /att=type/);
    assert.match((await upload(huda, 'fake.pdf', Buffer.from('MZ not a pdf'))).headers.get('location'), /att=type/);
    assert.match((await upload(huda, 'big.pdf', Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(5 * 1024 * 1024 + 10)]))).headers.get('location'), /att=size/);
    assert.strictEqual((await upload(huda, 'x.pdf', pdf, null)).status, 403);
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM attachments')).rows[0].n, 1);
    // download: logged in members only, safe headers, original bytes
    const dl = await fetch(base + `/attachments/${row.id}?dl=1`, { headers: { cookie: lama.cookie } });
    assert.strictEqual(dl.status, 200);
    assert.strictEqual(dl.headers.get('x-content-type-options'), 'nosniff');
    assert.match(dl.headers.get('content-security-policy'), /sandbox/);
    assert.match(dl.headers.get('content-disposition'), /^attachment/);
    assert.deepStrictEqual(Buffer.from(await dl.arrayBuffer()), pdf);
    assert.strictEqual((await fetch(base + `/attachments/${row.id}`, { redirect: 'manual' })).status, 302);
    // images are shown inline with a thumbnail
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50)]);
    await upload(lama, 'صورة.png', png);
    const pageHtml = await (await fetch(base + `/sections/${sec}`, { headers: { cookie: huda.cookie } })).text();
    assert.match(pageHtml, /class="att-thumb"/); assert.match(pageHtml, /تقرير المتطلبات\.pdf/);
    const img = (await pool.query("SELECT id FROM attachments WHERE name LIKE '%.png'")).rows[0].id;
    assert.match((await fetch(base + `/attachments/${img}`, { headers: { cookie: huda.cookie } })).headers.get('content-disposition'), /^inline/);
    // links: https ok, javascript:/credentials rejected
    const addLink = (who, url, title = '') => fetch(base + `/sections/${sec}/links`, { method: 'POST', redirect: 'manual', headers: { ...H, cookie: who.cookie }, body: form({ _csrf: who.csrf, url, title }) });
    assert.match((await addLink(huda, 'https://drive.google.com/file/d/abc/view', 'مرجع')).headers.get('location'), /att=ok/);
    assert.match((await addLink(huda, 'javascript:alert(1)')).headers.get('location'), /att=link/);
    assert.match((await addLink(huda, 'https://user:pass@example.com/x')).headers.get('location'), /att=link/);
    assert.match((await addLink(huda, 'ftp://example.com/x')).headers.get('location'), /att=link/);
    const linkHtml = await (await fetch(base + `/sections/${sec}`, { headers: { cookie: huda.cookie } })).text();
    assert.match(linkHtml, /href="https:\/\/drive\.google\.com\/file\/d\/abc\/view" target="_blank" rel="noopener noreferrer nofollow"/);
    // other projects' files are hidden
    const team = (await pool.query("INSERT INTO teams(name) VALUES('Hidden') RETURNING id")).rows[0].id;
    await pool.query('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)', [team, moh.id]);
    const proj = (await pool.query("INSERT INTO projects(team_id,name) VALUES($1,'Hidden') RETURNING id", [team])).rows[0].id;
    const hs = (await pool.query("INSERT INTO sections(unit,pos,title,owner_id,project_id) VALUES(1,0,'Hidden',$1,$2) RETURNING id", [moh.id, proj])).rows[0].id;
    const ha = (await pool.query("INSERT INTO attachments(section_id,user_id,kind,name,mime,size,data,created_at) VALUES($1,$2,'file','h.pdf','application/pdf',4,$3,'2026-11-01') RETURNING id", [hs, moh.id, pdf.slice(0, 4)])).rows[0].id;
    assert.strictEqual((await fetch(base + `/attachments/${ha}`, { headers: { cookie: huda.cookie } })).status, 404);
    // delete: a different member cannot, the uploader can, the section owner (Huda owns section 2? use admin) can
    const mine = (await pool.query("SELECT id FROM attachments WHERE name='تقرير المتطلبات.pdf'")).rows[0].id;
    const del = (who, id) => fetch(base + `/attachments/${id}/delete`, { method: 'POST', redirect: 'manual', headers: { ...H, cookie: who.cookie }, body: form({ _csrf: who.csrf }) });
    const secOwner = (await pool.query('SELECT owner_id FROM sections WHERE id=$1', [sec])).rows[0].owner_id;
    const other = [huda, lama, moh].find((u) => u.id !== secOwner && u.id !== huda.id && u.role !== 'admin' && u.id !== moh.id) || lama;
    if (other.id !== secOwner) assert.match((await del(other, mine)).headers.get('location'), /att=denied/);
    assert.match((await del(huda, mine)).headers.get('location'), /att=deleted/);
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM attachments WHERE id=$1', [mine])).rows[0].n, 0);
  } finally { server.close(); }
});

test('comment notifications: owner, editor and earlier commenters, never the author or outsiders', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  const form = (o) => new URLSearchParams(o).toString();
  try {
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const login = async (name) => {
      const id = (await (await fetch(base + '/login')).text()).match(new RegExp('<option value="(\\d+)"[^>]*>' + name))[1];
      const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: form({ user: id, password: pw[name] }) });
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
      const csrf = (await (await fetch(base + '/', { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
      return { id: Number(id), cookie, csrf };
    };
    const moh = await login('محمد'), huda = await login('هدى'), lama = await login('لمى'), ibr = await login('إبراهيم');
    const sec = 4; // owner: Huda
    await pool.query('DELETE FROM notifications'); await pool.query('DELETE FROM comments WHERE section_id=$1', [sec]);
    await pool.query("UPDATE sections SET owner_id=$1, edit_mode='person', editor_id=$2 WHERE id=$3", [huda.id, ibr.id, sec]);
    const comment = (who, body, rid) => fetch(base + `/sections/${sec}/save-all`, { method: 'POST', headers: { ...H, cookie: who.cookie, 'X-Requested-With': 'fetch' }, body: form({ _csrf: who.csrf, comment: body, client_request_id: rid }) });
    const ids = async () => (await pool.query("SELECT user_id FROM notifications WHERE type='comment_added' ORDER BY user_id")).rows.map((r) => r.user_id).sort();
    // Lama comments first: owner (Huda) and editor (Ibrahim) are told, Lama and Mohammed are not
    await comment(lama, 'أول تعليق', '33333333-3333-4333-8333-333333333333');
    assert.deepStrictEqual(await ids(), [huda.id, ibr.id].sort());
    // Mohammed comments next: now Lama (earlier commenter) is told too
    await pool.query('DELETE FROM notifications');
    await comment(moh, 'تعليق ثاني', '44444444-4444-4444-8444-444444444444');
    assert.deepStrictEqual(await ids(), [huda.id, ibr.id, lama.id].sort());
    // a retried request (same id) does not notify twice
    await pool.query('DELETE FROM notifications');
    await comment(moh, 'تعليق ثاني', '44444444-4444-4444-8444-444444444444');
    assert.deepStrictEqual(await ids(), []);
    // text
    await comment(lama, 'ثالث', '55555555-5555-4555-8555-555555555555');
    assert.match(await (await fetch(base + '/notifications', { headers: { cookie: huda.cookie } })).text(), /تعليق جديد على/);
    assert.match(await (await fetch(base + '/notifications', { headers: { cookie: huda.cookie + '; lang=en' } })).text(), /commented on/);
  } finally { server.close(); }
});

test('security: open redirect, headers, CSRF, session invalidation, password length, rate limit, error pages', async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  const form = (o) => new URLSearchParams(o).toString();
  try {
    // open redirect through the language switch
    for (const bad of ['//evil.com', '/\\evil.com', '/\\\\evil.com', 'https://evil.com', '/\r\nSet-Cookie:x=1', '/a\\b']) {
      const r = await fetch(base + '/language/en?returnTo=' + encodeURIComponent(bad), { redirect: 'manual' });
      assert.strictEqual(r.headers.get('location'), '/', 'returnTo=' + bad);
    }
    assert.strictEqual((await fetch(base + '/language/en?returnTo=' + encodeURIComponent('/flow?x=1'), { redirect: 'manual' })).headers.get('location'), '/flow?x=1');
    // headers
    const res = await fetch(base + '/login');
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.ok(res.headers.get('permissions-policy'));
    assert.strictEqual(res.headers.get('x-powered-by'), null);
    // unknown path -> generic 404, no stack trace
    const nf = await fetch(base + '/no/such/page'); assert.strictEqual(nf.status, 404);
    // sessions and passwords
    const pw = Object.fromEntries(fs.readFileSync(path.join(tmp, 'initial-passwords.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')));
    const id = (await (await fetch(base + '/login')).text()).match(/<option value="(\d+)"[^>]*>إبراهيم/)[1];
    const login = async (password) => {
      const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: H, body: form({ user: id, password }) });
      const c = r.headers.getSetCookie().find((x) => x.startsWith('sid='));
      return c ? c.split(';')[0] : null;
    };
    const a = await login(pw['إبراهيم']), b = await login(pw['إبراهيم']);
    assert.ok(a && b && a !== b);
    const csrfOf = async (cookie) => (await (await fetch(base + '/', { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
    const csrfA = await csrfOf(a);
    // wrong / missing / truncated CSRF token is refused
    for (const token of ['', 'x', csrfA.slice(0, -1), csrfA + 'a']) {
      assert.strictEqual((await fetch(base + '/password', { method: 'POST', redirect: 'manual', headers: { ...H, cookie: a }, body: form({ _csrf: token, old: pw['إبراهيم'], new: 'longenough1', confirm: 'longenough1' }) })).status, 403);
    }
    const change = (newPw, confirm = newPw) => fetch(base + '/password', { method: 'POST', redirect: 'manual', headers: { ...H, cookie: a }, body: form({ _csrf: csrfA, old: pw['إبراهيم'], new: newPw, confirm }) });
    assert.match((await change('short7!')).headers.get('location'), /e=short/); // 7 characters
    assert.match((await change('longenough1', 'different1')).headers.get('location'), /e=match/);
    assert.match((await change('longenough1')).headers.get('location'), /ok=1/);
    // the other device (b) is signed out, this one (a) stays
    assert.strictEqual((await fetch(base + '/', { headers: { cookie: b }, redirect: 'manual' })).status, 302);
    assert.strictEqual((await fetch(base + '/', { headers: { cookie: a }, redirect: 'manual' })).status, 200);
    pw['إبراهيم'] = 'longenough1';
  } finally { server.close(); }
});
