const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { CATEGORIES } = require('../services/correction');

const router = express.Router();

// Layar "Laporan peningkatan": skor rata-rata + ketepatan per kategori
// (ketepatan kategori = 100 dikurangi persentase kesalahan kategori itu terhadap seluruh kata yang pernah dikoreksi)
router.get('/', auth, (req, res) => {
  const rows = db
    .prepare('SELECT score, total_words, mistakes FROM corrections WHERE user_id = ?')
    .all(req.user.id);

  const scores = rows.map((r) => r.score).filter((n) => Number.isFinite(n));
  const average_score = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  const errors = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  let words = 0;
  for (const r of rows) {
    if (!r.total_words) continue; // data lama tanpa rincian kata
    words += r.total_words;
    let list = [];
    try {
      list = r.mistakes ? JSON.parse(r.mistakes) : [];
    } catch {
      list = [];
    }
    for (const m of list) if (m.category in errors) errors[m.category]++;
  }

  const categories = CATEGORIES.map((name) => ({
    name,
    score: words ? Math.max(0, Math.round(100 * (1 - errors[name] / words))) : null,
  }));

  res.json({ average_score, total_corrections: rows.length, categories });
});

module.exports = router;
