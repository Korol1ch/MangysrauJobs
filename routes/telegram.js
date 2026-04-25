const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

// ── POST /api/telegram/generate-code ──
router.post('/generate-code', authRequired, async (req, res) => {
  const code = crypto.randomInt(100000, 999999).toString();
  const exp = Date.now() + 10 * 60 * 1000;

  try {
    await db.run('UPDATE users SET link_code = ?, link_code_exp = ? WHERE id = ?',
      [code, exp, req.user.id]);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'your_bot';
    res.json({
      code, expires_in: 600,
      bot_link: `https://t.me/${botUsername}?start=link_${code}`,
      instruction: `Отправь боту команду: /link ${code}`
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/telegram/status ──
router.get('/status', authRequired, async (req, res) => {
  try {
    const user = await db.get('SELECT telegram_id, telegram_username FROM users WHERE id = ?', [req.user.id]);
    res.json({ linked: !!user?.telegram_id, telegram_username: user?.telegram_username });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE /api/telegram/unlink ──
router.delete('/unlink', authRequired, async (req, res) => {
  try {
    await db.run('UPDATE users SET telegram_id = NULL, telegram_username = NULL WHERE id = ?', [req.user.id]);
    res.json({ message: 'Telegram отвязан' });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
