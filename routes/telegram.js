const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

// Добавляем колонки для link_code если их нет (миграция)
try {
  db.exec(`ALTER TABLE users ADD COLUMN link_code TEXT`);
  db.exec(`ALTER TABLE users ADD COLUMN link_code_exp INTEGER`);
} catch {} // Уже есть — игнорируем

// ── POST /api/telegram/generate-code ──
// Генерирует одноразовый 6-значный код для привязки бота
router.post('/generate-code', authRequired, (req, res) => {
  const code = crypto.randomInt(100000, 999999).toString();
  const exp = Date.now() + 10 * 60 * 1000; // истекает через 10 минут

  db.prepare('UPDATE users SET link_code = ?, link_code_exp = ? WHERE id = ?')
    .run(code, exp, req.user.id);

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'your_bot';

  res.json({
    code,
    expires_in: 600, // секунды
    bot_link: `https://t.me/${botUsername}?start=link_${code}`,
    instruction: `Отправь боту команду: /link ${code}`
  });
});

// ── GET /api/telegram/status ──
router.get('/status', authRequired, (req, res) => {
  const user = db.prepare('SELECT telegram_id, telegram_username FROM users WHERE id = ?').get(req.user.id);
  res.json({
    linked: !!user.telegram_id,
    telegram_username: user.telegram_username
  });
});

// ── DELETE /api/telegram/unlink ──
router.delete('/unlink', authRequired, (req, res) => {
  db.prepare('UPDATE users SET telegram_id = NULL, telegram_username = NULL WHERE id = ?').run(req.user.id);
  res.json({ message: 'Telegram отвязан' });
});

module.exports = router;
