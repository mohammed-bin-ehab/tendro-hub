const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tendro.db');
const SECURE = process.env.COOKIE_SECURE === '1';
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, name TEXT, pass_hash TEXT, role TEXT DEFAULT 'member', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER, csrf TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS sections(
  id INTEGER PRIMARY KEY, unit INTEGER, pos INTEGER, title TEXT, hint TEXT DEFAULT '',
  owner_id INTEGER, status TEXT DEFAULT 'todo', content TEXT DEFAULT '',
  edit_mode TEXT DEFAULT 'owner', editor_id INTEGER, updated_at TEXT, updated_by INTEGER,
  content_ar TEXT DEFAULT '', content_en TEXT DEFAULT '', content_source_lang TEXT DEFAULT '', archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, section_id INTEGER, user_id INTEGER, body TEXT, created_at TEXT,
  body_ar TEXT DEFAULT '', body_en TEXT DEFAULT '', source_lang TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS section_deps(
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  depends_on_section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK(dependency_type IN ('mandatory','helpful')),
  note_ar TEXT NOT NULL DEFAULT '', note_en TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(section_id, depends_on_section_id),
  CHECK(section_id <> depends_on_section_id));
`);
function ensureColumn(table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
ensureColumn('sections', 'content_ar', 'TEXT');
ensureColumn('sections', 'content_en', 'TEXT');
ensureColumn('sections', 'content_source_lang', 'TEXT');
ensureColumn('comments', 'body_ar', 'TEXT');
ensureColumn('comments', 'body_en', 'TEXT');
ensureColumn('comments', 'source_lang', 'TEXT');
ensureColumn('comments', 'client_request_id', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS comments_client_request_id ON comments(client_request_id) WHERE client_request_id IS NOT NULL');
ensureColumn('users', 'role', "TEXT DEFAULT 'member'");
ensureColumn('users', 'active', 'INTEGER DEFAULT 1');
ensureColumn('sections', 'archived', 'INTEGER DEFAULT 0');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'mohammed';

// ---------- seed ----------
const UNITS = {
  1: 'المقدمة والخلفية', 2: 'تحليل المتطلبات', 3: 'تصميم النظام', 4: 'الجدول الزمني والتحديات',
};
const STATUS = { todo: 'لم يبدأ', doing: 'قيد العمل', review: 'جاهز للمراجعة', done: 'مكتمل' };
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
const EN = {
  'المقدمة والخلفية':'Introduction and Background','تحليل المتطلبات':'Requirements Analysis','تصميم النظام':'System Design','الجدول الزمني والتحديات':'Timeline and Challenges',
  'لم يبدأ':'Not started','قيد العمل':'In progress','جاهز للمراجعة':'Ready for review','مكتمل':'Complete',
  'توثيق المشروع':'Project Documentation','كلمة السر':'Password','خروج':'Log out','دخول':'Sign in','غير مسموح':'Access denied','انتهت صلاحية الصفحة، ارجع وحدّثها ثم جرّب مرة ثانية.':'This page has expired. Refresh it and try again.',
  'أهلًا بكم 👋':'Welcome 👋','اختر اسمك وأدخل كلمة السر الخاصة بك.':'Choose your name and enter your password.','الاسم':'Name','كلمة السر':'Password','الحالية':'Current password','الجديدة':'New password','حفظ':'Save','تغيير كلمة السر':'Change password','تم تغيير كلمة السر':'Password changed.','تأكد من كلمة السر الحالية، والجديدة 6 أحرف على الأقل':'Check your current password. The new password must be at least 6 characters.',
  'الاسم أو كلمة السر غير صحيحة':'Incorrect name or password.','محاولات كثيرة، جرّب بعد قليل':'Too many attempts. Try again later.','الأقسام':'Sections','غير موجود':'Not found','القسم غير موجود':'Section not found','ما عندك صلاحية تعديل هذا القسم.':'You do not have permission to edit this section.',
  'أهلًا':'Hello','كل الأقسام':'All sections','أقسامي':'My sections','كل الأقسام ظاهرة للجميع، وتعدّل فقط على الأقسام التي تخصّك. وتقدر تكتب تعليقًا على أي قسم.':'Everyone can view all sections. You can edit sections assigned to you and comment on any section.',
  'الوحدة':'Unit','مفتوح للتعديل':'Editing open','← كل الأقسام':'← All sections','المسؤول:':'Owner:','التعديل مفتوح للفريق':'Editing open to the team','يعدّل معه:':'Can also edit:','آخر تعديل':'Last updated','بواسطة':'by','الحالة':'Status','المحتوى':'Content','اكتب هنا...':'Write here...','لم يُكتب شيء بعد.':'Nothing has been written yet.','🔒 للعرض فقط — تقدر تكتب تعليقًا بالأسفل.':'🔒 Read only — you can add a comment below.',
  'من يقدر يعدّل هذا القسم؟':'Who can edit this section?','أنا فقط':'Only me','الفريق كله':'The whole team','شخص محدد:':'A specific person:','التعليقات':'Comments','لا توجد تعليقات.':'No comments.','أضف تعليقًا':'Add a comment','ملاحظة أو اقتراح...':'A note or suggestion...','حفظ التغييرات':'Save changes','لا توجد تغييرات غير محفوظة':'No unsaved changes','تغييرات غير محفوظة':'Unsaved changes','جارٍ حفظ التغييرات...':'Saving changes...','تم حفظ التغييرات':'Changes saved','تعذّر الحفظ':'Could not save','بقيت مدخلاتك محفوظة، حاول مجددًا':'Your entries are preserved. Please try again.','لم يؤكد الخادم حفظ التغييرات':'The server did not confirm the save.',
  'توجد مسودة غير محفوظة، والبيانات الحالية في قاعدة البيانات أحدث أو مختلفة. استعادة المسودة ستستبدل الحقول المتعارضة في الصفحة فقط. هل تريد استعادتها؟':'An unsaved draft exists, and the saved data has changed. Restoring the draft will replace conflicting fields on this page. Restore it?',
  'توجد مسودة غير محفوظة':'An unsaved draft was restored','تمت استعادة مسودة غير محفوظة':'An unsaved draft was restored','تعذّر حذف التعليق.':'Could not delete the comment.','حذف':'Delete','تسجيل الخروج':'Sign out','لمى':'Lama','هدى':'Huda','إبراهيم':'Ibrahim','محمد':'Mohammed','الفريق':'Team',
  'مقدمة عن الموضوع وأهميته':'Introduction and Project Importance','أهداف المشروع ونطاقه':'Project Goals and Scope','مراجعة الأدبيات والدراسات السابقة (مختصرة)':'Literature Review and Previous Studies (Brief)','المتطلبات الوظيفية — جانب المؤسسة/المشتري':'Functional Requirements — Buyer Organization','المتطلبات الوظيفية — جانب المورد والأدمن':'Functional Requirements — Supplier and Admin','المتطلبات غير الوظيفية':'Non-functional Requirements','تعريف الـ Actors الرئيسيين':'Key Actors','حالات الاستخدام (Use Cases) — المشتري':'Use Cases — Buyer','حالات الاستخدام (Use Cases) — المورد والأدمن':'Use Cases — Supplier and Admin','مخطط Use Case العام':'Overall Use Case Diagram','الأدوات والتقنيات المستخدمة':'Tools and Technologies','التصميم العام (High-Level Design)':'High-level Design','مخطط Communication':'Communication Diagram','مخطط Class':'Class Diagram','مخطط Sequence — المشتري':'Sequence Diagram — Buyer','مخطط Sequence — المورد والأدمن':'Sequence Diagram — Supplier and Admin','تصميم قاعدة البيانات (ERD والجداول)':'Database Design (ERD and Tables)','وصف الواجهات الرئيسية':'Main Interface Descriptions','خطة العمل وتوزيع المهام':'Work Plan and Task Allocation','الجدول الزمني المتوقع':'Estimated Timeline','التحديات المحتملة وكيفية التعامل معها':'Potential Challenges and Mitigation',
  'يتضمن ما هو داخل النطاق وخارجه':'Include what is in and out of scope.','كل الفريق يبحث عن منصات مشابهة ويرسل ملاحظاته (استخدموا التعليقات)، وإبراهيم يجمعها':'Everyone researches similar platforms and shares notes in comments; Ibrahim consolidates them.','طرح مناقصة، استقبال العروض، المقارنة، اختيار العرض، التوريد':'Create tenders, receive and compare bids, select a bid, and manage delivery.','تسجيل المورد، تقديم العروض، إدارة المستخدمين، التقارير':'Supplier registration, bid submission, user management, and reports.','أمان، أداء، توفر، قابلية استخدام، توافق':'Security, performance, availability, usability, and compatibility.','محمد يرسل المسودة الأولى للقائمة':'Mohammed sends the first draft of the list.','بالقالب الموحد':'Use the shared template.','يجمع كل حالات الاستخدام من هدى ولمى':'Consolidate all use cases from Huda and Lama.','Laravel API، React، قاعدة البيانات، أدوات التصميم والرسم':'Laravel API, React, database, and design and diagramming tools.','معمارية النظام والطبقات والمكونات':'System architecture, layers, and components.','لأهم سيناريو (مثل: تقديم عرض واختياره)':'For a key scenario, such as submitting and selecting a bid.','يعتمد على Use Cases الخاصة بها':'Based on her use cases.','يُكمَل بعد انتهاء Use Cases':'Complete after the use cases are finished.','وصف كل شاشة':'Describe each screen.','يُحدَّد لاحقًا':'To be determined.',
  'يرجى اختيار اسمك.':'Please choose your name.','أدخل كلمة المرور.':'Please enter your password.','الاسم أو كلمة السر غير صحيحة':'The name or password is incorrect.','محاولات كثيرة، جرّب بعد قليل':'Too many attempts. Try again in a few minutes.','كلمة المرور الحالية غير صحيحة.':'The current password is incorrect.','كلمة المرور الجديدة يجب أن تتكون من 6 أحرف على الأقل.':'The new password must be at least 6 characters.','كلمتا المرور الجديدتان غير متطابقتين.':'The new passwords do not match.','تم تغيير كلمة السر':'Password changed successfully.','أظهر كلمة المرور':'Show password','أخفِ كلمة المرور':'Hide password','تأكيد كلمة المرور الجديدة':'Confirm new password','جارٍ تسجيل الدخول...':'Signing in...','جارٍ حفظ كلمة المرور...':'Saving password...','إنشاء كلمة مرور قوية':'Use at least 6 characters for your new password.','تم تسجيل الدخول بنجاح':'You are signed in successfully.',
  'لوحة الإدارة':'Admin dashboard','الإدارة':'Administration','إدارة الأعضاء':'Manage members','الأعضاء':'Members','إضافة عضو':'Add member','اسم العرض':'Display name','اسم المستخدم':'Username','كلمة مرور أولية':'Initial password','الدور':'Role','عضو':'Member','مدير':'Administrator','الحالة':'Status','نشط':'Active','موقوف':'Disabled','إيقاف':'Disable','تفعيل':'Enable','حفظ العضو':'Save member','تمت إضافة العضو':'Member added.','تم تحديث العضو':'Member updated.','اسم المستخدم مستخدم بالفعل.':'That username is already in use.','كلمة المرور يجب أن تكون 6 أحرف على الأقل.':'Password must be at least 6 characters.','لا يمكن إيقاف آخر مدير.':'The last administrator cannot be disabled.','إدارة الأقسام':'Manage sections','إضافة قسم':'Add section','عنوان القسم':'Section title','الوحدة':'Unit','اختر المسؤول':'Choose an owner','بدون مسؤول':'Unassigned','عضو موقوف':'Inactive member','التلميح':'Guidance','حفظ القسم':'Save section','تعديل':'Edit','أرشفة':'Archive','حذف نهائي':'Delete permanently','تأكيد الحذف النهائي لهذا القسم وتعليقاته؟ لا يمكن التراجع عن ذلك.':'Permanently delete this section and its comments? This cannot be undone.','أرشيف الأقسام لا تنتهي مدته تلقائيًا.':'Archived sections do not expire automatically.','تم حذف القسم نهائيًا':'Section permanently deleted.','استعادة':'Restore','الأقسام المؤرشفة':'Archived sections','لا توجد أقسام.':'There are no sections.','تم إنشاء القسم':'Section created.','تم تحديث القسم':'Section updated.','تمت أرشفة القسم':'Section archived.','تمت استعادة القسم':'Section restored.','الصلاحية':'Permission','المسؤول فقط':'Owner only','الفريق كله':'Entire team','شخص محدد':'Specific person','تعديل القسم':'Save section changes','الإعدادات العامة':'General settings','ألوان الواجهة':'Interface colors','لون التمييز':'Accent color','خلفية الصفحة':'Page background','خلفية البطاقات':'Card background','لون النص':'Text color','خلفية الصفحة الداكنة':'Dark page background','البطاقات الداكنة':'Dark card background','النص الداكن':'Dark text','النص الفاتح':'Light text','حفظ الإعدادات':'Save settings','تم حفظ الإعدادات':'Settings saved.','لا تملك صلاحية فتح لوحة الإدارة.':'You do not have permission to open the admin dashboard.','الإعدادات':'Settings','إدارة الفريق والأقسام والألوان والصلاحيات من مكان واحد.':'Manage the team, sections, colors, and permissions in one place.',
};
const enText = (value) => EN[value] || value;
Object.assign(EN, {
  'ملاحظة:':'Note:', 'جاهز للبدء':'Ready to start', 'يقدر يبدأ بمسودة':'Can start with a draft', 'ينتظر:':'Waiting for:', 'بعد:':'After:',
  'أحتاج من:':'Depends on:', 'إلزامي':'Required', 'مفيد':'Helpful', 'خذ الكيانات من مخطط Class':'Use the entities from the Class Diagram',
  'مفتوح التعديل للجميع':'Open for the whole team', 'مفتوح التعديل لـ':'Open for'
});
const text = (req, value) => req.lang === 'en' ? enText(value) : value;
const unitName = (req, n) => req.lang === 'en' ? enText(UNITS[n]) : UNITS[n];
const statusName = (req, status) => req.lang === 'en' ? enText(STATUS[status] || status) : STATUS[status] || status;
const userName = (req, user) => user && req.lang === 'en' ? enText(user.name) : user?.name;

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const people = [['mohammed', 'محمد'], ['huda', 'هدى'], ['lama', 'لمى'], ['ibrahim', 'إبراهيم']];
  const lines = [];
  const ins = db.prepare('INSERT INTO users(username,name,pass_hash) VALUES(?,?,?)');
  const id = {};
  for (const [u, n] of people) {
    const pw = crypto.randomBytes(5).toString('hex');
    id[n] = Number(ins.run(u, n, bcrypt.hashSync(pw, 10)).lastInsertRowid);
    lines.push(`${n}\t${pw}`);
  }
  const f = path.join(path.dirname(DB_PATH), 'initial-passwords.txt');
  fs.writeFileSync(f, lines.join('\n') + '\n', { mode: 0o600 });
  console.log('Initial passwords written to', f);

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
  S.forEach((s, i) => ins2.run(s[0], i, s[1], s[3], s[2] ? id[s[2]] : null, s[2] ? 'owner' : 'team'));
}
seed();
if (Number(db.prepare('SELECT COUNT(*) n FROM section_deps').get().n) === 0) {
  const sectionIds = new Map(db.prepare('SELECT id,title FROM sections').all().map((section) => [section.title, section.id]));
  const missingDependencyTitles = new Set();
  const insertDependency = db.prepare('INSERT INTO section_deps(section_id,depends_on_section_id,dependency_type,note_ar,note_en) VALUES(?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [dependentTitle, prerequisiteTitle, type, noteAr = '', noteEn = ''] of SECTION_DEPENDENCIES) {
      const sectionId = sectionIds.get(dependentTitle);
      const prerequisiteId = sectionIds.get(prerequisiteTitle);
      if (!sectionId) missingDependencyTitles.add(dependentTitle);
      if (!prerequisiteId) missingDependencyTitles.add(prerequisiteTitle);
      if (sectionId && prerequisiteId) insertDependency.run(sectionId, prerequisiteId, type, noteAr, noteEn);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (missingDependencyTitles.size) console.warn('Unmatched dependency section titles:', [...missingDependencyTitles].join(' | '));
}
const adminAccount = db.prepare('SELECT id FROM users WHERE username=?').get(ADMIN_USERNAME);
if (adminAccount) db.prepare("UPDATE users SET role='admin',active=1 WHERE id=?").run(adminAccount.id);

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowIso = () => new Date().toISOString();
const fmt = (iso, lang = 'ar') => iso ? new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-u-nu-latn', { timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short' }) : '';
const chip = (u, lang = 'ar') => u ? `<span class="who"><i class="c${u.id % 6}"></i>${esc(lang === 'en' ? enText(u.name) : u.name)}</span>` : `<span class="who"><i class="team"></i>${lang === 'en' ? 'Team' : 'الفريق'}</span>`;
function dependencyRowsFor(sectionIds) {
  if (!sectionIds.length) return new Map();
  const placeholders = sectionIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT d.section_id,d.dependency_type,d.note_ar,d.note_en,
    prerequisite.id AS prerequisite_id,prerequisite.title,prerequisite.status,prerequisite.owner_id,
    owner.name AS owner_name,prerequisite.archived
    FROM section_deps d JOIN sections prerequisite ON prerequisite.id=d.depends_on_section_id
    LEFT JOIN users owner ON owner.id=prerequisite.owner_id
    WHERE d.section_id IN (${placeholders})
    ORDER BY d.section_id,CASE d.dependency_type WHEN 'mandatory' THEN 0 ELSE 1 END,prerequisite.unit,prerequisite.pos`).all(...sectionIds);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.section_id)) grouped.set(row.section_id, []);
    grouped.get(row.section_id).push(row);
  }
  return grouped;
}
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

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
const setCookie = (res, v, age) => res.setHeader('Set-Cookie', `sid=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${SECURE ? '; Secure' : ''}`);
const users = () => db.prepare('SELECT id,name,username,role,active FROM users ORDER BY id').all();
const userById = (id) => db.prepare('SELECT id,name,username,role,active FROM users WHERE id=?').get(id);
const settingsDefaults = { accent: '#171717', lightPage: '#f6f6f5', lightSurface: '#ffffff', lightText: '#171717', darkPage: '#151515', darkSurface: '#222222', darkText: '#f1f1f1' };
const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || settingsDefaults[key];
const colorValue = (key) => /^#[\da-fA-F]{6}$/.test(getSetting(key) || '') ? getSetting(key) : settingsDefaults[key];
const saveSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

