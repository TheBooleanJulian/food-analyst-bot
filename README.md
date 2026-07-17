<div align="center">

# Food Analyst Bot

**Telegram bot that analyzes food photos and tracks your nutrition — powered by Claude AI.**

![Node.js](https://img.shields.io/badge/-Node.js-339933?logo=node.js&logoColor=white)
![Telegram](https://img.shields.io/badge/-Telegram-26A5E4?logo=telegram&logoColor=white)
![Redis](https://img.shields.io/badge/-Redis-DC382D?logo=redis&logoColor=white)
![Claude AI](https://img.shields.io/badge/-Claude%20AI-D97706)
![Zeabur](https://img.shields.io/badge/-Zeabur-6C5CE7)
![License](https://img.shields.io/badge/license-MIT-00D4C8.svg)

</div>

---

## What it does

Food Analyst Bot is a Telegram bot for anyone who wants effortless nutrition tracking without manual logging. Send a photo of any meal and Claude's vision AI instantly breaks down calories, protein, carbs, fat, fiber, and hydration. It tracks your daily intake against personalised goals, scores your adherence (0–1000 points), and surfaces a live leaderboard so groups can stay accountable together. A companion web dashboard exposes health status and leaderboard data in the browser.

## Features

- 📸 Send a food photo — get an instant AI-powered nutritional breakdown
- 📊 Daily nutrition tracking against personalised goals (calories, protein, carbs, fat, fiber, hydration)
- 🎯 Goal setting via manual entry or AI-guided recommendations
- ⭐ Individual scoring system (0–1000 points) based on goal adherence
- 🏆 Live Redis-backed leaderboard with masked user names
- 📅 Automated daily summaries at 11:59 PM
- 🌐 Web dashboard for health monitoring and live leaderboard viewing
- 🔀 Webhook/polling fallback for resilient deployment
- 📣 Channel support — commands work when forwarded from Telegram channels

## Tech Stack

| Layer | Choice |
|---|---|
| Bot | node-telegram-bot-api (webhook + polling fallback) |
| Backend / Dashboard | Express.js |
| AI | Anthropic Claude API (Haiku with Sonnet fallback) |
| Storage | Redis |
| Hosting | Zeabur (GitHub CI/CD) |

## Quick Start

```bash
git clone https://github.com/TheBooleanJulian/food-analyst-bot
cd food-analyst-bot
npm install
cp .env.example .env
# Fill in .env, then:
node zeabur-bot.js        # bot
node server.js            # web dashboard
```

Or just message [@FoodAnalystBot](https://t.me/FoodAnalystBot) on Telegram — no setup required.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key from Anthropic |
| `REDIS_URL` | ✅ | Redis connection string for leaderboard and user data |
| `WEBHOOK_URL` | ☑️ | Public HTTPS URL for webhook mode (falls back to polling if unset) |
| `LEADERBOARD_CLEAR_SECRET` | ☑️ | Secret token for the secure leaderboard clear endpoint |

## Project Structure

```
food-analyst-bot/
|-- zeabur-bot.js          # Bot entry point (Zeabur / production)
|-- server.js              # Web dashboard server
|-- web/                   # Dashboard frontend
|-- data/                  # Local data utilities
|-- Dockerfile             # Bot container
|-- Dockerfile.web         # Web dashboard container
|-- zeabur.config.js       # Zeabur bot service config
|-- zeabur-web.config.json # Zeabur web service config
|-- deploy.sh              # Manual deploy helper
|-- requirements.txt       # Python bot-core dependency (optional tooling)
`-- package.json
```

## Deployment

Deployed on Zeabur via GitHub CI/CD. Two services are configured: the bot (`zeabur.config.js`) and the web dashboard (`zeabur-web.config.json`). Push to `master` triggers deploy. The bot runs webhook mode when `WEBHOOK_URL` is set, otherwise falls back to polling automatically.

## Status / Roadmap

- [x] AI food image analysis with Claude Vision
- [x] Daily nutrition tracking and personalised goals
- [x] Scoring system and Redis-backed leaderboard
- [x] Web dashboard with health status and live leaderboards
- [x] Webhook/polling fallback for resilient hosting
- [x] Channel post support
- [ ] Multi-meal history and weekly trend reports
- [ ] Photo-based goal progress visualisation

## Changelog

- **Jul 2026** — Added webhook/polling fallback for resilience; migrated leaderboard to Redis; added secure leaderboard clear endpoint; removed legacy bot.js
- **May 2026** — Switched primary model to Claude Haiku with Sonnet 4.6 as fallback; retired the old model reference
- **Apr 2026** — Reverted to polling after webhook migration issues; added Dockerfile to fix Zeabur build; fixed command handling in Telegram channels
- **Jan 2026** — Added web dashboard for health monitoring and live leaderboards; implemented Redis-backed scoring system (0–1000 pts); added fiber and hydration tracking; enhanced `/goals` with AI-guided and manual entry flows; fixed feedback listener stacking and various deployment issues
- **Dec 2025** — Fixed progress command errors; allowed nutrition progress to exceed 100%; resolved multiple syntax errors in goal loading and encryption setup

## License

MIT

---

<div align="center">
<sub>Built by <a href="https://github.com/TheBooleanJulian">@TheBooleanJulian</a></sub>
</div>