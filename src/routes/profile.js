const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
const USERNAME_RE = /^[A-Za-z0-9._]+$/;

// Dipakai Dashboard ("Assalamu'alaikum <nama>") & tab Profil
router.get('/me', auth, (req, res) => {
  const u = db
    .prepare('SELECT id, name, email, username, gender, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!u) return res.status(404).json({ message: 'User tidak ditemukan' });
  res.json(u);
});

// Layar "Create Acc" 2: Nama Pengguna, Jenis Kelamin -> Selanjutnya
router.put('/profile', auth, (req, res) => {
  const { username: rawUsername, gender } = req.body;
  if (typeof rawUsername !== 'string' || typeof gender !== 'string' || !rawUsername.trim() || !gender)
    return res.status(400).json({ message: 'Nama pengguna dan jenis kelamin wajib diisi' });
  const username = rawUsername.trim();
  if (!USERNAME_RE.test(username))
    return res.status(400).json({
      message: 'Nama pengguna hanya boleh berisi huruf, angka, titik, dan garis bawah',
    });
  if (!['laki-laki', 'perempuan'].includes(gender))
    return res.status(400).json({ message: "Jenis kelamin harus 'laki-laki' atau 'perempuan'" });

  const taken = db
    .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
    .get(username, req.user.id);
  if (taken) return res.status(409).json({ message: 'Nama pengguna sudah dipakai' });

  db.prepare('UPDATE users SET username = ?, gender = ? WHERE id = ?').run(
    username, gender, req.user.id
  );
  res.json({ message: 'Profil diperbarui', username, gender });
});

module.exports = router;
