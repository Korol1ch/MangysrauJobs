require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

// Если токен не задан — бот не запускается (но сервер работает)
if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN === 'your_bot_token_here') {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN не задан. Telegram-уведомления отключены.');
  module.exports = {
    notifyNewApplication: async () => {},
    notifyApplicationStatus: async () => {},
  };
  return;
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: {
      allowed_updates: ['message'],
      drop_pending_updates: true,
    }
  }
});
console.log('🤖 Telegram бот запущен');

// ── ОБРАБОТКА КОНФЛИКТА ──
// При деплое Render два инстанса могут работать одновременно ~30 сек
bot.on('polling_error', (err) => {
  if (err.code === 'ETELEGRAM' && err.message && err.message.includes('Conflict')) {
    console.warn('⚠️ Telegram polling conflict — старый инстанс ещё жив. Пересоздаём через 10 сек...');
    bot.stopPolling().then(() => {
      setTimeout(() => {
        bot.startPolling();
        console.log('🔄 Polling перезапущен');
      }, 10000);
    });
  } else {
    console.error('❌ Polling error:', err.code, err.message);
  }
});

// ════════════════════════════════════════
//  КОМАНДЫ БОТА
// ════════════════════════════════════════

// /start — приветствие
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'Пользователь';
  bot.sendMessage(msg.chat.id,
    `👋 Привет, ${name}!\n\n` +
    `Я бот МангыстауРаботает — помогаю получать уведомления о работе.\n\n` +
    `📌 Команды:\n` +
    `/link <токен> — привязать аккаунт с сайта\n` +
    `/status — проверить привязку\n` +
    `/jobs — последние 5 вакансий\n` +
    `/help — помощь`
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🔧 Как привязать аккаунт:\n\n` +
    `1. Зайди на сайт МангыстауРаботает\n` +
    `2. Войди в профиль\n` +
    `3. Нажми "Привязать Telegram"\n` +
    `4. Скопируй одноразовый код\n` +
    `5. Отправь боту: /link КОД\n\n` +
    `После привязки ты будешь получать уведомления об откликах и статусах заявок.`
  );
});

// /link <code> — привязка аккаунта через одноразовый код
bot.onText(/\/link (.+)/, (msg, match) => {
  const code = match[1].trim();
  const chatId = String(msg.chat.id);
  const username = msg.from.username || null;

  const user = db.prepare('SELECT * FROM users WHERE link_code = ? AND link_code_exp > ?')
    .get(code, Date.now());

  if (!user) {
    return bot.sendMessage(chatId,
      '❌ Код не найден или истёк.\n\nПолучи новый код в профиле на сайте.'
    );
  }

  db.prepare('UPDATE users SET telegram_id = ?, telegram_username = ?, link_code = NULL, link_code_exp = NULL WHERE id = ?')
    .run(chatId, username, user.id);

  bot.sendMessage(chatId,
    `✅ Аккаунт привязан!\n\n` +
    `👤 ${user.name}\n` +
    `📧 ${user.email}\n\n` +
    `Теперь ты будешь получать уведомления о:\n` +
    `${user.role === 'employer' ? '• Новых откликах на вакансии' : '• Статусах твоих заявок'}`
  );
});

// /status — проверить привязку
bot.onText(/\/status/, (msg) => {
  const chatId = String(msg.chat.id);
  const user = db.prepare('SELECT name, email, role FROM users WHERE telegram_id = ?').get(chatId);

  if (!user) {
    return bot.sendMessage(chatId, '❌ Аккаунт не привязан.\nИспользуй /link КОД');
  }
  bot.sendMessage(chatId,
    `✅ Привязан как: ${user.name}\n📧 ${user.email}\n🔰 Роль: ${user.role === 'employer' ? 'Работодатель' : 'Соискатель'}`
  );
});

// /jobs — список последних вакансий
bot.onText(/\/jobs/, (msg) => {
  const jobs = db.prepare(`
    SELECT title, company, salary, type, location FROM jobs
    WHERE is_active = 1 ORDER BY created_at DESC LIMIT 5
  `).all();

  if (!jobs.length) return bot.sendMessage(msg.chat.id, 'Пока нет активных вакансий.');

  const text = jobs.map((j, i) =>
    `${i + 1}. *${j.title}* — ${j.company}\n` +
    `   💰 ${j.salary || 'не указана'} | 📍 ${j.location || 'Актау'} | ${j.type}`
  ).join('\n\n');

  bot.sendMessage(msg.chat.id, `🔥 Последние вакансии:\n\n${text}`, { parse_mode: 'Markdown' });
});

// ════════════════════════════════════════
//  ФУНКЦИИ УВЕДОМЛЕНИЙ
// ════════════════════════════════════════

async function notifyNewApplication(employerTgId, data) {
  const { jobTitle, seekerName, seekerPhone, seekerTg, message } = data;

  let text = `🔔 *Новый отклик на вакансию!*\n\n`;
  text += `📋 Вакансия: *${jobTitle}*\n`;
  text += `👤 Кандидат: ${seekerName}\n`;
  if (seekerPhone) text += `📞 Телефон: ${seekerPhone}\n`;
  if (seekerTg)    text += `💬 Telegram: @${seekerTg}\n`;
  if (message)     text += `\n✉️ Сообщение: ${message}`;
  text += `\n\nОткройте сайт чтобы принять или отклонить заявку.`;

  return bot.sendMessage(employerTgId, text, { parse_mode: 'Markdown' });
}

async function notifyApplicationStatus(seekerTgId, data) {
  const { jobTitle, company, status, employerContact } = data;

  let text;
  if (status === 'accepted') {
    text = `🎉 *Ваша заявка принята!*\n\n`;
    text += `📋 Вакансия: *${jobTitle}*\n`;
    text += `🏢 Компания: ${company}\n`;
    if (employerContact) text += `📞 Контакт работодателя: ${employerContact}\n`;
    text += `\nСвяжитесь с работодателем для согласования деталей. Удачи!`;
  } else {
    text = `😔 *По вашей заявке принято решение*\n\n`;
    text += `📋 Вакансия: *${jobTitle}*\n`;
    text += `🏢 Компания: ${company}\n\n`;
    text += `К сожалению, на этот раз не получилось. Не расстраивайтесь — на сайте много других вакансий!`;
  }

  return bot.sendMessage(seekerTgId, text, { parse_mode: 'Markdown' });
}

module.exports = { notifyNewApplication, notifyApplicationStatus, bot };
