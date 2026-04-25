require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// На Render файловая система эфемерная — используем /tmp для SQLite
// Для продакшена рекомендуется PostgreSQL, но для старта SQLite в /tmp работает
const DB_PATH = process.env.DB_PATH || path.join('/tmp', 'mangystau.db');

// Убедимся, что директория существует
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Включаем WAL режим для скорости
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── СОЗДАНИЕ ТАБЛИЦ ──
db.exec(`
  -- Пользователи
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'seeker',
    phone       TEXT,
    telegram_id TEXT,
    telegram_username TEXT,
    link_code   TEXT,
    link_code_exp INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Вакансии
  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    company     TEXT NOT NULL,
    location    TEXT,
    salary      TEXT,
    type        TEXT DEFAULT 'Полная',
    schedule    TEXT,
    experience  TEXT DEFAULT 'Без опыта',
    skills      TEXT DEFAULT '[]',
    description TEXT,
    contact     TEXT,
    is_active   INTEGER DEFAULT 1,
    views       INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Отклики
  CREATE TABLE IF NOT EXISTS applications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT,
    status      TEXT DEFAULT 'pending',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, user_id)
  );

  -- Индексы
  CREATE INDEX IF NOT EXISTS idx_jobs_active    ON jobs(is_active, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_type      ON jobs(type);
  CREATE INDEX IF NOT EXISTS idx_apps_job       ON applications(job_id);
  CREATE INDEX IF NOT EXISTS idx_apps_user      ON applications(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_users_link     ON users(link_code);
`);

console.log('✅ База данных SQLite подключена:', DB_PATH);

module.exports = db;
