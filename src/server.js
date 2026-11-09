require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET belum diisi. Salin .env.example menjadi .env');
  process.exit(1);
}

const app = express();

// Di belakang proxy hosting, isi TRUST_PROXY=1 (jumlah proxy) agar alamat IP pengguna terbaca benar
// oleh pembatas login. Dibiarkan kosong, perilakunya sama seperti sebelumnya.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v);
}
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/profile'));
app.use('/api/reminder', require('./routes/reminder'));
app.use('/api/corrections', require('./routes/corrections'));
app.use('/api/report', require('./routes/report'));

// Alamat /api yang tidak ada menjawab 404
app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint tidak ditemukan' }));

// Pesan error internal tidak dikirim ke pengguna; hanya error yang memang ditandai aman (expose)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed')
    return res.status(400).json({ message: 'Format JSON tidak valid' });
  if (err.type === 'entity.too.large')
    return res.status(413).json({ message: 'Data terlalu besar' });
  if (err.name === 'MulterError')
    return res.status(400).json({
      message: err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran foto maksimal 5 MB' : 'Gagal mengunggah file',
    });
  if (err.expose) return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: 'Terjadi kesalahan pada server' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`QalaMu API berjalan di http://localhost:${port}`));
