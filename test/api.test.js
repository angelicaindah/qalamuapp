const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const port = 3100 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qalamu-test-'));
let server;

// PNG 1x1 piksel
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function call(p, { method = 'GET', token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(base + p, { method, headers, body });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.arrayBuffer() };
}

async function register(name) {
  const r = await call('/api/auth/register', {
    method: 'POST',
    json: { name, email: `${name}@mail.com`, password: 'Rahasia123' },
  });
  assert.equal(r.status, 201);
  return r.body.token;
}

const photoForm = () => {
  const f = new FormData();
  f.append('image', new Blob([PNG], { type: 'image/png' }), 'tulisan.png');
  return f;
};

before(async () => {
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: 'rahasia-untuk-tes',
      ANTHROPIC_API_KEY: '', // paksa mode mock
      QALAMU_DB_PATH: path.join(tmp, 'test.db'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('berjalan') && resolve());
    server.on('exit', (c) => reject(new Error('server berhenti, kode ' + c)));
  });
});

after(async () => {
  // Tunggu server benar-benar berhenti: di Windows file SQLite masih terkunci sesaat setelah kill()
  await new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
  });
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // folder sementara di Temp; gagal dibersihkan tidak boleh menggagalkan tes
  }
});

test('registrasi menolak email tidak valid tanpa membocorkan error internal', async () => {
  const a = await call('/api/auth/register', { method: 'POST', json: { name: 'X', email: 'bukan-email', password: 'Rahasia123' } });
  assert.equal(a.status, 400);
  const b = await call('/api/auth/register', { method: 'POST', json: { name: 'X', email: 12345, password: 'Rahasia123' } });
  assert.equal(b.status, 400);
  assert.ok(!/toLowerCase/.test(b.body.message));
});

test('username dibatasi polanya dan unik tanpa peduli huruf besar/kecil', async () => {
  const t1 = await register('user1');
  const t2 = await register('user2');
  const bad = await call('/api/profile', { method: 'PUT', token: t1, json: { username: 'a b', gender: 'perempuan' } });
  assert.equal(bad.status, 400);
  const blank = await call('/api/profile', { method: 'PUT', token: t1, json: { username: '   ', gender: 'perempuan' } });
  assert.equal(blank.status, 400);
  const ok = await call('/api/profile', { method: 'PUT', token: t1, json: { username: 'Ali', gender: 'perempuan' } });
  assert.equal(ok.status, 200);
  const dup = await call('/api/profile', { method: 'PUT', token: t2, json: { username: 'ali', gender: 'laki-laki' } });
  assert.equal(dup.status, 409);
});

test('alamat /api yang tidak ada menjawab 404, JSON rusak menjawab 400 tanpa bocor', async () => {
  assert.equal((await call('/api/tidak-ada')).status, 404);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{rusak' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).message, 'Format JSON tidak valid');
});

test('pengingat harian tersedia', async () => {
  const t = await register('user3');
  const r = await call('/api/reminder/today', { token: t });
  assert.equal(r.status, 200);
  assert.ok(r.body.arabic && r.body.translation);
});

test('foto: hanya pemilik yang bisa membuka, nama file acak, dihapus bersama riwayat', async () => {
  const a = await register('pemilik');
  const b = await register('oranglain');

  const up = await call('/api/corrections', { method: 'POST', token: a, form: photoForm() });
  assert.equal(up.status, 201);
  assert.ok(up.body.score >= 0 && up.body.score <= 100);
  // rincian hasil koreksi (layar Hasil Koreksi)
  assert.equal(up.body.total_words, 5);
  assert.equal(up.body.correct_words, 4);
  assert.equal(up.body.mistakes.length, 1);
  assert.equal(up.body.mistakes[0].category, 'Harakat');
  const id = up.body.id;
  const imgPath = `/api/corrections/${id}/image`;
  assert.equal(up.body.image_url, imgPath);

  const detail = await call(`/api/corrections/${id}`, { token: a });
  assert.equal(detail.body.mistakes[0].category, 'Harakat'); // dibaca kembali sebagai array
  const list = await call('/api/corrections', { token: a });
  assert.equal(list.body[0].total_words, 5);
  assert.ok(Array.isArray(list.body[0].mistakes));
  const stored = path.join(root, 'uploads', detail.body.image_path);
  assert.match(detail.body.image_path, /^[0-9a-f-]{36}\.png$/);
  assert.ok(fs.existsSync(stored));

  assert.equal((await call(imgPath)).status, 401);                 // tanpa token
  assert.equal((await call(imgPath, { token: b })).status, 404);   // pengguna lain
  assert.equal((await call(`/api/corrections/${id}`, { token: b })).status, 404);
  assert.equal((await call(imgPath, { token: a })).status, 200);   // pemilik
  assert.equal((await call(`/uploads/${detail.body.image_path}`)).status, 404); // tidak lagi statis

  assert.equal((await call(`/api/corrections/${id}`, { method: 'DELETE', token: a })).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!fs.existsSync(stored), 'file foto harus ikut terhapus');
  assert.equal((await call(imgPath, { token: a })).status, 404);
});

test('upload menolak tipe file selain gambar dengan pesan yang aman', async () => {
  const t = await register('uploader');
  const f = new FormData();
  f.append('image', new Blob(['halo'], { type: 'text/plain' }), 'a.txt');
  const r = await call('/api/corrections', { method: 'POST', token: t, form: f });
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'Hanya JPG, PNG, atau WEBP');
});