function detectTextLanguage(value) {
  const chars = Array.from(String(value || ''));
  const arabic = chars.filter((c) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(c)).length;
  const latin = chars.filter((c) => /[A-Za-z]/u.test(c)).length;
  return arabic >= latin ? 'ar' : 'en';
}
function decodeGoogleText(value) {
  return String(value || '').replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#(\d+);|&#x([\da-f]+);/gi, (entity, dec, hex) => {
    if (entity === '&amp;') return '&'; if (entity === '&lt;') return '<'; if (entity === '&gt;') return '>';
    if (entity === '&quot;') return '"'; if (entity === '&#39;') return "'";
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}
async function translateChunk(value, source, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new Error('GOOGLE_TRANSLATE_API_KEY is not configured');
  const url = new URL('https://translation.googleapis.com/language/translate/v2');
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
    body: JSON.stringify({ q: value, source, target, format: 'text' })
  });
  if (!response.ok) throw new Error(`Google Translation returned ${response.status}`);
  const result = await response.json();
  const translated = result?.data?.translations?.[0]?.translatedText;
  if (typeof translated !== 'string') throw new Error('Google Translation returned no text');
  return decodeGoogleText(translated);
}
async function bilingualText(value) {
  const original = String(value || '').slice(0, 50000);
  if (!original.trim()) return { ar: '', en: '', sourceLang: '', translated: true };
  const sourceLang = detectTextLanguage(original), targetLang = sourceLang === 'ar' ? 'en' : 'ar';
  const pair = { ar: '', en: '', sourceLang, translated: false };
  pair[sourceLang] = original;
  if (!process.env.GOOGLE_TRANSLATE_API_KEY) return pair;
  try {
    const chars = Array.from(original), chunks = [];
    for (let i = 0; i < chars.length; i += 4000) chunks.push(chars.slice(i, i + 4000).join(''));
    const outputs = [];
    for (const chunk of chunks) outputs.push(await translateChunk(chunk, sourceLang, targetLang));
    pair[targetLang] = outputs.join('');
    pair.translated = true;
  } catch (error) {
    console.error('Translation failed:', error.message);
  }
  return pair;
}
const sectionText = (section, lang) => (lang === 'en' ? section.content_en : section.content_ar) || section.content || '';
const commentText = (comment, lang) => (lang === 'en' ? comment.body_en : comment.body_ar) || comment.body || '';

