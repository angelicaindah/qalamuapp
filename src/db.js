const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(process.env.QALAMU_DB_PATH || path.join(dir, 'qalamu.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  username TEXT UNIQUE,
  gender TEXT CHECK (gender IN ('laki-laki','perempuan')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  recognized_text TEXT,
  corrected_text TEXT,
  feedback TEXT,
  score INTEGER,
  total_words INTEGER,
  correct_words INTEGER,
  mistakes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arabic TEXT NOT NULL,
  latin TEXT NOT NULL,
  translation TEXT NOT NULL,
  source TEXT
);
`);

// Migrasi: database lama belum punya kolom rincian hasil koreksi. Data lama tidak disentuh.
const correctionCols = db.prepare('PRAGMA table_info(corrections)').all().map((c) => c.name);
for (const [name, type] of [['total_words', 'INTEGER'], ['correct_words', 'INTEGER'], ['mistakes', 'TEXT']]) {
  if (!correctionCols.includes(name)) db.exec(`ALTER TABLE corrections ADD COLUMN ${name} ${type}`);
}

// Seed pengingat harian. Setiap ayat ditambahkan bila belum ada (dicek lewat kolom source),
// jadi database lama otomatis mendapat ayat baru tanpa duplikat.
const seedReminders = [
  [
    'لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا',
    "La yukallifullahu nafsan illa wus'aha.",
    'Allah tidak membebani seseorang melainkan sesuai dengan kesanggupannya.',
    'QS. Al-Baqarah: 286',
  ],
  [
    'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    "Fa inna ma'al 'usri yusra. Inna ma'al 'usri yusra.",
    'Maka sesungguhnya beserta kesulitan ada kemudahan. Sesungguhnya beserta kesulitan ada kemudahan.',
    'QS. Al-Insyirah: 5-6',
  ],
  [
    'وَقُل رَّبِّ زِدْنِي عِلْمًا',
    "Wa qur rabbi zidni 'ilma.",
    'Dan katakanlah, "Ya Tuhanku, tambahkanlah ilmu kepadaku."',
    'QS. Thaha: 114',
  ],
  [
    'أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ',
    "Ala bidzikrillahi tathma'innul qulub.",
    'Ingatlah, hanya dengan mengingat Allah hati menjadi tenteram.',
    "QS. Ar-Ra'd: 28",
  ],
  [
    'إِنَّ اللَّهَ مَعَ الصَّابِرِينَ',
    "Innallaha ma'ash-shabirin.",
    'Sesungguhnya Allah bersama orang-orang yang sabar.',
    'QS. Al-Baqarah: 153',
  ],
  [
    'اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ',
    "Iqra' bismi rabbikalladzi khalaq.",
    'Bacalah dengan (menyebut) nama Tuhanmu yang menciptakan.',
    "QS. Al-'Alaq: 1",
  ],
  [
    'يَرْفَعِ اللَّهُ الَّذِينَ آمَنُوا مِنكُمْ وَالَّذِينَ أُوتُوا الْعِلْمَ دَرَجَاتٍ',
    "Yarfa'illahulladzina amanu minkum wal-ladzina utul 'ilma darajat.",
    'Allah akan mengangkat orang-orang yang beriman di antara kamu dan orang-orang yang diberi ilmu beberapa derajat.',
    'QS. Al-Mujadilah: 11',
  ],
  [
    'فَاذْكُرُونِي أَذْكُرْكُمْ',
    'Fadzkuruni adzkurkum.',
    "Maka ingatlah kepada-Ku, niscaya Aku ingat (pula) kepadamu.",
    'QS. Al-Baqarah: 152',
  ],
];
const hasReminder = db.prepare('SELECT 1 FROM reminders WHERE source = ?');
const addReminder = db.prepare(
  'INSERT INTO reminders (arabic, latin, translation, source) VALUES (?,?,?,?)'
);
for (const r of seedReminders) {
  if (!hasReminder.get(r[3])) addReminder.run(...r);
}

module.exports = db;