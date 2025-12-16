# Food Analyst Bot

A Telegram bot that analyzes food images and provides nutritional information using Claude AI.

## Features
- Analyzes food images sent in Telegram channels or direct messages
- Provides nutritional estimates including calories, protein, carbs, and fat
- Powered by Anthropic's Claude Sonnet model

## Setup

1. Create a `.env` file with your credentials:
   ```
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   ANTHROPIC_API_KEY=your_anthropic_api_key
   CHAT_ID=your_target_chat_id
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the bot:
   ```bash
   node bot.js
   ```

## Deployment
This bot can be deployed to cloud platforms like Zeabur for continuous operation.