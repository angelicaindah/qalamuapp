const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Kartu "Pengingat hari ini" di Dashboard — berganti tiap hari
router.get('/today', auth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM reminders').get().c;
  // Hari dihitung berdasarkan Asia/Jakarta (UTC+7, tanpa DST) agar berganti tepat tengah malam WIB
  const dayNumber = Math.floor((Date.now() + 7 * 3600 * 1000) / 86400000);
  const row = db
    .prepare('SELECT * FROM reminders ORDER BY id LIMIT 1 OFFSET ?')
    .get(dayNumber % total);
  res.json(row);
});

module.exports = router;
