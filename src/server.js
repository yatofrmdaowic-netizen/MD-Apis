import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const appDomain = normalizeDomain(process.env.APP_DOMAIN || `http://localhost:${port}`);
const apiKeyHeader = (process.env.API_KEY_HEADER || 'x-api-key').toLowerCase();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

const freeApiKeys = parseKeys(process.env.FREE_API_KEYS || 'free-demo-key');
const paidApiKeys = parseKeys(process.env.PAID_API_KEYS || 'paid-demo-key');
const adminApiKeys = parseKeys(process.env.ADMIN_API_KEYS || process.env.PAID_API_KEYS || 'paid-demo-key');
const freePerHourLimit = Number(process.env.FREE_PER_HOUR_LIMIT || 30);

const usageStore = new Map();
const freeAllowedFeatures = new Set(['send-text', 'education', 'anime', 'sports']);

function normalizeDomain(value) {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function parseKeys(value) {
  return new Set(
    value
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
  );
}

function getUpgradeUrl() {
  return process.env.UPGRADE_URL || `${appDomain}/upgrade`;
}

function getApiKey(req) {
  return req.header(apiKeyHeader) || req.header('x-api-key') || req.header('x-apikey');
}

function getTierFromApiKey(apiKey) {
  if (paidApiKeys.has(apiKey)) return 'paid';
  if (freeApiKeys.has(apiKey)) return 'free';
  return null;
}

function authAndPlan(req, res, next) {
  const apiKey = getApiKey(req);

  if (!apiKey) {
    return res.status(401).json({ error: `Missing API key header. Use '${apiKeyHeader}'` });
  }

  const tier = getTierFromApiKey(apiKey);
  if (!tier) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  req.client = { apiKey, tier };
  next();
}

function requireAdmin(req, res, next) {
  const apiKey = getApiKey(req);
  if (!apiKey || !adminApiKeys.has(apiKey)) {
    return res.status(403).json({ error: 'Admin API key required' });
  }

  next();
}

function freeRateLimit(req, res, next) {
  if (req.client.tier !== 'free') {
    return next();
  }

  const key = req.client.apiKey;
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const current = usageStore.get(key);

  if (!current || now - current.windowStart >= oneHour) {
    usageStore.set(key, { windowStart: now, count: 1 });
    return next();
  }

  if (current.count >= freePerHourLimit) {
    return res.status(429).json({
      error: 'Free plan rate limit reached',
      limit: freePerHourLimit,
      window: '1 hour',
      upgradeUrl: getUpgradeUrl()
    });
  }

  current.count += 1;
  usageStore.set(key, current);
  next();
}

function enforceFeatureAccess(feature) {
  return (req, res, next) => {
    if (req.client.tier === 'paid') {
      return next();
    }

    if (!freeAllowedFeatures.has(feature)) {
      return res.status(402).json({
        error: `Feature '${feature}' is available on paid plan only`,
        upgradeUrl: getUpgradeUrl()
      });
    }

    next();
  };
}

function featureGuard(feature, handler) {
  return (req, res) => {
    const guard = enforceFeatureAccess(feature);
    guard(req, res, () => handler(req, res));
  };
}

const featureCatalog = {
  download: {
    endpoint: '/api/features/download',
    methods: ['POST'],
    description: 'Video/audio/file metadata fetch and queue response.'
  },
  stalker: {
    endpoint: '/api/features/stalker',
    methods: ['POST'],
    description: 'Username/account intelligence profile simulation (paid).' 
  },
  education: {
    endpoint: '/api/features/education',
    methods: ['POST'],
    description: 'Quiz generation and educational explanation.'
  },
  group: {
    endpoint: '/api/features/group',
    methods: ['POST'],
    description: 'Group helper actions and moderation recommendations.'
  },
  anime: {
    endpoint: '/api/features/anime',
    methods: ['GET'],
    description: 'Trending anime and recommendations.'
  },
  economy: {
    endpoint: '/api/features/economy',
    methods: ['GET'],
    description: 'Simple market and currency snapshots.'
  },
  sports: {
    endpoint: '/api/features/sports',
    methods: ['GET'],
    description: 'Fixtures, live-style score simulation, and table summary.'
  },
  ai: {
    endpoint: '/api/features/ai',
    methods: ['POST'],
    description: 'Prompt-to-answer utility endpoint.'
  }
};

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'MD APIs',
    domain: appDomain,
    apiKeyHeader,
    channels: ['whatsapp', 'telegram'],
    tiers: {
      free: {
        rateLimitPerHour: freePerHourLimit,
        features: ['send-text', 'education', 'anime', 'sports']
      },
      paid: {
        rateLimitPerHour: 'custom',
        features: [
          'send-text',
          'send-media',
          'advanced-routing',
          'download',
          'stalker',
          'education',
          'group',
          'anime',
          'economy',
          'sports',
          'ai'
        ]
      }
    },
    featureCatalog
  });
});

