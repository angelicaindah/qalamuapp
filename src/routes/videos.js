const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

// Video disimpan di subfolder "videos" pada lokasi unggahan yang sama dengan foto (UPLOAD_DIR bila diisi)
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', '..', 'uploads');
const videoDir = path.join(uploadDir, 'videos');
fs.mkdirSync(videoDir, { recursive: true });

const MAX_MB = Number(process.env.VIDEO_MAX_MB) || 200;
const EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

// Pemutar <video> tidak bisa mengirim header Authorization, jadi alamat file video
// juga menerima token lewat ?t=. Endpoint lain tetap memakai header seperti biasa.
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : typeof req.query.t === 'string'
      ? req.query.t
      : null;
  if (!token) return res.status(401).json({ message: 'Token tidak ditemukan' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token tidak valid atau kedaluwarsa' });
  }
}

// Peran dibaca dari database (bukan dari token) supaya perubahan peran langsung berlaku
function adminOnly(req, res, next) {
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (!u || u.role !== 'admin')
    return res.status(403).json({ message: 'Hanya admin yang bisa mengunggah video' });
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, videoDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.${EXT[file.mimetype] || 'mp4'}`),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    EXT[file.mimetype]
      ? cb(null, true)
      : cb(Object.assign(new Error('Video harus berformat MP4 atau MOV'), { expose: true })),
});

const present = (r) => ({
  id: r.id,
  title: r.title,
  kind: r.file_path ? 'file' : 'link',
  video_url: r.file_path ? `/api/videos/${r.id}/file` : null,
  link_url: r.link_url || null,
  created_at: r.created_at,
});

const removeFile = (p) => p && fs.unlink(p, () => {});

// Halaman "Kelas Video": semua pengguna yang sudah masuk bisa melihat daftar video
router.get('/', auth, (req, res) => {
  const rows = db
    .prepare('SELECT id, title, file_path, link_url, created_at FROM videos ORDER BY id DESC')
    .all();
  res.json(rows.map(present));
});

// Admin: unggah video (field form "video") ATAU tempel tautan (field "link"), plus "title"
router.post('/', auth, adminOnly, upload.single('video'), (req, res) => {
  const tmp = req.file ? req.file.path : null;
  const fail = (code, message) => {
    removeFile(tmp);
    return res.status(code).json({ message });
  };

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const link = typeof req.body.link === 'string' ? req.body.link.trim() : '';
  if (!title) return fail(400, 'Judul video wajib diisi');
  if (title.length > 120) return fail(400, 'Judul video maksimal 120 karakter');
  if (req.file && link) return fail(400, 'Pilih salah satu: video dari galeri atau tautan video');
  if (!req.file && !link) return fail(400, 'Pilih video dari galeri atau tempel tautan video');

  if (link) {
    let ok = false;
    try {
      ok = ['http:', 'https:'].includes(new URL(link).protocol);
    } catch {
      ok = false;
    }
    if (!ok || link.length > 500) return fail(400, 'Tautan video tidak valid');
  }

  const info = db
    .prepare('INSERT INTO videos (title, file_path, link_url, mime, created_by) VALUES (?,?,?,?,?)')
    .run(title, req.file ? req.file.filename : null, link || null, req.file ? req.file.mimetype : null, req.user.id);
  const row = db
    .prepare('SELECT id, title, file_path, link_url, created_at FROM videos WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  res.status(201).json(present(row));
});

// File video (mendukung Range supaya bisa diputar dan digeser tanpa mengunduh seluruhnya)
router.get('/:id/file', auth, (req, res) => {
  const r = db.prepare('SELECT file_path, mime FROM videos WHERE id = ?').get(req.params.id);
  if (!r || !r.file_path) return res.status(404).json({ message: 'Video tidak ditemukan' });
  const file = path.join(videoDir, path.basename(r.file_path));
  if (!fs.existsSync(file)) return res.status(404).json({ message: 'File video tidak ditemukan' });
  res.type(r.mime || 'video/mp4');
  res.sendFile(file, { headers: { 'Cache-Control': 'private, max-age=0' } });
});

// Admin: hapus video (file ikut terhapus bila videonya hasil unggahan)
router.delete('/:id', auth, adminOnly, (req, res) => {
  const r = db.prepare('SELECT file_path FROM videos WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ message: 'Video tidak ditemukan' });
  db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
  if (r.file_path) removeFile(path.join(videoDir, path.basename(r.file_path)));
  res.json({ message: 'Video dihapus' });
});

module.exports = router;
