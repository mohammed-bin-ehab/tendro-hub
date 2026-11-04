
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

module.exports = { bilingualText, sectionText, commentText };
