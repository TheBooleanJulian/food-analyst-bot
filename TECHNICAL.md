# Food Analyst Bot - Technical Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Data Storage](#data-storage)
5. [API Integrations](#api-integrations)
6. [Core Components](#core-components)
7. [Web Dashboard](#web-dashboard)
8. [Deployment](#deployment)
9. [Zeabur Deployment Specifics](#zeabur-deployment-specifics)
10. [Security](#security)
11. [Development Guidelines](#development-guidelines)

## Architecture Overview

The Food Analyst Bot is a Node.js application that integrates with Telegram and Anthropic's Claude AI to analyze food images and provide nutritional information. The system follows a microservices-like architecture with Redis for data persistence and Zeabur for deployment.

```
┌─────────────────┐    ┌──────────────┐    ┌──────────────┐
│   Telegram      │◄──►│ Food Analyst │◄──►│   Redis      │
│     Bot         │    │     Bot      │    │   Database   │
└─────────────────┘    └──────────────┘    └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Claude AI    │
                       │   Vision     │
                       └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Web Dashboard│
                       │   (Health &  │
                       │ Leaderboard) │
                       └──────────────┘
```

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Vanilla Node.js with Express-style patterns
- **Telegram Integration**: node-telegram-bot-api
- **AI Processing**: @anthropic-ai/sdk
- **Data Storage**: Redis
- **Scheduling**: node-cron
- **Configuration**: dotenv
- **Web Framework**: Express.js
- **HTTP Client**: Axios
- **Deployment**: Zeabur

## Project Structure

```
food-analyst-bot/
├── bot.js              # Main application file
├── server.js           # Web dashboard server
├── web/
│   └── index.html      # Web dashboard frontend
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variable template
├── .gitignore          # Git ignore rules
├── zeabur.config.js    # Zeabur deployment configuration
├── zeabur-web.config.json # Web dashboard deployment config
├── Dockerfile.web      # Web dashboard Docker configuration
├── WEB_DASHBOARD.md    # Web dashboard documentation
├── TECHNICAL.md        # Technical documentation (this file)
└── USER_GUIDE.md       # User guide
```

## Data Storage

### Redis Keys

1. **`users`**: Stores user information with encrypted personal data
   - Telegram User ID as key
   - Encrypted: firstName, lastName, username, fullName
   - Unencrypted: lastSeen timestamp

2. **`nutrition_data`**: Stores all nutrition entries
   - Organized by chat ID and date
   - Contains food entries with nutritional information

3. **`goals`**: Stores user nutrition goals
   - Daily targets for calories, protein, carbs, fat, fiber, and hydration

4. **`message_associations`**: Maps bot messages to nutrition data
   - Enables reply-based correction feature
   - Links message IDs to original nutrition data

5. **`leaderboard_cache`**: Stores cached leaderboard data
   - Cached results for improved performance
   - Expires every 5 minutes

### Encryption

Sensitive user data is encrypted using AES-256-CBC:
- **Encryption Key**: 32-character key from `ENCRYPTION_KEY` env var or auto-generated
- **Fields Encrypted**: firstName, lastName, username, fullName
- **IV Generation**: Random 16-byte IV for each encryption operation

## API Integrations

### Telegram Bot API

- **Library**: node-telegram-bot-api
- **Features**:
  - Photo message handling (direct and channel)
  - Text command processing
  - Reply message detection
  - Message editing capabilities
  - Caption extraction for enhanced analysis context

### Anthropic Claude AI API

- **Model**: claude-sonnet-4-20250514
- **Functionality**: Food image analysis and nutritional estimation
- **Request Format**: Base64 encoded images with structured prompt
- **Response Format**: JSON with nutritional data

## Core Components

### Message Handlers

1. **Photo Handler**: Processes food images and generates nutritional analysis
2. **Channel Post Handler**: Handles photos posted in configured channels
3. **Reply Handler**: Detects user corrections and removal commands to bot messages
4. **Command Handlers**: Process user commands (/start, /help, /goals, etc.)

### Data Processing Functions

1. **analyzeFood()**: Sends image to Claude AI and parses response, with optional caption context
2. **downloadImage()**: Retrieves and converts Telegram images to base64
3. **parseUserCorrection()**: Interprets user correction messages
4. **handleRemovalCommand()**: Processes user removal requests for food entries
5. **estimateNutrition()**: Calculates nutrition based on food type and serving size

### Storage Functions

1. **saveUserInfo()**: Stores encrypted user information
2. **addFoodEntry()**: Adds nutrition data to user's daily log
3. **removeFoodEntryByIndex()**: Removes nutrition data by index from user's daily log
4. **load/saveNutritionData()**: Manages nutrition data persistence
5. **load/saveGoals()**: Manages user nutrition goals
6. **saveMessageAssociation()**: Links messages to nutrition data for corrections

## Web Dashboard

The web dashboard provides health monitoring and leaderboard functionality via a web interface.

### Components

1. **Frontend** (`web/index.html`): Responsive web interface with tabs for health status, live leaderboard, and user instructions
2. **Backend API** (`server.js`): Express.js server with health check and leaderboard endpoints
3. **API Endpoints**:
   - `GET /api/health`: Service health status
   - `GET /api/leaderboard`: Live leaderboard data
   - `GET /api/stats`: General statistics

### Features

- **Health Monitoring**: Real-time status of Telegram bot, Redis database, Claude AI service, and web service
- **Live Leaderboard**: Real-time nutrition competition with masked user names for privacy
- **User Instructions**: Complete guide for using the bot and adding it to chats/channels
- **Automatic Updates**: Health checks every 30 seconds, leaderboard refresh every 5 minutes

### Leaderboard Scoring Algorithm

Scores are calculated based on % deviation from daily nutrition goals:
- Perfect adherence (all goals at 100%) = 1000 points
- Deviations reduce the score proportionally (e.g., ±10% deviation ≈ 900 points)
- Calculated across 6 nutrition categories: calories, protein, carbs, fat, fiber, hydration

### Individual Scoring System

Users can check their individual daily score using the `/score` command:
- **Score Range**: 0-1000 points
- **Calculation**: Based on percentage deviation from all nutrition goals
- **Real-time Updates**: Score updates with each food entry
- **Score Interpretation**: Higher scores indicate closer adherence to goals
- **Components**: Considers all six nutrition categories equally
- **Command Access**: Available to all users via `/score` command

### Leaderboard Abbreviations

The leaderboard displays nutrition goal adherence using standardized abbreviations:
- **Calories**: cal
- **Protein**: prot
- **Carbohydrates**: carbs
- **Fat**: fats
- **Fiber**: fib
- **Hydration**: hyd
- **Display Location**: Top 3 positions in `/leaderboard` command and web dashboard

## Deployment

### Zeabur Configuration

The `zeabur.config.js` file defines the main bot service:
- Port: 3000
- Install command: `npm install`
- Start command: `npm start` (runs `node zeabur-bot.js`)
- Health check: Root path `/` with 30-second interval
- Services: Redis service definition

The `zeabur-web.config.json` file defines the web dashboard service:
- Build context: current directory
- Dockerfile: `Dockerfile.web`
- Port mapping: 3000:3000
- Health checks: `/api/health` endpoint

## Zeabur Deployment Specifics

### Addressing Common Deployment Issues

#### Redis API Compatibility
- **Issue**: `redisClient.setex is not a function` error due to Redis v5+ API changes
- **Solution**: Updated to use `redisClient.set('key', 'value', { EX: seconds })` syntax
- **Files affected**: `bot.js`, `zeabur-bot.js`

#### Telegram Polling Conflicts
- **Issue**: `409 Conflict: terminated by other getUpdates request` when multiple instances run
- **Solution**: Added proper error handling and warnings to ensure only one bot instance runs
- **Mitigation**: Use webhook mode when possible, otherwise ensure single instance deployment

#### Health Check Configuration
- **Purpose**: Prevent 502 Bad Gateway errors from Zeabur
- **Implementation**: Added Express.js server with health check endpoints
- **Endpoints**: `/` and `/health` return proper JSON responses
- **Configuration**: Defined in `zeabur.config.js` with appropriate intervals and timeouts

### Deployment Scripts
- **`deploy.sh`**: Shell script for deployment verification and startup
- **Environment validation**: Checks for required environment variables before starting
- **Proper startup**: Ensures bot initializes correctly in cloud environment

### Environment Variables

Required environment variables for both services:
- `TELEGRAM_TOKEN`: Telegram bot token
- `ANTHROPIC_API_KEY`: Claude AI API key
- `DEVELOPER_CHAT_ID`: Developer's Telegram ID for feedback
- `ENCRYPTION_KEY`: 32-character encryption key (optional)
- `REDIS_URL`: Redis connection string (auto-configured)
- `PORT`: Port for web dashboard (default: 3000)

## Security

### Data Protection

1. **Encryption at Rest**: AES-256-CBC encryption for sensitive user data
2. **Environment Variables**: Secrets stored in .env file, excluded from Git
3. **Redis Isolation**: Data stored in dedicated Redis instance
4. **Minimal Data Collection**: Only essential information is stored

### Privacy Measures

1. **Data Minimization**: Store only necessary user information
2. **User Control**: Users can interact without sharing personal data
3. **Developer Access**: Limited access to user information via /users command
4. **No Third-party Sharing**: Data is not shared with external services
5. **Masked Names**: User names are masked in leaderboard (e.g., "Jo********")

## Development Guidelines

### Code Style

- Use async/await for asynchronous operations
- Implement proper error handling with try/catch blocks
- Follow consistent naming conventions
- Maintain modular code organization

### Testing

- Test all message handlers with various input types
- Verify encryption/decryption functionality
- Validate data persistence across restarts
- Check error handling for API failures

### Deployment Best Practices

- Update zeabur.config.js and zeabur-web.config.json for service changes
- Maintain backward compatibility in data structures
- Document breaking changes in commit messages
- Test thoroughly before deploying to production