const isAdmin = (u) => u?.role === 'admin';
const canEdit = (u, s) => isAdmin(u) || s.owner_id == null || u.id === s.owner_id || s.edit_mode === 'team' || (s.edit_mode === 'person' && s.editor_id === u.id);
const canManage = (u, s) => isAdmin(u) || s.owner_id == null || u.id === s.owner_id;

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true, lastModified: true }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

app.use((req, res, next) => {
  const cookie = cookies(req);
  req.lang = cookie.lang === 'en' ? 'en' : 'ar';
  const sid = cookie.sid;
  req.user = null;
  if (sid) {
    const row = db.prepare('SELECT s.csrf, u.id, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.created_at>? AND u.active=1').get(sid, Date.now() - 14 * 864e5);
    if (row) { req.user = { id: row.id, name: row.name, role: row.role }; req.csrf = row.csrf; }
  }
  next();
});
app.get('/sw.js', (req, res) => {
  res.set('Service-Worker-Allowed', '/').set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(__dirname, 'public', 'sw.js'));
});
const needLogin = (req, res, next) => req.user ? next() : res.redirect('/login');
const needAdmin = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).send(page(req, 'غير مسموح', `<p class="form-alert">${text(req, 'لا تملك صلاحية فتح لوحة الإدارة.')}</p>`));
const needCsrf = (req, res, next) => (req.body && req.body._csrf === req.csrf) ? next() : res.status(403).send(page(req, 'غير مسموح', `<p class="card">${text(req, 'انتهت صلاحية الصفحة، ارجع وحدّثها ثم جرّب مرة ثانية.')}</p>`));

