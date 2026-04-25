require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN === 'your_bot_token_here') {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN не задан. Telegram-уведомления отключены.');
  module.exports = { notifyNewApplication: async () => {}, notifyApplicationStatus: async () => {} };
  return;
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: { allowed_updates: ['message'], drop_pending_updates: true }
  }
});
console.log('🤖 Telegram бот запущен');

bot.on('polling_error', (err) => {
  if (err.code === 'ETELEGRAM' && err.message?.includes('Conflict')) {
    console.warn('⚠️ Telegram polling conflict — перезапуск через 10 сек...');
    bot.stopPolling().then(() => setTimeout(() => bot.startPolling(), 10000));
  } else {
    console.error('❌ Polling error:', err.code, err.message);
  }
});

// /start
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'Пользователь';
  bot.sendMessage(msg.chat.id,
    `👋 Привет, ${name}!\n\nЯ бот МангыстауРаботает — помогаю получать уведомления о работе.\n\n📌 Команды:\n/link <код> — привязать аккаунт с сайта\n/status — проверить привязку\n/jobs — последние 5 вакансий\n/help — помощь`
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🔧 Как привязать аккаунт:\n\n1. Зайди на сайт МангыстауРаботает\n2. Войди в профиль\n3. Нажми "Привязать Telegram"\n4. Скопируй одноразовый код\n5. Отправь боту: /link КОД`
  );
});

// /link <code>
bot.onText(/\/link (.+)/, async (msg, match) => {
  const code = match[1].trim();
  const chatId = String(msg.chat.id);
  const username = msg.from.username || null;

  try {
    const user = await db.get(
      'SELECT * FROM users WHERE link_code = ? AND link_code_exp > ?',
      [code, Date.now()]
    );
    if (!user) {
      return bot.sendMessage(chatId, '❌ Код не найден или истёк.\n\nПолучи новый код в профиле на сайте.');
    }
    await db.run(
      'UPDATE users SET telegram_id = ?, telegram_username = ?, link_code = NULL, link_code_exp = NULL WHERE id = ?',
      [chatId, username, user.id]
    );
    bot.sendMessage(chatId,
      `✅ Аккаунт привязан!\n\n👤 ${user.name}\n📧 ${user.email}\n\nТеперь ты будешь получать уведомления о:\n${user.role === 'employer' ? '• Новых откликах на вакансии' : '• Статусах твоих заявок'}`
    );
  } catch (e) {
    console.error('Link error:', e.message);
    bot.sendMessage(chatId, '❌ Ошибка сервера. Попробуй позже.');
  }
});

// /status
bot.onText(/\/status/, async (msg) => {
  const chatId = String(msg.chat.id);
  try {
    const user = await db.get('SELECT name, email, role FROM users WHERE telegram_id = ?', [chatId]);
    if (!user) return bot.sendMessage(chatId, '❌ Аккаунт не привязан.\nИспользуй /link КОД');
    bot.sendMessage(chatId,
      `✅ Привязан как: ${user.name}\n📧 ${user.email}\n🔰 Роль: ${user.role === 'employer' ? 'Работодатель' : 'Соискатель'}`
    );
  } catch (e) {
    bot.sendMessage(chatId, '❌ Ошибка. Попробуй позже.');
  }
});

// /jobs
bot.onText(/\/jobs/, async (msg) => {
  try {
    const jobs = await db.all(
      'SELECT title, company, salary, type, location FROM jobs WHERE is_active = 1 ORDER BY created_at DESC LIMIT 5',
      []
    );
    if (!jobs.length) return bot.sendMessage(msg.chat.id, 'Пока нет активных вакансий.');
    const text = jobs.map((j, i) =>
      `${i + 1}. *${j.title}* — ${j.company}\n   💰 ${j.salary || 'не указана'} | 📍 ${j.location || 'Актау'} | ${j.type}`
    ).join('\n\n');
    bot.sendMessage(msg.chat.id, `🔥 Последние вакансии:\n\n${text}`, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки вакансий.');
  }
});

// ── Уведомления ──
async function notifyNewApplication(employerTgId, data) {
  const { jobTitle, seekerName, seekerPhone, seekerTg, message } = data;
  let text = `🔔 *Новый отклик на вакансию!*\n\n📋 Вакансия: *${jobTitle}*\n👤 Кандидат: ${seekerName}\n`;
  if (seekerPhone) text += `📞 Телефон: ${seekerPhone}\n`;
  if (seekerTg)    text += `💬 Telegram: @${seekerTg}\n`;
  if (message)     text += `\n✉️ Сообщение: ${message}`;
  text += `\n\nОткройте сайт чтобы принять или отклонить заявку.`;
  return bot.sendMessage(employerTgId, text, { parse_mode: 'Markdown' });
}

async function notifyApplicationStatus(seekerTgId, data) {
  const { jobTitle, company, status, employerContact } = data;
  let text = status === 'accepted'
    ? `🎉 *Ваша заявка принята!*\n\n📋 Вакансия: *${jobTitle}*\n🏢 Компания: ${company}\n${employerContact ? `📞 Контакт: ${employerContact}\n` : ''}\nСвяжитесь с работодателем. Удачи!`
    : `😔 *По вашей заявке принято решение*\n\n📋 Вакансия: *${jobTitle}*\n🏢 Компания: ${company}\n\nК сожалению, не получилось. На сайте много других вакансий!`;
  return bot.sendMessage(seekerTgId, text, { parse_mode: 'Markdown' });
}

module.exports = { notifyNewApplication, notifyApplicationStatus, bot };
