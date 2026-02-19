# MD-Apis

Multi-device messaging API service for **WhatsApp** and **Telegram** with:
- Your own domain and API-key header
- Free and paid plan logic
- Extra utility feature APIs: download, stalker, education, group, anime, economy, sports, and ai

## Quick start

```bash
npm install
cp .env.example .env
npm start
```

## Configure your domain and keys

```bash
APP_DOMAIN=https://api.yourdomain.com
API_KEY_HEADER=x-api-key

FREE_API_KEYS=free-my-client-1,free-my-client-2
PAID_API_KEYS=paid-my-client-1
ADMIN_API_KEYS=paid-my-client-1
```

## Core endpoints

- `GET /api/health`
- `POST /api/keys/generate` (admin key required)
- `POST /api/whatsapp/send-message`
- `POST /api/telegram/send-message`

## Feature endpoints

All endpoints require your API key header.

- `POST /api/features/download` (paid)
  - body: `{ "url": "https://...", "quality": "720p", "format": "mp4" }`
- `POST /api/features/stalker` (paid)
  - body: `{ "username": "target_user" }`
- `POST /api/features/education` (free + paid)
  - body: `{ "topic": "algebra", "level": "beginner" }`
- `POST /api/features/group` (paid)
  - body: `{ "groupName": "my-group", "action": "summary" }`
- `GET /api/features/anime` (free + paid)
- `GET /api/features/economy` (paid)
- `GET /api/features/sports` (free + paid)
- `POST /api/features/ai` (paid)
  - body: `{ "prompt": "Explain compound interest" }`

## Plans

### Free
- `send-text`, `education`, `anime`, `sports`
- hourly request limit via `FREE_PER_HOUR_LIMIT`

### Paid
- all free features plus: `send-media`, `download`, `stalker`, `group`, `economy`, `ai`, `advanced-routing`

## Notes

- Current feature APIs return safe structured responses suitable for app integration.
- For production, move in-memory key/rate storage to database or Redis.
- Add billing provider (Stripe/Paystack/Flutterwave) to automate upgrades.