app.get('/language/:lang', (req, res) => {
  const lang = req.params.lang === 'en' ? 'en' : 'ar';
  res.setHeader('Set-Cookie', `lang=${lang}; SameSite=Lax; Path=/; Max-Age=31536000${SECURE ? '; Secure' : ''}`);
  let target = '/';
  const returnTo = String(req.query.returnTo || '');
  if (returnTo.startsWith('/') && !returnTo.startsWith('//')) target = returnTo;
  res.redirect(target);
});

function page(req, title, body) {
  const lang = req.lang || 'ar';
  const nav = `<nav>${req.user ? `<span class="me">${chip(req.user, lang)}</span>${isAdmin(req.user) ? `<a href="/admin">${text(req, 'لوحة الإدارة')}</a>` : ''}<a href="/password">${text(req, 'كلمة السر')}</a>
    <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(req.csrf)}"><button class="link">${text(req, 'خروج')}</button></form>` : ''}<button class="link theme-toggle" type="button" id="theme-toggle" data-light-label="${lang === 'ar' ? 'الوضع الفاتح' : 'Light mode'}" data-dark-label="${lang === 'ar' ? 'الوضع الداكن' : 'Dark mode'}">${lang === 'ar' ? 'الوضع الداكن' : 'Dark mode'}</button><a class="lang-switch" href="/language/${lang === 'ar' ? 'en' : 'ar'}?returnTo=${encodeURIComponent(req.originalUrl || '/')}">${lang === 'ar' ? 'English' : 'العربية'}</a></nav>`;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(text(req, title))} — TENDRO HUB</title><link rel="stylesheet" href="/static/style.css?v=12"><link rel="stylesheet" href="/theme.css"><script src="/static/app.js?v=11" defer></script></head><body>