test('login dibatasi setelah 10 percobaan gagal', async () => {
  await register('target');
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const r = await call('/api/auth/login', { method: 'POST', json: { email: 'target@mail.com', password: 'salah-salah' } });
    statuses.push(r.status);
  }
  assert.ok(statuses.slice(0, 10).every((s) => s === 401));
  assert.ok(statuses.slice(10).every((s) => s === 429));
});

test('laporan peningkatan: kosong untuk pengguna baru, terisi setelah koreksi, terpisah antar pengguna', async () => {
  const a = await register('laporan1');
  const b = await register('laporan2');

  const kosong = await call('/api/report', { token: a });
  assert.equal(kosong.status, 200);
  assert.equal(kosong.body.average_score, null);
  assert.deepEqual(kosong.body.categories.map((c) => c.name), ['Harakat', 'Bentuk Huruf', 'Sambung Huruf', 'Ejaan']);
  assert.ok(kosong.body.categories.every((c) => c.score === null));

  assert.equal((await call('/api/corrections', { method: 'POST', token: a, form: photoForm() })).status, 201);
  const isi = await call('/api/report', { token: a });
  assert.equal(isi.body.average_score, 80);
  assert.equal(isi.body.total_corrections, 1);
  const byName = Object.fromEntries(isi.body.categories.map((c) => [c.name, c.score]));
  assert.equal(byName['Harakat'], 80);   // 1 kesalahan dari 5 kata
  assert.equal(byName['Ejaan'], 100);

  assert.equal((await call('/api/report', { token: b })).body.average_score, null); // pengguna lain tidak ikut
  assert.equal((await call('/api/report')).status, 401);                            // wajib login
});

test('normalizeResult memvalidasi rincian kata dan kesalahan dari AI', () => {
  const { normalizeResult } = require('../src/services/correction');
  const base = { recognized_text: 'a', corrected_text: 'b', feedback: 'c', score: 90, total_words: 4, correct_words: 3 };
  const ok = normalizeResult({ ...base, correct_words: 9, mistakes: [{ wrong: 'x', correct: 'y', explanation: 'z', category: 'bentuk huruf' }, { wrong: 'p', correct: 'q', explanation: 'r', category: 'tidak dikenal' }] });
  assert.equal(ok.correct_words, 4);                       // dibatasi total_words
  assert.equal(ok.mistakes[0].category, 'Bentuk Huruf');   // cocok tanpa peduli huruf besar/kecil
  assert.equal(ok.mistakes[1].category, 'Ejaan');          // kategori asing -> Ejaan
  assert.throws(() => normalizeResult({ ...base, mistakes: 'bukan array' }));
  assert.throws(() => normalizeResult({ ...base, mistakes: [{ wrong: 'x' }] }));
  assert.throws(() => normalizeResult({ ...base, total_words: -1, mistakes: [] }));
  assert.throws(() => normalizeResult({ recognized_text: 'a', corrected_text: 'b', feedback: 'c', score: 5, mistakes: [] }));
});

test('kata sandi baru wajib minimal 8 karakter, ada 1 huruf besar dan 1 angka', async () => {
  const daftar = (password, i) => call('/api/auth/register', { method: 'POST', json: { name: 'S', email: `sandi${i}@mail.com`, password } });
  for (const [i, lemah] of ['Ab1', 'abcdefg1', 'ABCDEFGH', 'Abcdefgh', 'abcdefgh1', '12345678'].entries()) {
    const r = await daftar(lemah, i);
    assert.equal(r.status, 400, `harus ditolak: ${lemah}`);
    assert.match(r.body.message, /minimal 8 karakter/);
  }
  assert.equal((await daftar('Abcdefg1', 90)).status, 201);   // tepat 8 karakter, memenuhi aturan
  assert.equal((await daftar('sandi-Panjang-2026', 91)).status, 201);
});
