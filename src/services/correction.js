// Menganalisis foto tulisan Arab. Jika ANTHROPIC_API_KEY kosong, pakai data mock.
const Anthropic = require('@anthropic-ai/sdk');

// Kategori kesalahan; dipakai juga oleh layar Laporan peningkatan
const CATEGORIES = ['Harakat', 'Bentuk Huruf', 'Sambung Huruf', 'Ejaan'];

const PROMPT = `Kamu adalah guru Bahasa Arab. Pada gambar ada tulisan tangan/cetak Bahasa Arab.
Lakukan:
1. Baca teks Arab pada gambar (recognized_text).
2. Koreksi kesalahan penulisan, ejaan, harakat, dan tata bahasa (corrected_text).
3. Beri catatan umum singkat dalam Bahasa Indonesia (feedback).
4. Beri skor 0-100 (score).
5. Hitung jumlah seluruh kata (total_words) dan jumlah kata yang sudah tepat (correct_words).
6. Daftarkan setiap kata yang salah di "mistakes", masing-masing berisi:
   - wrong: kata seperti yang tertulis
   - correct: kata yang benar
   - explanation: penjelasan singkat dalam Bahasa Indonesia mengapa salah
   - category: salah satu dari ${CATEGORIES.join(', ')}
Balas HANYA JSON valid tanpa markdown dengan kunci:
{"recognized_text": "", "corrected_text": "", "feedback": "", "score": 0, "total_words": 0, "correct_words": 0, "mistakes": [{"wrong": "", "correct": "", "explanation": "", "category": ""}]}`;

// Mengambil objek JSON pertama dari teks jawaban AI (toleran terhadap kalimat pembuka/penutup)
function extractJson(text) {
  const clean = text.replace(/```json|```/g, '');
  const start = clean.indexOf('{');
  if (start === -1) throw new Error('Jawaban AI tidak berisi JSON');
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }
  throw new Error('JSON dari AI tidak lengkap');
}

// Memvalidasi setiap kunci dan membatasi score ke 0-100
function normalizeResult(raw) {
  for (const k of ['recognized_text', 'corrected_text', 'feedback']) {
    if (typeof raw[k] !== 'string') throw new Error(`Kunci ${k} dari AI tidak valid`);
  }
  const num =
    typeof raw.score === 'number' ? raw.score
    : typeof raw.score === 'string' && raw.score.trim() !== '' ? Number(raw.score)
    : NaN;
  if (!Number.isFinite(num)) throw new Error('score dari AI tidak valid');
  const toCount = (v, key) => {
    const n =
      typeof v === 'number' ? v
      : typeof v === 'string' && v.trim() !== '' ? Number(v)
      : NaN;
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key} dari AI tidak valid`);
    return Math.round(n);
  };
  const total_words = toCount(raw.total_words, 'total_words');
  const correct_words = Math.min(toCount(raw.correct_words, 'correct_words'), total_words);
  if (!Array.isArray(raw.mistakes)) throw new Error('mistakes dari AI tidak valid');
  const mistakes = raw.mistakes.slice(0, 50).map((m) => {
    if (!m || typeof m !== 'object') throw new Error('Isi mistakes dari AI tidak valid');
    for (const k of ['wrong', 'correct', 'explanation']) {
      if (typeof m[k] !== 'string') throw new Error(`Kunci ${k} pada mistakes tidak valid`);
    }
    // Kategori di luar daftar dimasukkan ke "Ejaan"
    const category =
      CATEGORIES.find((c) => c.toLowerCase() === String(m.category || '').trim().toLowerCase()) || 'Ejaan';
    return { wrong: m.wrong, correct: m.correct, explanation: m.explanation, category };
  });
  return {
    recognized_text: raw.recognized_text,
    corrected_text: raw.corrected_text,
    feedback: raw.feedback,
    score: Math.min(100, Math.max(0, Math.round(num))),
    total_words,
    correct_words,
    mistakes,
  };
}

async function analyzeHandwriting(buffer, mimeType) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      recognized_text: 'ذَهَبَ الْوَلَدُ سَرِيعًا إِلَى الْمَدْرَسَةُ',
      corrected_text: 'ذَهَبَ الْوَلَدُ سَرِيعًا إِلَى الْمَدْرَسَةِ',
      feedback: 'Mode mock: isi ANTHROPIC_API_KEY di .env untuk koreksi sungguhan.',
      score: 80,
      total_words: 5,
      correct_words: 4,
      mistakes: [
        {
          wrong: 'الْمَدْرَسَةُ',
          correct: 'الْمَدْرَسَةِ',
          explanation: 'Tambahkan kasrah di akhir kata, karena berada setelah huruf jar إِلَى.',
          category: 'Harakat',
        },
      ],
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') },
          },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return normalizeResult(extractJson(text));
}

module.exports = { analyzeHandwriting, CATEGORIES, normalizeResult, extractJson };