<header><a class="brand" href="/" aria-label="TENDRO HUB"><img class="brand-logo" src="/static/tendro-hub.svg" alt=""><span>TENDRO HUB</span></a>${nav}</header><div id="network-status" class="network-status" role="status" aria-live="polite" hidden></div><main>${body}</main></body></html>`;
}
const csrfField = (req) => `<input type="hidden" name="_csrf" value="${esc(req.csrf)}">`;
const pill = (st, req) => `<span class="pill ${st}">${statusName(req, st)}</span>`;
const contrastText = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.42 ? '#111111' : '#ffffff';
};
app.get('/theme.css', (req, res) => {
  const accent = colorValue('accent');
  const common = `--brand-primary:${accent};--brand-ink:${contrastText(accent)};`;
  res.type('text/css').set('Cache-Control', 'no-store').send(
    `:root,:root[data-theme="light"]{${common}--page:${colorValue('lightPage')};--surface:${colorValue('lightSurface')};--ink:${colorValue('lightText')}}` +
    `:root[data-theme="dark"]{${common}--page:${colorValue('darkPage')};--surface:${colorValue('darkSurface')};--ink:${colorValue('darkText')}}`
  );
});

// ---------- auth ----------
const fails = new Map();
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  const selectedUser = /^\d+$/.test(String(req.query.u || '')) ? Number(req.query.u) : 0;
  const opts = users().map((u) => `<option value="${u.id}"${u.id === selectedUser ? ' selected' : ''}>${esc(userName(req, u))}</option>`).join('');
  const lockMessage = req.query.b ? `<p class="form-alert" role="alert">${text(req, 'محاولات كثيرة، جرّب بعد قليل')}</p>` : '';
  const nameError = req.query.e === 'user' ? text(req, 'يرجى اختيار اسمك.') : '';
  const passError = ['password', 'invalid'].includes(String(req.query.e || '')) ? text(req, req.query.e === 'password' ? 'أدخل كلمة المرور.' : 'الاسم أو كلمة السر غير صحيحة') : '';
  res.send(page(req, 'دخول', `<form class="card narrow auth-form" method="post" action="/login" data-loading-label="${text(req, 'جارٍ تسجيل الدخول...')}"><div class="login-brand"><img src="/static/tendro-hub.svg" alt=""><strong>TENDRO HUB</strong></div><h1>${text(req, 'أهلًا بكم 👋')}</h1><p class="mut">${text(req, 'اختر اسمك وأدخل كلمة السر الخاصة بك.')}</p>${lockMessage}
  <label class="${nameError ? 'has-error' : ''}">${text(req, 'الاسم')}<select name="user" required aria-invalid="${Boolean(nameError)}" aria-describedby="user-error"><option value="">${text(req, 'يرجى اختيار اسمك.')}</option>${opts}</select><span class="field-error" id="user-error" role="alert">${nameError}</span></label>
  <label class="${passError ? 'has-error' : ''}">${text(req, 'كلمة السر')}<span class="password-control"><input id="login-password" type="password" name="password" required minlength="6" autocomplete="current-password" aria-invalid="${Boolean(passError)}" aria-describedby="password-error"><button class="password-toggle" type="button" data-password-toggle="login-password" data-show-label="${text(req, 'أظهر كلمة المرور')}" data-hide-label="${text(req, 'أخفِ كلمة المرور')}" aria-label="${text(req, 'أظهر كلمة المرور')}">${text(req, 'أظهر كلمة المرور')}</button></span><span class="field-error" id="password-error" role="alert">${passError}</span></label><button class="btn auth-submit" type="submit">${text(req, 'دخول')}</button></form>`));
});
app.post('/login', (req, res) => {
  const key = req.ip + ':' + req.body.user;
  const f = fails.get(key) || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 10 * 60e3) return res.redirect('/login?b=1');
  const userId = Number(req.body.user);
  if (!userId) return res.redirect('/login?e=user');
  const password = String(req.body.password || '');
  if (!password) return res.redirect('/login?e=password');
  const u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!u || !bcrypt.compareSync(password, u.pass_hash)) {
    fails.set(key, { n: f.n + 1, t: Date.now() });
    return res.redirect(`/login?e=invalid&u=${Number(req.body.user) || ''}`);
  }
  fails.delete(key);
  const sid = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sid, u.id, crypto.randomBytes(16).toString('hex'), Date.now());
  setCookie(res, sid, 14 * 86400);
  res.redirect('/?welcome=1');
});
app.post('/logout', needLogin, needCsrf, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id=?').run(cookies(req).sid);
  setCookie(res, '', 0); res.redirect('/login');
});
app.get('/password', needLogin, (req, res) => {
  const currentError = req.query.e === 'old' ? text(req, 'كلمة المرور الحالية غير صحيحة.') : '';
  const newError = req.query.e === 'short' ? text(req, 'كلمة المرور الجديدة يجب أن تتكون من 6 أحرف على الأقل.') : '';
  const confirmError = req.query.e === 'match' ? text(req, 'كلمتا المرور الجديدتان غير متطابقتين.') : '';
  const success = req.query.ok ? `<p class="form-success" role="status">${text(req, 'تم تغيير كلمة السر')}</p>` : '';
  const passField = (id, name, label, error, autocomplete, match = false) => `<label class="${error ? 'has-error' : ''}">${label}<span class="password-control"><input id="${id}" type="password" name="${name}" required ${match ? '' : 'minlength="6"'} autocomplete="${autocomplete}" ${match ? 'data-match-password="new"' : ''} aria-invalid="${Boolean(error)}" aria-describedby="${id}-error"><button class="password-toggle" type="button" data-password-toggle="${id}" data-show-label="${text(req, 'أظهر كلمة المرور')}" data-hide-label="${text(req, 'أخفِ كلمة المرور')}" aria-label="${text(req, 'أظهر كلمة المرور')}">${text(req, 'أظهر كلمة المرور')}</button></span><span class="field-error" id="${id}-error" role="alert">${error}</span></label>`;
  res.send(page(req, 'كلمة السر', `<form class="card narrow auth-form" method="post" action="/password" data-loading-label="${text(req, 'جارٍ حفظ كلمة المرور...')}"><h1>${text(req, 'تغيير كلمة السر')}</h1>${success}${csrfField(req)}
  ${passField('current-password', 'old', text(req, 'الحالية'), currentError, 'current-password')}
  ${passField('new-password', 'new', text(req, 'الجديدة'), newError, 'new-password')}
  ${passField('confirm-password', 'confirm', text(req, 'تأكيد كلمة المرور الجديدة'), confirmError, 'new-password', true)}
  <p class="mut password-hint">${text(req, 'إنشاء كلمة مرور قوية')}</p><button class="btn auth-submit" type="submit">${text(req, 'حفظ')}</button></form>`));
});
app.post('/password', needLogin, needCsrf, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const nw = String(req.body.new || '');
  if (!bcrypt.compareSync(String(req.body.old || ''), u.pass_hash)) return res.redirect('/password?e=old');
  if (nw.length < 6) return res.redirect('/password?e=short');
  if (nw !== String(req.body.confirm || '')) return res.redirect('/password?e=match');
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(bcrypt.hashSync(nw, 10), u.id);
  res.redirect('/password?ok=1');
});

// ---------- admin dashboard ----------
const adminFlashText = {
  member: 'تمت إضافة العضو', 'member-updated': 'تم تحديث العضو', section: 'تم إنشاء القسم',
  'section-updated': 'تم تحديث القسم', archived: 'تمت أرشفة القسم', restored: 'تمت استعادة القسم', 'permanently-deleted': 'تم حذف القسم نهائيًا', settings: 'تم حفظ الإعدادات',
  duplicate: 'اسم المستخدم مستخدم بالفعل.', password: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.', lastAdmin: 'لا يمكن إيقاف آخر مدير.', invalid: 'راجع بيانات النموذج وحاول مجددًا.'
};
app.get('/admin', needLogin, needAdmin, (req, res) => {
  const members = db.prepare('SELECT id,name,username,role,active FROM users ORDER BY id').all();
  const sections = db.prepare('SELECT * FROM sections ORDER BY archived,unit,pos,id').all();
  const activeUsers = members.filter((u) => u.active);
  const owners = `<option value="">${text(req, 'بدون مسؤول')}</option>` + activeUsers.map((u) => `<option value="${u.id}">${esc(userName(req, u))}</option>`).join('');
  const flash = adminFlashText[req.query.ok] ? `<p class="form-success" role="status">${text(req, adminFlashText[req.query.ok])}</p>` : req.query.e ? `<p class="form-alert" role="alert">${text(req, adminFlashText[req.query.e] || adminFlashText.invalid)}</p>` : '';
  let html = `${flash}<section class="hero card admin-hero"><div><h1>${text(req, 'لوحة الإدارة')}</h1><p class="mut">${text(req, 'إدارة الفريق والأقسام والألوان والصلاحيات من مكان واحد.')}</p></div><div class="admin-stats"><b>${members.length}</b><span>${text(req, 'الأعضاء')}</span><b>${sections.filter((s) => !s.archived).length}</b><span>${text(req, 'الأقسام')}</span></div></section>
    <section class="card admin-card"><h2>${text(req, 'إضافة عضو')}</h2><form class="admin-grid" method="post" action="/admin/members">${csrfField(req)}
      <label>${text(req, 'اسم العرض')}<input name="name" maxlength="80" required></label><label>${text(req, 'اسم المستخدم')}<input name="username" pattern="[A-Za-z0-9._-]{3,32}" minlength="3" maxlength="32" required autocomplete="off"></label>
      <label>${text(req, 'كلمة مرور أولية')}<input type="password" name="password" minlength="6" required autocomplete="new-password"></label><label>${text(req, 'الدور')}<select name="role"><option value="member">${text(req, 'عضو')}</option><option value="admin">${text(req, 'مدير')}</option></select></label>
      <button class="btn" type="submit">${text(req, 'حفظ العضو')}</button></form></section>
    <section class="card admin-card"><h2>${text(req, 'إدارة الأعضاء')}</h2><div class="admin-list">${members.map((u) => `<form class="admin-row" method="post" action="/admin/members/${u.id}/update">${csrfField(req)}
      <div class="admin-fields"><label>${text(req, 'اسم العرض')}<input name="name" value="${esc(u.name)}" maxlength="80" required></label><label>${text(req, 'اسم المستخدم')}<input name="username" value="${esc(u.username)}" pattern="[A-Za-z0-9._-]{3,32}" minlength="3" maxlength="32" required></label>
      <label>${text(req, 'الدور')}<select name="role"><option value="member"${u.role === 'member' ? ' selected' : ''}>${text(req, 'عضو')}</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>${text(req, 'مدير')}</option></select></label>
      <label>${text(req, 'الحالة')}<select name="active"><option value="1"${u.active ? ' selected' : ''}>${text(req, 'نشط')}</option><option value="0"${!u.active ? ' selected' : ''}>${text(req, 'موقوف')}</option></select></label><label>${text(req, 'كلمة مرور أولية')}<input type="password" name="password" minlength="6" placeholder="••••••"></label></div>
      <button class="btn alt" type="submit">${text(req, 'حفظ العضو')}</button></form>`).join('')}</div></section>
    <section class="card admin-card"><h2>${text(req, 'إضافة قسم')}</h2><form class="admin-grid" method="post" action="/admin/sections">${csrfField(req)}
      <label>${text(req, 'عنوان القسم')}<input name="title" maxlength="180" required></label><label>${text(req, 'الوحدة')}<select name="unit">${[1,2,3,4].map((n) => `<option value="${n}">${text(req,'الوحدة')} ${n} · ${unitName(req,n)}</option>`).join('')}</select></label>
      <label>${text(req, 'المسؤول:')}<select name="owner_id">${owners}</select></label><label>${text(req, 'الصلاحية')}<select name="edit_mode"><option value="owner">${text(req, 'المسؤول فقط')}</option><option value="team">${text(req, 'الفريق كله')}</option></select></label>
      <label class="wide">${text(req, 'التلميح')}<textarea name="hint" maxlength="500"></textarea></label><button class="btn" type="submit">${text(req, 'حفظ القسم')}</button></form></section>
    <section class="card admin-card"><h2>${text(req, 'إدارة الأقسام')}</h2><div class="admin-list">${sections.filter((s) => !s.archived).map((s) => `<div class="admin-row"><form class="admin-section-form" method="post" action="/admin/sections/${s.id}/update">${csrfField(req)}
      <div class="admin-fields"><label>${text(req, 'عنوان القسم')}<input name="title" value="${esc(s.title)}" maxlength="180" required></label><label>${text(req, 'الوحدة')}<select name="unit">${[1,2,3,4].map((n) => `<option value="${n}"${s.unit === n ? ' selected' : ''}>${text(req,'الوحدة')} ${n} · ${unitName(req,n)}</option>`).join('')}</select></label>
      <label>${text(req, 'المسؤول:')}<select name="owner_id"><option value="">${text(req, 'بدون مسؤول')}</option>${activeUsers.map((u) => `<option value="${u.id}"${u.id === s.owner_id ? ' selected' : ''}>${esc(userName(req,u))}</option>`).join('')}${s.owner_id && !activeUsers.some((u) => u.id === s.owner_id) ? `<option value="${s.owner_id}" selected disabled>${text(req,'عضو موقوف')}</option>` : ''}</select></label><label>${text(req, 'الحالة')}<select name="status">${Object.entries(STATUS).map(([key]) => `<option value="${key}"${key === s.status ? ' selected' : ''}>${statusName(req,key)}</option>`).join('')}</select></label>
      <label>${text(req, 'الصلاحية')}<select name="edit_mode"><option value="owner"${s.edit_mode === 'owner' ? ' selected' : ''}>${text(req, 'المسؤول فقط')}</option><option value="team"${s.edit_mode === 'team' ? ' selected' : ''}>${text(req, 'الفريق كله')}</option><option value="person"${s.edit_mode === 'person' ? ' selected' : ''}>${text(req, 'شخص محدد')}</option></select></label><label>${text(req, 'شخص محدد')}<select name="editor_id"><option value="">${text(req,'اختر المسؤول')}</option>${activeUsers.filter((u) => u.id !== s.owner_id).map((u) => `<option value="${u.id}"${u.id === s.editor_id ? ' selected' : ''}>${esc(userName(req,u))}</option>`).join('')}</select></label>
      <label class="wide">${text(req, 'التلميح')}<textarea name="hint" maxlength="500">${esc(s.hint)}</textarea></label></div><button class="btn alt" type="submit">${text(req, 'تعديل القسم')}</button></form>
      <form method="post" action="/admin/sections/${s.id}/archive">${csrfField(req)}<button class="link danger-link" type="submit">${text(req, 'أرشفة')}</button></form></div>`).join('') || `<p class="mut">${text(req, 'لا توجد أقسام.')}</p>`}</div>
      <h2>${text(req, 'الأقسام المؤرشفة')}</h2><p class="mut archive-note">${text(req,'أرشيف الأقسام لا تنتهي مدته تلقائيًا.')}</p><div class="admin-list">${sections.filter((s) => s.archived).map((s) => `<div class="archived-row"><span>${esc(text(req,s.title))} · ${text(req,'الوحدة')} ${s.unit}</span><div class="archive-actions"><form method="post" action="/admin/sections/${s.id}/restore">${csrfField(req)}<button class="btn alt" type="submit">${text(req, 'استعادة')}</button></form><form method="post" action="/admin/sections/${s.id}/delete" data-confirm="${text(req,'تأكيد الحذف النهائي لهذا القسم وتعليقاته؟ لا يمكن التراجع عن ذلك.')}">${csrfField(req)}<button class="btn danger-btn" type="submit">${text(req,'حذف نهائي')}</button></form></div></div>`).join('') || `<p class="mut">—</p>`}</div></section>
    <section class="card admin-card"><h2>${text(req, 'ألوان الواجهة')}</h2><form class="admin-grid color-grid" method="post" action="/admin/settings">${csrfField(req)}
      ${[['accent','لون التمييز'],['lightPage','خلفية الصفحة'],['lightSurface','خلفية البطاقات'],['lightText','لون النص'],['darkPage','خلفية الصفحة الداكنة'],['darkSurface','البطاقات الداكنة'],['darkText','النص الداكن']].map(([key,label]) => `<label>${text(req,label)}<input class="color-input" type="color" name="${key}" value="${colorValue(key)}"></label>`).join('')}
      <button class="btn" type="submit">${text(req, 'حفظ الإعدادات')}</button></form></section>`;
  res.send(page(req, 'لوحة الإدارة', html));
});
app.post('/admin/members', needLogin, needAdmin, needCsrf, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0,80), username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || ''), role = req.body.role === 'admin' ? 'admin' : 'member';
  if (!name || !/^[a-z0-9._-]{3,32}$/.test(username)) return res.redirect('/admin?e=invalid');
  if (password.length < 6) return res.redirect('/admin?e=password');
  try { db.prepare('INSERT INTO users(username,name,pass_hash,role,active) VALUES(?,?,?,?,1)').run(username,name,bcrypt.hashSync(password,10),role); }
  catch { return res.redirect('/admin?e=duplicate'); }
  res.redirect('/admin?ok=member');
});
app.post('/admin/members/:id/update', needLogin, needAdmin, needCsrf, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
  if (!u) return res.redirect('/admin?e=invalid');
  const name = String(req.body.name || '').trim().slice(0,80), username = String(req.body.username || '').trim().toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'member', active = req.body.active === '1' ? 1 : 0, password = String(req.body.password || '');
  if (!name || !/^[a-z0-9._-]{3,32}$/.test(username) || (password && password.length < 6)) return res.redirect(`/admin?e=${password && password.length < 6 ? 'password' : 'invalid'}`);
  const adminsLeft = Number(db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?").get(u.id).n);
  if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && adminsLeft === 0) return res.redirect('/admin?e=lastAdmin');
  try {
    if (password) db.prepare('UPDATE users SET name=?,username=?,role=?,active=?,pass_hash=? WHERE id=?').run(name,username,role,active,bcrypt.hashSync(password,10),u.id);
    else db.prepare('UPDATE users SET name=?,username=?,role=?,active=? WHERE id=?').run(name,username,role,active,u.id);
  } catch { return res.redirect('/admin?e=duplicate'); }
  res.redirect('/admin?ok=member-updated');
});
app.post('/admin/sections', needLogin, needAdmin, needCsrf, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0,180), hint = String(req.body.hint || '').trim().slice(0,500);
  const unit = Number(req.body.unit), owner = req.body.owner_id ? Number(req.body.owner_id) : null;
  if (!title || ![1,2,3,4].includes(unit) || (owner && !userById(owner)?.active)) return res.redirect('/admin?e=invalid');
  const pos = Number(db.prepare('SELECT COALESCE(MAX(pos),-1)+1 p FROM sections WHERE unit=?').get(unit).p);
  const mode = ['owner','team','person'].includes(req.body.edit_mode) ? req.body.edit_mode : 'owner';
  db.prepare('INSERT INTO sections(unit,pos,title,hint,owner_id,status,content,edit_mode) VALUES(?,?,?,?,?,?,?,?)').run(unit,pos,title,hint,owner,'todo','',owner ? mode : 'team');
  res.redirect('/admin?ok=section');
});
app.post('/admin/sections/:id/update', needLogin, needAdmin, needCsrf, (req, res) => {
  const section = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.params.id));
  const title = String(req.body.title || '').trim().slice(0,180), hint = String(req.body.hint || '').trim().slice(0,500);
  const unit = Number(req.body.unit), owner = req.body.owner_id ? Number(req.body.owner_id) : null, status = STATUS[req.body.status] ? req.body.status : section?.status;
  const mode = ['owner','team','person'].includes(req.body.edit_mode) ? req.body.edit_mode : 'owner';
  let editor = req.body.editor_id ? Number(req.body.editor_id) : null;
  if (!section || !title || ![1,2,3,4].includes(unit) || (owner && !userById(owner)?.active)) return res.redirect('/admin?e=invalid');
  if (mode === 'person' && (!editor || !userById(editor)?.active || editor === owner)) return res.redirect('/admin?e=invalid');
  db.prepare('UPDATE sections SET unit=?,title=?,hint=?,owner_id=?,status=?,edit_mode=?,editor_id=? WHERE id=?').run(unit,title,hint,owner,status,mode,mode === 'person' ? editor : null,section.id);
  res.redirect('/admin?ok=section-updated');
});
app.post('/admin/sections/:id/archive', needLogin, needAdmin, needCsrf, (req, res) => {
  db.prepare('UPDATE sections SET archived=1 WHERE id=?').run(Number(req.params.id));
  res.redirect('/admin?ok=archived');
});
app.post('/admin/sections/:id/restore', needLogin, needAdmin, needCsrf, (req, res) => {
  db.prepare('UPDATE sections SET archived=0 WHERE id=?').run(Number(req.params.id));
  res.redirect('/admin?ok=restored');
});
app.post('/admin/sections/:id/delete', needLogin, needAdmin, needCsrf, (req, res) => {
  const id = Number(req.params.id);
  const section = db.prepare('SELECT id FROM sections WHERE id=? AND archived=1').get(id);
  if (!section) return res.redirect('/admin?e=invalid');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM comments WHERE section_id=?').run(id);
    db.prepare('DELETE FROM sections WHERE id=? AND archived=1').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.redirect('/admin?ok=permanently-deleted');
});
app.post('/admin/settings', needLogin, needAdmin, needCsrf, (req, res) => {
  for (const key of Object.keys(settingsDefaults)) {
    const value = String(req.body[key] || '');
    if (!/^#[\da-fA-F]{6}$/.test(value)) return res.redirect('/admin?e=invalid');
    saveSetting.run(key, value.toLowerCase());
  }
  res.redirect('/admin?ok=settings');
});

// ---------- dashboard ----------
app.get('/', needLogin, (req, res) => {
  const mine = req.query.mine === '1';
  const memberId = /^\d+$/.test(String(req.query.member || '')) ? Number(req.query.member) : null;
  const memberView = memberId && memberId !== req.user.id ? memberId : null;
  const all = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM comments c WHERE c.section_id=s.id) cc FROM sections s WHERE s.archived=0 ORDER BY unit,pos').all();
  const U = Object.fromEntries(users().map((u) => [u.id, u]));
  const dependenciesBySection = dependencyRowsFor(all.map((section) => section.id));
  const members = db.prepare(`SELECT u.id,u.name,COUNT(s.id) AS section_count
    FROM users u JOIN sections s ON s.owner_id=u.id AND s.archived=0
    WHERE u.id<>? GROUP BY u.id,u.name ORDER BY u.id`).all(req.user.id);
  const cnt = { todo: 0, doing: 0, review: 0, done: 0 };
  all.forEach((s) => cnt[s.status]++);
  const pct = Math.round((cnt.done / all.length) * 100);
  const savedSectionId = /^\d+$/.test(String(req.query.saved || '')) ? Number(req.query.saved) : 0;
  const savedSection = savedSectionId ? all.find((section) => section.id === savedSectionId) : null;
  const deletedSectionId = /^\d+$/.test(String(req.query.deleted || '')) ? Number(req.query.deleted) : 0;
  const deletedSection = deletedSectionId ? all.find((section) => section.id === deletedSectionId) : null;
  const dashboardToast = savedSection ? `<div class="save-toast dashboard-toast" role="status">${req.lang === 'en' ? `Task “${esc(text(req,savedSection.title))}” saved (Unit ${savedSection.unit}).` : `تم حفظ تغييرات المهمة «${esc(text(req,savedSection.title))}» في الوحدة ${savedSection.unit}`}</div>` : deletedSection ? `<div class="save-toast dashboard-toast" role="status">${req.lang === 'en' ? `Comment deleted from “${esc(text(req,deletedSection.title))}”.` : `تم حذف التعليق من مهمة «${esc(text(req,deletedSection.title))}»`}</div>` : '';
  let html = `${dashboardToast}${req.query.welcome ? `<p class="form-success" role="status">${text(req, 'تم تسجيل الدخول بنجاح')}</p>` : ''}<section class="hero card"><div><h1>${text(req, 'أهلًا')} ${esc(userName(req, req.user))}</h1><p class="mut">${text(req, 'كل الأقسام ظاهرة للجميع، وتعدّل فقط على الأقسام التي تخصّك. وتقدر تكتب تعليقًا على أي قسم.')}</p></div>
  <div class="prog"><progress max="100" value="${pct}"></progress><b>${pct}%</b></div>
  <div class="counts">${Object.keys(STATUS).map((k) => `<span class="pill ${k}">${statusName(req, k)} · ${cnt[k]}</span>`).join('')}</div></section>
  <div class="tabs"><a class="${!mine && !memberView ? 'on' : ''}" href="/">${text(req, 'كل الأقسام')}</a><a class="${mine ? 'on' : ''}" href="/?mine=1">${text(req, 'أقسامي')}</a>${members.map((u) => `<a class="${memberView === u.id ? 'on' : ''}" href="/?member=${u.id}">${esc(userName(req, u))} <small>(${u.section_count})</small></a>`).join('')}</div>`;
  for (const n of [1, 2, 3, 4]) {
    const list = all.filter((s) => s.unit === n
      && (mine ? (s.owner_id === req.user.id || s.owner_id == null)
        : memberView ? s.owner_id === memberView : true));
    if (!list.length) continue;
    html += `<h2>${text(req, 'الوحدة')} ${n} · ${unitName(req, n)}</h2><div class="list">` + list.map((s) => {
      const presentation = dependencyPresentation(req, s, dependenciesBySection.get(s.id) || []);
      const editLabel = s.edit_mode === 'team' ? text(req, 'مفتوح التعديل للجميع') : s.edit_mode === 'person' && s.editor_id ? `${text(req, 'مفتوح التعديل لـ')} ${userName(req, U[s.editor_id])}` : '';
      return `<a class="row" id="section-${s.id}" href="/s/${s.id}">
      <div class="t"><span class="section-title">${esc(text(req, s.title))}</span>${dependencyNoteMarkup(req, presentation)}</div><span class="meta">${chip(U[s.owner_id], req.lang)}${editLabel ? `<span class="open">${esc(editLabel)}</span>` : ''}${s.cc ? `<span class="cc">💬 ${s.cc}</span>` : ''}${pill(s.status, req)}</span></a>`;
    }).join('') + '</div>';
  }
  res.send(page(req, 'الأقسام', html));
});

// ---------- section ----------
function loadSection(req, res) {
  const s = db.prepare('SELECT * FROM sections WHERE id=? AND archived=0').get(Number(req.params.id));
  if (!s) { res.status(404).send(page(req, 'غير موجود', `<p class="card">${text(req, 'القسم غير موجود')}</p>`)); return null; }
  return s;
}
app.get('/s/:id', needLogin, async (req, res) => {
  const s = loadSection(req, res); if (!s) return;
  if (process.env.GOOGLE_TRANSLATE_API_KEY && s.content && (!s.content_ar || !s.content_en)) {
    const pair = await bilingualText(s.content);
    if (pair.translated) {
      db.prepare('UPDATE sections SET content_ar=?,content_en=?,content_source_lang=? WHERE id=?')
        .run(pair.ar, pair.en, pair.sourceLang, s.id);
      s.content_ar = pair.ar; s.content_en = pair.en; s.content_source_lang = pair.sourceLang;
    }
  }
  const owner = s.owner_id ? userById(s.owner_id) : null;
  const edit = canEdit(req.user, s), manage = canManage(req.user, s);
  const dependencyPresentationForSection = dependencyPresentation(req, s, dependencyRowsFor([s.id]).get(s.id) || []);
  const U = Object.fromEntries(users().map((u) => [u.id, u]));
  const com = db.prepare('SELECT * FROM comments WHERE section_id=? ORDER BY id').all(s.id);
  if (process.env.GOOGLE_TRANSLATE_API_KEY) {
    await Promise.all(com.filter((c) => c.body && (!c.body_ar || !c.body_en)).map(async (c) => {
      const pair = await bilingualText(c.body);
      if (!pair.translated) return;
      db.prepare('UPDATE comments SET body_ar=?,body_en=?,source_lang=? WHERE id=?').run(pair.ar, pair.en, pair.sourceLang, c.id);
      c.body_ar = pair.ar; c.body_en = pair.en; c.source_lang = pair.sourceLang;
    }));
  }
  let h = `<p class="crumb"><a href="/">${text(req, '← كل الأقسام')}</a> · ${text(req, 'الوحدة')} ${s.unit}: ${unitName(req, s.unit)}</p>${dependencyNoteMarkup(req, dependencyPresentationForSection, true)}
  <form id="section-form" class="section-form" method="post" action="/s/${s.id}/save-all" data-baseline="${esc(JSON.stringify({ content: s.content, status: s.status, mode: s.edit_mode, editor: s.editor_id == null ? '' : String(s.editor_id) }))}">${csrfField(req)}
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
    const others = users().filter((u) => u.id !== s.owner_id);
    h += `<section class="card"><h2>${text(req, 'من يقدر يعدّل هذا القسم؟')}</h2>
    <label class="r"><input type="radio" name="mode" value="owner"${s.edit_mode === 'owner' ? ' checked' : ''}> ${text(req, 'أنا فقط')}</label>
    <label class="r"><input type="radio" name="mode" value="team"${s.edit_mode === 'team' ? ' checked' : ''}> ${text(req, 'الفريق كله')}</label>
    <label class="r"><input type="radio" name="mode" value="person"${s.edit_mode === 'person' ? ' checked' : ''}> ${text(req, 'شخص محدد:')}
      <select name="editor">${others.map((u) => `<option value="${u.id}"${u.id === s.editor_id ? ' selected' : ''}>${esc(userName(req, u))}</option>`).join('')}</select></label>
    </section>`;
  }
  h += `<section class="card" id="comments-card"><h2>${text(req, 'التعليقات')} (<span id="comment-count">${com.length}</span>)</h2><div id="comments-list">${com.map((c) => `<div class="cm" data-comment-id="${c.id}"><div class="cmh">${chip(U[c.user_id], req.lang)}<span class="mut">${esc(fmt(c.created_at, req.lang))}</span>
    ${c.user_id === req.user.id ? `<span class="delete-comment"><button class="link" type="button" data-delete-comment="${c.id}" data-csrf="${esc(req.csrf)}">${text(req, 'حذف')}</button></span>` : ''}</div><p>${esc(commentText(c, req.lang))}</p></div>`).join('') || `<p class="mut" data-empty-comments>${text(req, 'لا توجد تعليقات.')}</p>`}</div>
  <label>${text(req, 'أضف تعليقًا')}<textarea id="comment-draft" name="comment" rows="3" maxlength="2000" placeholder="${text(req, 'ملاحظة أو اقتراح...')}"></textarea></label></section>
  <div class="save-all-wrap save-toolbar"><span id="save-state" class="save-state" role="status" aria-live="polite">${text(req, 'لا توجد تغييرات غير محفوظة')}</span><button class="btn" type="submit" id="save-all">${text(req, 'حفظ التغييرات')}</button></div></form>`;
  res.send(page(req, s.title, h));
});
app.post('/s/:id/save', needLogin, needCsrf, (req, res) => {
  const s = loadSection(req, res); if (!s) return;
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
  if (!sets.length) return res.redirect(`/s/${s.id}`);

  sets.push('updated_at=?', 'updated_by=?');
  values.push(nowIso(), req.user.id, s.id);
  db.prepare(`UPDATE sections SET ${sets.join(',')} WHERE id=?`).run(...values);
  res.redirect(`/s/${s.id}?ok=1`);
});
app.post('/s/:id/save-all', needLogin, needCsrf, async (req, res) => {
  const s = loadSection(req, res); if (!s) return;
  if (!canEdit(req.user, s) && Object.prototype.hasOwnProperty.call(req.body, 'content')) return res.status(403).json({ error: req.lang === 'en' ? 'You are not allowed to edit this section.' : 'لا تملك صلاحية تعديل المحتوى.' });
  if (!canManage(req.user, s) && Object.prototype.hasOwnProperty.call(req.body, 'mode')) return res.status(403).json({ error: req.lang === 'en' ? 'You are not allowed to change section permissions.' : 'لا تملك صلاحية تغيير صلاحيات القسم.' });
  const contentChanged = Object.prototype.hasOwnProperty.call(req.body, 'content')
    && String(req.body.content || '').slice(0, 50000) !== sectionText(s, req.lang);
  const contentPair = contentChanged ? await bilingualText(req.body.content) : null;
  const newComment = String(req.body.comment || '').trim().slice(0, 2000);
  const commentPair = newComment ? await bilingualText(newComment) : null;
  const requestId = /^[\da-f-]{36}$/i.test(String(req.body.client_request_id || '')) ? String(req.body.client_request_id) : null;
  db.exec('BEGIN IMMEDIATE');
  try {
  const commentAlreadySaved = requestId && newComment
    ? db.prepare('SELECT id FROM comments WHERE client_request_id=? AND user_id=?').get(requestId, req.user.id)
    : null;
  if (contentPair && canEdit(req.user, s)) {
    const st = STATUS[req.body.status] ? req.body.status : s.status;
    db.prepare('UPDATE sections SET content=?, content_ar=?, content_en=?, content_source_lang=?, status=?, updated_at=?, updated_by=? WHERE id=?')
      .run(String(req.body.content || '').slice(0, 50000), contentPair.ar, contentPair.en, contentPair.sourceLang, st, nowIso(), req.user.id, s.id);
  } else if (Object.prototype.hasOwnProperty.call(req.body, 'content') && canEdit(req.user, s)) {
    const st = STATUS[req.body.status] ? req.body.status : s.status;
    if (st !== s.status) db.prepare('UPDATE sections SET status=?, updated_at=?, updated_by=? WHERE id=?').run(st, nowIso(), req.user.id, s.id);
  } else if (Object.prototype.hasOwnProperty.call(req.body, 'status') && STATUS[req.body.status] && canEdit(req.user, s)) {
    db.prepare('UPDATE sections SET status=?, updated_at=?, updated_by=? WHERE id=?')
      .run(req.body.status, nowIso(), req.user.id, s.id);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'mode') && canManage(req.user, s) && s.owner_id) {
    const mode = ['owner', 'team', 'person'].includes(req.body.mode) ? req.body.mode : 'owner';
    let editor = null;
    if (mode === 'person') {
      editor = Number(req.body.editor);
      if (!userById(editor) || editor === s.owner_id) editor = s.editor_id || null;
    }
    db.prepare('UPDATE sections SET edit_mode=?, editor_id=? WHERE id=?').run(mode, editor, s.id);
  }

  if (newComment && !commentAlreadySaved) db.prepare('INSERT INTO comments(section_id,user_id,body,created_at,body_ar,body_en,source_lang,client_request_id) VALUES(?,?,?,?,?,?,?,?)')
    .run(s.id, req.user.id, newComment, nowIso(), commentPair.ar, commentPair.en, commentPair.sourceLang, requestId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true, savedAt: nowIso(), sectionId: s.id, sectionTitle: s.title, unit: s.unit, translationPending: Boolean((contentPair && !contentPair.translated) || (commentPair && !commentPair.translated)) });
  res.redirect(`/s/${s.id}?ok=1`);
});
app.post('/c/:id/delete', needLogin, needCsrf, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id=?').get(Number(req.params.id));
  if (!c || c.user_id !== req.user.id) {
    if (req.get('X-Requested-With') === 'fetch') return res.status(c ? 403 : 404).json({ error: req.lang === 'en' ? 'Could not delete the comment.' : 'تعذّر حذف التعليق.' });
    return res.redirect(c ? `/s/${c.section_id}` : '/');
  }
  db.prepare('DELETE FROM comments WHERE id=?').run(c.id);
  if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true, id: c.id, sectionId: c.section_id });
  res.redirect(c ? `/s/${c.section_id}` : '/');
});

app.listen(PORT, () => console.log('TENDRO docs on :' + PORT));
