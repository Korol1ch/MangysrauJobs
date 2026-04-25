const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

// Вспомогательная функция — создаём токен
function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ── POST /api/auth/register ──
// Тело: { name, email, password, role, phone? }
router.post('/register', (req, res) => {
  const { name, email, password, role, phone } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Имя, email и пароль обязательны' });
  }
  if (!['seeker', 'employer'].includes(role)) {
    return res.status(400).json({ error: 'role должен быть seeker или employer' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email уже зарегистрирован' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email.toLowerCase(), hash, role, phone || null);

  const user = db.prepare('SELECT id, name, email, role, phone FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: makeToken(user), user });
});

// ── POST /api/auth/login ──
// Тело: { email, password }
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Введите email и пароль' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const { password: _, ...safeUser } = user;
  res.json({ token: makeToken(safeUser), user: safeUser });
});

// ── GET /api/auth/me ── (получить свой профиль)
router.get('/me', authRequired, (req, res) => {
  const user = db.prepare(
    'SELECT id, name, email, role, phone, telegram_id, telegram_username, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(user);
});

// ── PUT /api/auth/me ── (обновить профиль)
router.put('/me', authRequired, (req, res) => {
  const { name, phone } = req.body;
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?')
    .run(name || req.user.name, phone || null, req.user.id);
  res.json({ message: 'Профиль обновлён' });
});

// ── POST /api/auth/link-telegram ──
// Связывает аккаунт с Telegram (вызывается из бота)
router.post('/link-telegram', authRequired, (req, res) => {
  const { telegram_id, telegram_username } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id обязателен' });

  db.prepare('UPDATE users SET telegram_id = ?, telegram_username = ? WHERE id = ?')
    .run(String(telegram_id), telegram_username || null, req.user.id);

  res.json({ message: 'Telegram привязан успешно' });
});

module.exports = router;
