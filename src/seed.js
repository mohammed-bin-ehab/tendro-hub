const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { ADMIN_USERNAME, ROOT, IS_MAIN } = require('./config');
const { db, initSchema } = require('./db');

const SECTION_DEPENDENCIES = [
  ['المتطلبات الوظيفية — جانب المؤسسة/المشتري', 'تعريف الـ Actors الرئيسيين', 'helpful'],
  ['المتطلبات الوظيفية — جانب المورد والأدمن', 'تعريف الـ Actors الرئيسيين', 'helpful'],
  ['حالات الاستخدام (Use Cases) — المشتري', 'المتطلبات الوظيفية — جانب المؤسسة/المشتري', 'mandatory'],
  ['حالات الاستخدام (Use Cases) — المورد والأدمن', 'المتطلبات الوظيفية — جانب المورد والأدمن', 'mandatory'],
  ['مخطط Use Case العام', 'حالات الاستخدام (Use Cases) — المشتري', 'mandatory'],
  ['مخطط Use Case العام', 'حالات الاستخدام (Use Cases) — المورد والأدمن', 'mandatory'],
  ['مخطط Sequence — المشتري', 'حالات الاستخدام (Use Cases) — المشتري', 'mandatory'],
  ['مخطط Sequence — المورد والأدمن', 'حالات الاستخدام (Use Cases) — المورد والأدمن', 'mandatory'],
  ['مخطط Communication', 'حالات الاستخدام (Use Cases) — المورد والأدمن', 'mandatory'],
  ['مخطط Class', 'حالات الاستخدام (Use Cases) — المشتري', 'mandatory'],
  ['مخطط Class', 'حالات الاستخدام (Use Cases) — المورد والأدمن', 'mandatory'],
  ['تصميم قاعدة البيانات (ERD والجداول)', 'حالات الاستخدام (Use Cases) — المشتري', 'mandatory'],
  ['تصميم قاعدة البيانات (ERD والجداول)', 'حالات الاستخدام (Use Cases) — المورد والأدمن', 'mandatory'],
  ['تصميم قاعدة البيانات (ERD والجداول)', 'مخطط Class', 'helpful', 'خذ الكيانات من مخطط Class', 'Use the entities from the Class Diagram'],
  ['وصف الواجهات الرئيسية', 'المتطلبات الوظيفية — جانب المؤسسة/المشتري', 'helpful'],
  ['وصف الواجهات الرئيسية', 'المتطلبات الوظيفية — جانب المورد والأدمن', 'helpful'],
];
async function seed() {
  if ((await db.prepare('SELECT COUNT(*) c FROM users').get()).c > 0) return;
  const people = [['mohammed', 'محمد'], ['huda', 'هدى'], ['lama', 'لمى'], ['ibrahim', 'إبراهيم']];
  const lines = [];
  const ins = db.prepare('INSERT INTO users(username,name,pass_hash) VALUES(?,?,?) RETURNING id');
  const id = {};
  for (const [u, n] of people) {
    const pw = crypto.randomBytes(5).toString('hex');
    id[n] = Number((await ins.get(u, n, await bcrypt.hash(pw, 10))).id);
    lines.push(`${n}\t${pw}`);
  }
  try {
    const dir = process.env.PASSWORDS_DIR || path.join(ROOT, 'data');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'initial-passwords.txt');
    fs.writeFileSync(f, lines.join('\n') + '\n', { mode: 0o600 });
    console.log('Initial passwords written to', f);
  } catch (error) { console.warn('Could not write initial-passwords.txt:', error.message); }
  // On hosts with an ephemeral disk set LOG_INITIAL_PASSWORDS=1 once to read them from the deploy logs, then remove it.
  if (process.env.LOG_INITIAL_PASSWORDS === '1') console.log('Initial passwords:\n' + lines.join('\n'));

  const S = [
    [1, 'مقدمة عن الموضوع وأهميته', 'محمد', ''],
    [1, 'أهداف المشروع ونطاقه', 'محمد', 'يتضمن ما هو داخل النطاق وخارجه'],
    [1, 'مراجعة الأدبيات والدراسات السابقة (مختصرة)', 'إبراهيم', 'كل الفريق يبحث عن منصات مشابهة ويرسل ملاحظاته (استخدموا التعليقات)، وإبراهيم يجمعها'],
    [2, 'المتطلبات الوظيفية — جانب المؤسسة/المشتري', 'هدى', 'طرح مناقصة، استقبال العروض، المقارنة، اختيار العرض، التوريد'],
    [2, 'المتطلبات الوظيفية — جانب المورد والأدمن', 'لمى', 'تسجيل المورد، تقديم العروض، إدارة المستخدمين، التقارير'],
    [2, 'المتطلبات غير الوظيفية', 'محمد', 'أمان، أداء، توفر، قابلية استخدام، توافق'],
    [2, 'تعريف الـ Actors الرئيسيين', 'إبراهيم', 'محمد يرسل المسودة الأولى للقائمة'],
    [2, 'حالات الاستخدام (Use Cases) — المشتري', 'هدى', 'بالقالب الموحد'],
    [2, 'حالات الاستخدام (Use Cases) — المورد والأدمن', 'لمى', 'بالقالب الموحد'],
    [2, 'مخطط Use Case العام', 'إبراهيم', 'يجمع كل حالات الاستخدام من هدى ولمى'],
    [2, 'الأدوات والتقنيات المستخدمة', 'محمد', 'Laravel API، React، قاعدة البيانات، أدوات التصميم والرسم'],
    [3, 'التصميم العام (High-Level Design)', 'محمد', 'معمارية النظام والطبقات والمكونات'],
    [3, 'مخطط Communication', 'لمى', 'لأهم سيناريو (مثل: تقديم عرض واختياره)'],
    [3, 'مخطط Class', 'إبراهيم', ''],
    [3, 'مخطط Sequence — المشتري', 'هدى', 'يعتمد على Use Cases الخاصة بها'],
    [3, 'مخطط Sequence — المورد والأدمن', 'لمى', 'يعتمد على Use Cases الخاصة بها'],
    [3, 'تصميم قاعدة البيانات (ERD والجداول)', 'محمد', 'يُكمَل بعد انتهاء Use Cases'],
    [3, 'وصف الواجهات الرئيسية', 'إبراهيم', 'وصف كل شاشة'],
    [4, 'خطة العمل وتوزيع المهام', null, 'يُحدَّد لاحقًا'],
    [4, 'الجدول الزمني المتوقع', null, 'يُحدَّد لاحقًا'],
    [4, 'التحديات المحتملة وكيفية التعامل معها', null, 'يُحدَّد لاحقًا'],
  ];
  const ins2 = db.prepare('INSERT INTO sections(unit,pos,title,hint,owner_id,edit_mode) VALUES(?,?,?,?,?,?)');
  for (const [i, s] of S.entries()) await ins2.run(s[0], i, s[1], s[3], s[2] ? id[s[2]] : null, s[2] ? 'owner' : 'team');
}
// Existing data (and a fresh seed) belongs to one default team + project, so nothing is lost when teams/projects were introduced.
async function ensureDefaultProject() {
  const orphans = Number((await db.prepare('SELECT COUNT(*) n FROM sections WHERE project_id IS NULL').get()).n);
  if (!orphans) return;
  await db.tx(async (tx) => {
    let project = await tx.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get();
    if (!project) {
      const team = await tx.prepare("INSERT INTO teams(name) VALUES('TENDRO') RETURNING id").get();
      await tx.prepare('INSERT INTO team_members(team_id,user_id) SELECT ?, id FROM users').run(team.id);
      project = await tx.prepare("INSERT INTO projects(team_id,name) VALUES(?, 'TENDRO') RETURNING id").get(team.id);
    }
    await tx.prepare('UPDATE sections SET project_id=? WHERE project_id IS NULL').run(project.id);
  });
}
async function init() {
  await initSchema();
  if (process.env.SKIP_SEED === '1') return; // used by scripts/migrate-sqlite-to-pg.js
  await seed();
  if (Number((await db.prepare('SELECT COUNT(*) n FROM section_deps').get()).n) === 0) {
    const sectionIds = new Map((await db.prepare('SELECT id,title FROM sections').all()).map((section) => [section.title, section.id]));
    const missingDependencyTitles = new Set();
    await db.tx(async (tx) => {
      const insertDependency = tx.prepare('INSERT INTO section_deps(section_id,depends_on_section_id,dependency_type,note_ar,note_en) VALUES(?,?,?,?,?)');
      for (const [dependentTitle, prerequisiteTitle, type, noteAr = '', noteEn = ''] of SECTION_DEPENDENCIES) {
        const sectionId = sectionIds.get(dependentTitle);
        const prerequisiteId = sectionIds.get(prerequisiteTitle);
        if (!sectionId) missingDependencyTitles.add(dependentTitle);
        if (!prerequisiteId) missingDependencyTitles.add(prerequisiteTitle);
        if (sectionId && prerequisiteId) await insertDependency.run(sectionId, prerequisiteId, type, noteAr, noteEn);
      }
    });
    if (missingDependencyTitles.size) console.warn('Unmatched dependency section titles:', [...missingDependencyTitles].join(' | '));
  }
  await ensureDefaultProject();
  const adminAccount = await db.prepare('SELECT id FROM users WHERE username=?').get(ADMIN_USERNAME);
  if (adminAccount) await db.prepare("UPDATE users SET role='admin',active=1 WHERE id=?").run(adminAccount.id);
}
const ready = init();
ready.catch((error) => { console.error('Database initialisation failed:', error); if (IS_MAIN) process.exit(1); });

module.exports = { ready };
