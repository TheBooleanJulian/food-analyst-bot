# Food Analyst Bot - Technical Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Data Storage](#data-storage)
5. [API Integrations](#api-integrations)
6. [Core Components](#core-components)
7. [Deployment](#deployment)
8. [Security](#security)
9. [Development Guidelines](#development-guidelines)

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
```

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Vanilla Node.js with Express-style patterns
- **Telegram Integration**: node-telegram-bot-api
- **AI Processing**: @anthropic-ai/sdk
- **Data Storage**: Redis
- **Scheduling**: node-cron
- **Configuration**: dotenv
- **Deployment**: Zeabur

## Project Structure

```
food-analyst-bot/
├── bot.js              # Main application file
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variable template
├── .gitignore          # Git ignore rules
├── zeabur.config.js    # Zeabur deployment configuration
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
   - Daily targets for calories, protein, carbs, and fat

4. **`message_associations`**: Maps bot messages to nutrition data
   - Enables reply-based correction feature
   - Links message IDs to original nutrition data

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

### Anthropic Claude AI API

- **Model**: claude-sonnet-4-20250514
- **Functionality**: Food image analysis and nutritional estimation
- **Request Format**: Base64 encoded images with structured prompt
- **Response Format**: JSON with nutritional data

## Core Components

### Message Handlers

1. **Photo Handler**: Processes food images and generates nutritional analysis
2. **Channel Post Handler**: Handles photos posted in configured channels
3. **Reply Handler**: Detects user corrections to bot messages
4. **Command Handlers**: Process user commands (/start, /help, /goals, etc.)

### Data Processing Functions

1. **analyzeFood()**: Sends image to Claude AI and parses response
2. **downloadImage()**: Retrieves and converts Telegram images to base64
3. **parseUserCorrection()**: Interprets user correction messages
4. **estimateNutrition()**: Calculates nutrition based on food type and serving size

### Storage Functions

1. **saveUserInfo()**: Stores encrypted user information
2. **addFoodEntry()**: Adds nutrition data to user's daily log
3. **load/saveNutritionData()**: Manages nutrition data persistence
4. **load/saveGoals()**: Manages user nutrition goals
5. **saveMessageAssociation()**: Links messages to nutrition data for corrections

## Deployment

### Zeabur Configuration

The `zeabur.config.js` file defines:
- Container port: 3000
- Setup commands: `npm install`
- Start command: `npm start`
- Services: Redis service definition

### Environment Variables

Required environment variables:
- `TELEGRAM_TOKEN`: Telegram bot token
- `ANTHROPIC_API_KEY`: Claude AI API key
- `DEVELOPER_CHAT_ID`: Developer's Telegram ID for feedback
- `ENCRYPTION_KEY`: 32-character encryption key (optional)
- `REDIS_URL`: Redis connection string (auto-configured)

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

- Update zeabur.config.js for service changes
- Maintain backward compatibility in data structures
- Document breaking changes in commit messages
- Test thoroughly before deploying to production