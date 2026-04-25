require('dotenv').config();
const { Pool } = require('pg');

// DATABASE_URL автоматически выставляется Render при подключении Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── СОЗДАНИЕ ТАБЛИЦ ──
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                SERIAL PRIMARY KEY,
      name              TEXT NOT NULL,
      email             TEXT UNIQUE NOT NULL,
      password          TEXT NOT NULL,
      role              TEXT NOT NULL DEFAULT 'seeker',
      phone             TEXT,
      telegram_id       TEXT,
      telegram_username TEXT,
      link_code         TEXT,
      link_code_exp     BIGINT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id          SERIAL PRIMARY KEY,
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
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS applications (
      id         SERIAL PRIMARY KEY,
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message    TEXT,
      status     TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(job_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_type   ON jobs(type);
    CREATE INDEX IF NOT EXISTS idx_apps_job    ON applications(job_id);
    CREATE INDEX IF NOT EXISTS idx_apps_user   ON applications(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_tg    ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_users_link  ON users(link_code);
  `);
  console.log('✅ PostgreSQL подключён и таблицы созданы');
}

initDB().catch(err => {
  console.error('❌ Ошибка инициализации БД:', err.message);
  process.exit(1);
});

// Заменяет ? на $1,$2,... для pg
function toPositional(sql, params = []) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Async API совместимый с better-sqlite3 по смыслу
const db = {
  async all(sql, params = []) {
    const { rows } = await pool.query(toPositional(sql, params), params);
    return rows;
  },
  async get(sql, params = []) {
    const { rows } = await pool.query(toPositional(sql, params), params);
    return rows[0] || null;
  },
  async run(sql, params = []) {
    const isInsert = /^\s*INSERT/i.test(sql);
    const finalSql = isInsert
      ? toPositional(sql, params) + ' RETURNING id'
      : toPositional(sql, params);
    const { rows, rowCount } = await pool.query(finalSql, params);
    return { lastInsertRowid: isInsert ? rows[0]?.id : null, changes: rowCount };
  },
  async exec(sql) {
    await pool.query(sql);
  },
  pool,
};

module.exports = db;
