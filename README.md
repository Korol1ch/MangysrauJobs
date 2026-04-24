# МангыстауРаботает — Backend

## 🚀 Деплой на Render (5 минут)

### 1. Залей проект на GitHub
```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/ТВО_ИМЯАККАУНТА/MangystauJobs.git
git push -u origin main
```

### 2. Создай сервис на Render
1. Зайди на [render.com](https://render.com) → **New → Web Service**
2. Подключи свой GitHub репозиторий
3. Render автоматически найдёт `render.yaml` и заполнит настройки
4. Нажми **Deploy**

### 3. Добавь переменные окружения
После деплоя зайди в **Dashboard → твой сервис → Environment**:

| Ключ | Значение |
|------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather |
| `ALLOWED_ORIGINS` | URL фронтенда (напр. `https://yoursite.kz`) |

`JWT_SECRET` Render сгенерирует сам автоматически ✅

### 4. Проверь что работает
```
https://ТВО_ИМЯАПП.onrender.com/api/health
```
Должен вернуть: `{ "status": "ok", ... }`

---

## ⚠️ Важно про базу данных

Проект использует **SQLite** в папке `/tmp`. На Render бесплатном плане:
- Данные **сбрасываются** при каждом рестарте сервера (примерно каждые 15 минут при неактивности)
- Для сохранения данных используй **PostgreSQL** (Render даёт бесплатно 1 БД)

Когда будешь готов перейти на PostgreSQL — скажи, помогу мигрировать.

---

## 🛠 Локальная разработка

```bash
# Установка
npm install

# Настройка .env
cp .env.example .env
# Открой .env и заполни JWT_SECRET и TELEGRAM_BOT_TOKEN

# Запуск
npm run dev   # с авто-перезапуском
npm start     # обычный
```

Сервер: `http://localhost:3001`
Health: `http://localhost:3001/api/health`

---

## 📡 API Endpoints

### Авторизация
| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Вход |
| GET  | `/api/auth/me` | Мой профиль |
| PUT  | `/api/auth/me` | Обновить профиль |

### Вакансии
| Метод | URL | Описание |
|-------|-----|----------|
| GET   | `/api/jobs` | Список / поиск |
| GET   | `/api/jobs/:id` | Одна вакансия |
| POST  | `/api/jobs` | Создать (employer) |
| PUT   | `/api/jobs/:id` | Редактировать |
| DELETE| `/api/jobs/:id` | Удалить |
| GET   | `/api/jobs/my/list` | Мои вакансии |
| POST  | `/api/jobs/:id/apply` | Откликнуться |
| GET   | `/api/jobs/my/applications` | Мои отклики |
| GET   | `/api/jobs/:id/applications` | Отклики на вакансию |
| PATCH | `/api/jobs/:jobId/applications/:appId` | Принять/отклонить |

### Telegram
| Метод | URL | Описание |
|-------|-----|----------|
| POST  | `/api/telegram/generate-code` | Код привязки |
| GET   | `/api/telegram/status` | Статус привязки |
| DELETE| `/api/telegram/unlink` | Отвязать |

---

## 🗂 Структура проекта
```
├── server.js           # Express сервер
├── db.js               # SQLite, схема таблиц
├── bot.js              # Telegram бот
├── render.yaml         # Конфиг для Render
├── .env.example        # Пример переменных окружения
├── .gitignore          # Игнорируемые файлы
├── index.html          # Фронтенд (отдаётся как статика)
├── middleware/
│   └── auth.js         # JWT middleware
└── routes/
    ├── auth.js         # Регистрация, вход, профиль
    ├── jobs.js         # Вакансии, отклики
    └── telegram.js     # Коды привязки бота
```
