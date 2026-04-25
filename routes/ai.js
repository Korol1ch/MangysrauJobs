const router = require('express').Router();
const { authOptional } = require('../middleware/auth');

function getApiKey() {
  return process.env.GEMINI_API_KEY || '';
}

async function callGemini(systemPrompt, userPrompt, maxTokens = 500) {
  const key = getApiKey();
  if (!key) throw new Error('GEMINI_API_KEY не настроен на сервере — добавьте в Render → Environment');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Gemini API error ${res.status}`);
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Health check ──
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    hasApiKey: !!getApiKey(),
    message: getApiKey() ? 'GEMINI_API_KEY задан ✅' : 'GEMINI_API_KEY не задан ❌ — добавьте в Render → Environment'
  });
});

// ── POST /api/ai/filter ──
router.post('/filter', authOptional, async (req, res) => {
  const { profile, jobs } = req.body;

  if (!jobs || !jobs.length)
    return res.status(400).json({ error: 'Список вакансий пуст' });
  if (!profile || (!profile.desired && !profile.skills && !profile.expLevel))
    return res.status(400).json({ error: 'Заполните профиль соискателя (желаемая должность, навыки или опыт)' });

  const profileDesc = [
    profile.desired   ? `Желаемая профессия: ${profile.desired}` : '',
    profile.salaryMin ? `Желаемая зарплата: от ${profile.salaryMin}` : '',
    profile.schedule  ? `График: ${profile.schedule}` : '',
    profile.type      ? `Занятость: ${profile.type}` : '',
    profile.skills    ? `Навыки: ${profile.skills}` : '',
    profile.expLevel  ? `Опыт: ${profile.expLevel}` : '',
    profile.education ? `Образование: ${profile.education}` : '',
    profile.about     ? `Дополнительно: ${profile.about}` : '',
  ].filter(Boolean).join('\n');

  const jobList = jobs.map((j, i) =>
    `${i}: ${j.title} — ${j.company}. Зарплата: ${j.salary || 'не указана'}. Тип: ${j.type || ''}. График: ${j.schedule || ''}. Опыт: ${j.experience || ''}. ${j.description || ''}`
  ).join('\n');

  try {
    const raw = await callGemini(
      'Ты помогаешь искать работу в Мангистау, Казахстан. Анализируй профиль соискателя и список вакансий. Отвечай ТОЛЬКО в формате JSON объекта: {"indices": [0,2,5], "reason": "краткое объяснение на русском до 60 слов"}. Без markdown, только JSON.',
      `Профиль соискателя:\n${profileDesc}\n\nВакансии:\n${jobList}\n\nВерни JSON с индексами подходящих вакансий и кратким объяснением.`,
      500
    );
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    res.json({ indices: result.indices || [], reason: result.reason || '' });
  } catch (e) {
    console.error('AI /filter error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/generate-desc ──
router.post('/generate-desc', authOptional, async (req, res) => {
  const { title, company, salary } = req.body;
  if (!title) return res.status(400).json({ error: 'Название должности обязательно' });
  try {
    const text = await callGemini(
      'Ты помогаешь работодателям в Мангистау (Казахстан) составлять описания вакансий. Отвечай только на русском. Пиши кратко — 2-3 предложения.',
      `Напиши описание вакансии: "${title}" в "${company || 'компании'}", зарплата: ${salary || 'обсуждается'}.`,
      500
    );
    res.json({ text });
  } catch (e) {
    console.error('AI /generate-desc error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/analyze-profile ──
router.post('/analyze-profile', authOptional, async (req, res) => {
  const { skills, expLevel, desired } = req.body;
  try {
    const raw = await callGemini(
      'Ты карьерный консультант для рынка труда Мангистау (Казахстан). Отвечай ТОЛЬКО в формате JSON без markdown и без пояснений. Поля: tips (массив 3 строки), topJobs (массив 3 строки), salaryRange (строка в тенге).',
      `Профиль: навыки: ${skills || '—'}, опыт: ${expLevel || '—'}, желаемая работа: ${desired || '—'}. Верни JSON.`,
      800
    );
    const clean = raw.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(clean));
  } catch (e) {
    console.error('AI /analyze-profile error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
