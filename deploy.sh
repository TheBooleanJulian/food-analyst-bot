#!/bin/bash
# Deployment script for Food Analyst Bot on Zeabur

echo "🚀 Starting Food Analyst Bot deployment..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Verify environment variables
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "❌ ERROR: TELEGRAM_BOT_TOKEN is not set"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "❌ ERROR: ANTHROPIC_API_KEY is not set"
    exit 1
fi

if [ -z "$REDIS_URL" ]; then
    echo "❌ ERROR: REDIS_URL is not set"
    exit 1
fi

echo "✅ Environment variables verified"

# Start the bot
echo "🤖 Starting Food Analyst Bot..."
node zeabur-bot.js