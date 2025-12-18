# Food Analyst Bot

A Telegram-based AI assistant that analyzes uploaded food images and provides detailed nutritional information using Anthropic's Claude AI.

## Features

- 📸 Upload food images via Telegram
- 🤖 AI-powered nutritional analysis with Claude Vision
- 📊 Daily nutrition tracking and goal setting
- 🎯 Personalized nutrition goals
- 📅 Daily summaries at 11:59 PM
- 💬 Interactive commands for managing nutrition data
- 🔐 Secure handling of API keys and user data

## Commands

- `/start` - Start the bot and get welcome message
- `/help` - Display help information and available commands
- `/goals` - Set or update your daily nutrition goals
- `/summary` - Get your daily nutrition summary
- `/progress` - View your progress toward nutrition goals
- `/feedback` - Send feedback, bug reports, or suggestions

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with your API keys:
   ```
   TELEGRAM_TOKEN=your_telegram_bot_token
   ANTHROPIC_API_KEY=your_anthropic_api_key
   DEVELOPER_CHAT_ID=your_telegram_user_id
   ENCRYPTION_KEY=your_32_character_encryption_key_here
   ```
4. Run the bot: `npm start`

## Deployment

The bot can be deployed to cloud platforms like Zeabur for 24/7 operation.

## Technologies

- Node.js
- Telegraf.js (Telegram Bot API)
- Anthropic Claude AI API
- dotenv for environment management

## Author

Julian97

## License

MIT