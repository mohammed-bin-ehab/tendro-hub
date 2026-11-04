// Files are stored in PostgreSQL (hosts like Render have no persistent disk). Type is decided by the server, never by the browser.
const MAX_FILE_BYTES = (Number(process.env.MAX_FILE_MB) || 5) * 1024 * 1024;
const MAX_TOTAL_BYTES = (Number(process.env.MAX_TOTAL_MB) || 600) * 1024 * 1024;
const MAX_PER_SECTION = 30;

const TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain; charset=utf-8',
};
const INLINE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const ACCEPT = Object.keys(TYPES).map((e) => '.' + e).join(',');

const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
// the first bytes must agree with the extension (a renamed .exe is rejected)
function contentMatches(ext, buf) {
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  switch (ext) {
    case 'pdf': return starts(0x25, 0x50, 0x44, 0x46);
    case 'png': return starts(0x89, 0x50, 0x4e, 0x47);
    case 'jpg': case 'jpeg': return starts(0xff, 0xd8, 0xff);
    case 'gif': return starts(0x47, 0x49, 0x46, 0x38);
    case 'webp': return starts(0x52, 0x49, 0x46, 0x46) && buf.slice(8, 12).toString('latin1') === 'WEBP';
    case 'docx': case 'xlsx': case 'pptx': return starts(0x50, 0x4b);
    case 'doc': case 'xls': case 'ppt': return starts(0xd0, 0xcf, 0x11, 0xe0);
    case 'txt': return !buf.includes(0);
    default: return false;
  }
}
// browsers send file names as UTF-8 bytes that multer may read as latin1: repair, then strip paths and control characters
function cleanName(raw) {
  let name = String(raw || '');
  if (/[À-ÿ]/.test(name) && !/[^\u0000-ÿ]/.test(name)) {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('�')) name = fixed;
  }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>:*?|]/g, '').trim();
  return name.slice(-120) || 'file';
}
// links: http(s) only, no embedded credentials
function parseLink(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 500) return null;
  let u; try { u = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  return u;
}
const prettySize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

module.exports = { MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_PER_SECTION, TYPES, INLINE, ACCEPT, extOf, contentMatches, cleanName, parseLink, prettySize };
