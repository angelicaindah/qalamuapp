const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');

const router = express.Router();
// Batasi percobaan login yang gagal: 10 kali per 15 menit per alamat IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }),
});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Akun admin hanya bisa dibuat bila server punya ADMIN_CODE dan kode itu diisi dengan benar saat daftar
const ROLES = ['user', 'admin'];
const sign = (user) =>
  jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Layar "Create Acc" 1: Nama, Email, Kata Sandi -> Daftar
router.post('/register', (req, res) => {
  const { name: rawName, email: rawEmail, password, role: rawRole, admin_code } = req.body;
  if (typeof rawName !== 'string' || typeof rawEmail !== 'string' || typeof password !== 'string')
    return res.status(400).json({ message: 'Nama, email, dan kata sandi wajib diisi' });
  const name = rawName.trim();
  const email = rawEmail.trim();
  if (!name || !email || !password)
    return res.status(400).json({ message: 'Nama, email, dan kata sandi wajib diisi' });
  if (!EMAIL_RE.test(email))
    return res.status(400).json({ message: 'Format email tidak valid' });
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
    return res.status(400).json({
      message: 'Kata sandi minimal 8 karakter, mengandung 1 huruf besar dan 1 angka',
    });

  const role = rawRole === undefined || rawRole === '' ? 'user' : rawRole;
  if (!ROLES.includes(role)) return res.status(400).json({ message: "Peran harus 'user' atau 'admin'" });
  if (role === 'admin') {
    if (!process.env.ADMIN_CODE)
      return res.status(403).json({ message: 'Pendaftaran admin belum diaktifkan di server' });
    if (typeof admin_code !== 'string' || admin_code !== process.env.ADMIN_CODE)
      return res.status(403).json({ message: 'Kode admin salah' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ message: 'Email sudah terdaftar' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run(name, email.toLowerCase(), hash, role);
  const user = { id: Number(info.lastInsertRowid), email: email.toLowerCase() };

  res.status(201).json({
    message: 'Akun dibuat. Lanjutkan melengkapi profil.',
    token: sign(user),
    user: { id: user.id, name, email: user.email, role },
  });
});

// Layar "Login": Email, Kata Sandi -> Masuk
router.post('/login', loginLimiter, (req, res) => {
  const { email, password, role: wantedRole } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password)
    return res.status(400).json({ message: 'Email dan kata sandi wajib diisi' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ message: 'Email atau kata sandi salah' });

  // Pilihan "Masuk Sebagai" di layar Login harus cocok dengan peran akun
  if (wantedRole !== undefined && wantedRole !== user.role)
    return res.status(403).json({
      message:
        user.role === 'admin'
          ? 'Akun ini terdaftar sebagai Admin. Pilih "Admin" pada Masuk Sebagai.'
          : 'Akun ini bukan Admin. Pilih "Pengguna" pada Masuk Sebagai.',
    });

  res.json({
    token: sign(user),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      gender: user.gender,
      role: user.role,
      // admin tidak perlu melengkapi profil pengguna
      profile_complete: user.role === 'admin' || !!(user.username && user.gender),
    },
  });
});

module.exports = router;
