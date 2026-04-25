const jwt = require('jsonwebtoken');
const db = require('../db');

// Обязательная авторизация
async function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Поддержка и SQLite (sync) и PostgreSQL (async)
    const user = await db.get('SELECT id, name, email, role FROM users WHERE id = ?', [payload.id]);
    if (!user) {
      return res.status(401).json({ error: 'Сессия устарела. Войдите снова.' });
    }
    req.user = { ...payload, ...user };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Токен недействителен или истёк' });
  }
}

// Необязательная авторизация (добавляет req.user если есть токен)
async function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      const user = await db.get('SELECT id, name, email, role FROM users WHERE id = ?', [payload.id]);
      if (user) req.user = { ...payload, ...user };
    } catch {}
  }
  next();
}

module.exports = { authRequired, authOptional };