app.post('/api/keys/generate', requireAdmin, (req, res) => {
  const tier = req.body?.tier === 'paid' ? 'paid' : 'free';
  const label = (req.body?.label || 'client').replace(/\s+/g, '-').toLowerCase();
  const token = `${tier}_${label}_${crypto.randomBytes(16).toString('hex')}`;

  if (tier === 'paid') {
    paidApiKeys.add(token);
  } else {
    freeApiKeys.add(token);
  }

  res.status(201).json({
    message: 'API key generated. Save it securely.',
    tier,
    apiKey: token,
    header: apiKeyHeader
  });
});

app.post('/api/whatsapp/send-message', authAndPlan, freeRateLimit, async (req, res) => {
  const { to, text, mediaUrl } = req.body;

  if (!to) {
    return res.status(400).json({ error: 'Field "to" is required' });
  }

  const feature = mediaUrl ? 'send-media' : 'send-text';
  const handler = enforceFeatureAccess(feature);
  handler(req, res, async () => {
    try {
      const result = await sendWhatsAppMessage({ to, text, mediaUrl });
      res.status(200).json({ provider: 'whatsapp', tier: req.client.tier, feature, result });
    } catch (error) {
      res.status(502).json({ error: 'WhatsApp provider error', details: error.message });
    }
  });
});

app.post('/api/telegram/send-message', authAndPlan, freeRateLimit, async (req, res) => {
  const { chatId, text, mediaUrl } = req.body;

  if (!chatId) {
    return res.status(400).json({ error: 'Field "chatId" is required' });
  }

  const feature = mediaUrl ? 'send-media' : 'send-text';
  const handler = enforceFeatureAccess(feature);
  handler(req, res, async () => {
    try {
      const result = await sendTelegramMessage({ chatId, text, mediaUrl });
      res.status(200).json({ provider: 'telegram', tier: req.client.tier, feature, result });
    } catch (error) {
      res.status(502).json({ error: 'Telegram provider error', details: error.message });
    }
  });
});

app.post(
  '/api/features/download',
  authAndPlan,
  freeRateLimit,
  featureGuard('download', (req, res) => {
    const { url, quality = '720p', format = 'mp4' } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Field "url" is required' });
    }

    return res.json({
      feature: 'download',
      tier: req.client.tier,
      status: 'queued',
      request: { url, quality, format },
      taskId: crypto.randomUUID()
    });
  })
);

app.post(
  '/api/features/stalker',
  authAndPlan,
  freeRateLimit,
  featureGuard('stalker', (req, res) => {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Field "username" is required' });
    }

    return res.json({
      feature: 'stalker',
      tier: req.client.tier,
      profile: {
        username,
        confidence: 0.82,
        activityBand: 'medium',
        riskFlags: ['public-scrape-signal']
      },
      disclaimer: 'Use only with lawful consent and local regulations.'
    });
  })
);

