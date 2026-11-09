const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const auth = require('../middleware/auth');
const { analyzeHandwriting } = require('../services/correction');

const router = express.Router();
router.use(auth);

// Baris database -> respons API (kolom mistakes disimpan sebagai JSON; data lama dianggap kosong)
function present(r) {
  let mistakes = [];
  try {
    mistakes = r.mistakes ? JSON.parse(r.mistakes) : [];
  } catch {
    mistakes = [];
  }
  return { ...r, mistakes, image_url: `/api/corrections/${r.id}/image` };
}

// Lokasi foto bisa diatur lewat UPLOAD_DIR (mis. disk permanen di hosting); bila kosong memakai folder uploads/
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Batasi permintaan koreksi per pengguna (setiap panggilan memakan biaya API AI)
const correctionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  handler: (req, res) =>
    res.status(429).json({ message: 'Terlalu banyak permintaan koreksi. Coba lagi beberapa menit lagi.' }),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(Object.assign(new Error('Hanya JPG, PNG, atau WEBP'), { expose: true })),
});

// Layar "Koreksi": kirim foto tulisan (kamera / galeri) -> field form "image"
router.post('/', correctionLimiter, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Foto tulisan wajib diunggah (field: image)' });

  try {
    const result = await analyzeHandwriting(req.file.buffer, req.file.mimetype);

    const ext = req.file.mimetype.split('/')[1];
    const filename = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);

    const info = db
      .prepare(
        `INSERT INTO corrections
           (user_id, image_path, recognized_text, corrected_text, feedback, score, total_words, correct_words, mistakes)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        req.user.id, filename, result.recognized_text, result.corrected_text, result.feedback, result.score,
        result.total_words, result.correct_words, JSON.stringify(result.mistakes)
      );

    res.status(201).json({ id: Number(info.lastInsertRowid), image_url: `/api/corrections/${info.lastInsertRowid}/image`, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal memproses koreksi tulisan' });
  }
});

// Tab Riwayat
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, image_path, recognized_text, corrected_text, feedback, score,
              total_words, correct_words, mistakes, created_at
       FROM corrections WHERE user_id = ? ORDER BY id DESC`
    )
    .all(req.user.id)
    .map(present);
  res.json(rows);
});

// Foto hanya bisa dibuka oleh pemiliknya (butuh token)
router.get('/:id/image', (req, res) => {
  const r = db
    .prepare('SELECT image_path FROM corrections WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ message: 'Data tidak ditemukan' });
  const file = path.join(uploadDir, path.basename(r.image_path));
  if (!fs.existsSync(file)) return res.status(404).json({ message: 'Foto tidak ditemukan' });
  res.sendFile(file, { headers: { 'Cache-Control': 'private, max-age=0' } });
});

router.get('/:id', (req, res) => {
  const r = db
    .prepare('SELECT * FROM corrections WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ message: 'Data tidak ditemukan' });
  res.json(present(r));
});

router.delete('/:id', (req, res) => {
  const row = db
    .prepare('SELECT image_path FROM corrections WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  const info = db
    .prepare('DELETE FROM corrections WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!row || !info.changes) return res.status(404).json({ message: 'Data tidak ditemukan' });
  // Hapus file fotonya setelah baris database berhasil dihapus
  fs.unlink(path.join(uploadDir, path.basename(row.image_path)), () => {});
  res.json({ message: 'Riwayat dihapus' });
});

module.exports = router;
