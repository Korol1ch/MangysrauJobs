const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ── POST /api/auth/register ──
router.post('/register', async (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Имя, email и пароль обязательны' });
  if (!['seeker', 'employer'].includes(role))
    return res.status(400).json({ error: 'role должен быть seeker или employer' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });

  try {
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run(
      'INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)',
      [name, email.toLowerCase(), hash, role, phone || null]
    );
    const user = await db.get(
      'SELECT id, name, email, role, phone FROM users WHERE id = ?',
      [result.lastInsertRowid]
    );
    res.status(201).json({ token: makeToken(user), user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/auth/login ──
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Введите email и пароль' });

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Неверный email или пароль' });

    const { password: _, ...safeUser } = user;
    res.json({ token: makeToken(safeUser), user: safeUser });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/auth/me ──
router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, name, email, role, phone, telegram_id, telegram_username, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PUT /api/auth/me ──
router.put('/me', authRequired, async (req, res) => {
  const { name, phone } = req.body;
  try {
    await db.run('UPDATE users SET name = ?, phone = ? WHERE id = ?',
      [name || req.user.name, phone || null, req.user.id]);
    res.json({ message: 'Профиль обновлён' });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/auth/link-telegram ──
router.post('/link-telegram', authRequired, async (req, res) => {
  const { telegram_id, telegram_username } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id обязателен' });
  try {
    await db.run('UPDATE users SET telegram_id = ?, telegram_username = ? WHERE id = ?',
      [String(telegram_id), telegram_username || null, req.user.id]);
    res.json({ message: 'Telegram привязан успешно' });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