app.post(
  '/api/features/education',
  authAndPlan,
  freeRateLimit,
  featureGuard('education', (req, res) => {
    const { topic = 'mathematics', level = 'beginner' } = req.body;

    return res.json({
      feature: 'education',
      tier: req.client.tier,
      lesson: {
        topic,
        level,
        summary: `Core concepts for ${topic} at ${level} level.`,
        quiz: [
          { question: `What is a key principle in ${topic}?`, type: 'short_answer' },
          { question: `Name one practical use of ${topic}.`, type: 'short_answer' }
        ]
      }
    });
  })
);

app.post(
  '/api/features/group',
  authAndPlan,
  freeRateLimit,
  featureGuard('group', (req, res) => {
    const { groupName = 'community', action = 'summary' } = req.body;

    return res.json({
      feature: 'group',
      tier: req.client.tier,
      groupName,
      action,
      output: {
        moderationTips: ['Pin group rules', 'Enable anti-spam delay', 'Use welcome template'],
        engagementIdea: 'Run weekly Q&A with badges for top contributors.'
      }
    });
  })
);

app.get(
  '/api/features/anime',
  authAndPlan,
  freeRateLimit,
  featureGuard('anime', (req, res) => {
    return res.json({
      feature: 'anime',
      tier: req.client.tier,
      trending: [
        { title: 'Solo Leveling', score: 8.6 },
        { title: 'Jujutsu Kaisen', score: 8.7 },
        { title: 'Frieren', score: 8.9 }
      ]
    });
  })
);

app.get(
  '/api/features/economy',
  authAndPlan,
  freeRateLimit,
  featureGuard('economy', (req, res) => {
    return res.json({
      feature: 'economy',
      tier: req.client.tier,
      snapshot: {
        inflationSignal: 'cooling',
        fx: { USDNGN: 1520.4, EURUSD: 1.08 },
        commodities: { gold: 2320.12, brent: 83.6 }
      }
    });
  })
);

app.get(
  '/api/features/sports',
  authAndPlan,
  freeRateLimit,
  featureGuard('sports', (req, res) => {
    return res.json({
      feature: 'sports',
      tier: req.client.tier,
      fixtures: [
        { home: 'Team A', away: 'Team B', kickoffUtc: '2026-02-19T17:00:00Z' },
        { home: 'Team C', away: 'Team D', kickoffUtc: '2026-02-19T20:00:00Z' }
      ]
    });
  })
);

app.post(
  '/api/features/ai',
  authAndPlan,
  freeRateLimit,
  featureGuard('ai', (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Field "prompt" is required' });
    }

    return res.json({
      feature: 'ai',
      tier: req.client.tier,
      response: `AI assistant result: ${prompt.slice(0, 200)}`,
      model: 'simulation-v1'
    });
  })
);

async function sendWhatsAppMessage({ to, text, mediaUrl }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    return {
      simulated: true,
      message: 'WhatsApp credentials are not configured. Message accepted in simulation mode.',
      to,
      text,
      mediaUrl
    };
  }

  const endpoint = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const payload = mediaUrl
    ? { messaging_product: 'whatsapp', to, type: 'image', image: { link: mediaUrl, caption: text || '' } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text || '' } };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Unknown WhatsApp error');
  }

  return data;
}

async function sendTelegramMessage({ chatId, text, mediaUrl }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return {
      simulated: true,
      message: 'Telegram bot token is not configured. Message accepted in simulation mode.',
      chatId,
      text,
      mediaUrl
    };
  }

  const endpoint = mediaUrl
    ? `https://api.telegram.org/bot${botToken}/sendPhoto`
    : `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload = mediaUrl ? { chat_id: chatId, photo: mediaUrl, caption: text || '' } : { chat_id: chatId, text: text || '' };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || 'Unknown Telegram error');
  }

  return data;
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`MD APIs listening on ${appDomain}`);
  console.log(`Use API key header: ${apiKeyHeader}`);
});
