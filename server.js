require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// ── CORS ──
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Всегда разрешаем localhost для разработки
const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'https://korol1ch.github.io',
];

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без origin (Postman, curl, мобильные)
    if (!origin) return callback(null, true);
    const allAllowed = [...defaultOrigins, ...allowedOrigins];
    if (allAllowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: ${origin} не разрешён`));
  },
  credentials: true,
}));

app.use(express.json());

// ── СТАТИКА (фронтенд) ──
// Если index.html лежит в корне проекта — отдаём его
app.use(express.static(path.join(__dirname)));

// ── МАРШРУТЫ ──
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/jobs',     require('./routes/jobs'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/ai',       require('./routes/ai'));

// ── HEALTH CHECK ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', platform: 'МангыстауРаботает', time: new Date().toISOString() });
});

// ── SPA fallback: всё что не /api → index.html ──
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// ── TELEGRAM БОТ (инициализируем один раз) ──
// bot.js уже подключается через routes/jobs.js и routes/telegram.js
// Явный require здесь нужен только чтобы гарантировать запуск если routes не загрузились
require('./bot');

// ── ОБРАБОТКА ОШИБОК ──
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ── СТАРТ ──
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 МангыстауРаботает API запущен на порту ${PORT}`);
  console.log(`📡 Health check: /api/health\n`);
});
