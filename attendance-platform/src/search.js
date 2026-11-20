'use strict';
/*
 * البحث بالأسماء العربية (نفس القواعد في public/common.js):
 * - لا يفرّق بين: أ إ آ ٱ ا، ة ه، ى ي، ئ ي، ؤ و، ولا يتأثر بالتشكيل والتطويل.
 * - «عبد الله» = «عبدالله»، و«أبو بكر» = «أبوبكر».
 * - يبحث بالكلمات: كل كلمة في البحث يجب أن تكون جزءاً من كلمة في الاسم، بأي ترتيب،
 *   وتُتجاهل «بن، بنت، ابن، ابنة، ولد». مثال: «أحمد القنوبي» يجد «أحمد بن محمد بن راشد القنوبي».
 */
const STOP = new Set(['بن', 'بنت', 'ابن', 'ابنه', 'ولد', 'bin', 'bint']);

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ‌-‏]/g, '') // تشكيل، تطويل، علامات الاتجاه
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(^|\s)(عبد|ابو|ابي|ام) (?=\S)/g, '$1$2') // «عبد الله» ← «عبدالله»
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokens(q) {
  return normalizeName(q).split(' ').filter((t) => t && !STOP.has(t));
}

function nameMatches(name, q) {
  const tokens = Array.isArray(q) ? q : queryTokens(q);
  if (!tokens.length) return true;
  const words = normalizeName(name).split(' ');
  // كل كلمة بحث تطابق كلمة مختلفة في الاسم (حتى «محمد محمد» يتطلب اسمين)
  const used = new Set();
  return tokens.every((t) => {
    const i = words.findIndex((w, k) => !used.has(k) && w.includes(t));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

module.exports = { normalizeName, queryTokens, nameMatches };
