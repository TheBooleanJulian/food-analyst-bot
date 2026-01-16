# Food Analyst Bot Web Dashboard

A comprehensive health monitoring dashboard and leaderboard viewer for the Food Analyst Telegram bot.

## Features

### 🏥 Health Monitoring
- Real-time status of all bot services
- Telegram bot connectivity check
- Redis database connection status
- Claude AI service availability
- Automatic health checks every 30 seconds

### 🏆 Live Leaderboard
- Real-time nutrition competition leaderboard
- Scores calculated based on % deviation from daily goals
- Privacy-protected user names (masked display)
- Automatic refresh every 5 minutes
- Detailed nutrition breakdown for top performers

### 📋 User Instructions
- Complete guide for adding bot to chats/channels
- Comprehensive command reference
- Usage tips and best practices
- Step-by-step setup instructions

## Setup

### Installation

1. Install additional dependencies:
```bash
npm install express axios
npm install --save-dev nodemon
```

2. The dashboard uses the same environment variables as the bot:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ANTHROPIC_API_KEY=your_claude_api_key
REDIS_URL=your_redis_connection_string
PORT=3000
```

### Running the Dashboard

#### Production Mode
```bash
npm run web
```

#### Development Mode (with auto-reload)
```bash
npm run dev
```

The dashboard will be available at `http://localhost:3000` (or your configured PORT).

## API Endpoints

### GET /api/health
Returns the current health status of all services:
```json
{
  "timestamp": "2024-01-XXTXX:XX:XX.XXXZ",
  "services": {
    "redis": { "status": "online", "message": "Connected successfully" },
    "telegram": { "status": "online", "message": "Token configured" },
    "claude": { "status": "online", "message": "API key configured" },
    "web": { "status": "online", "message": "Web interface operational" }
  }
}
```

### GET /api/leaderboard
Returns the current leaderboard data:
```json
{
  "timestamp": "2024-01-XXTXX:XX:XX.XXXZ",
  "leaderboard": [
    {
      "rank": 1,
      "userId": "123456789",
      "displayName": "Jo********",
      "score": 987,
      "details": "C:95% P:102% C:98% F:101% Fi:97% H:103%"
    }
  ],
  "totalUsers": 5
}
```

### GET /api/stats
Returns general statistics:
```json
{
  "timestamp": "2024-01-XXTXX:XX:XX.XXXZ",
  "totalUsers": 25,
  "todayEntries": 47,
  "currentGoals": {
    "calories": 2000,
    "protein": 150,
    "carbs": 250,
    "fat": 70,
    "fiber": 25,
    "hydration": 2000
  }
}
```

## Deployment

### Zeabur Deployment

1. Add the web service to your Zeabur project:
```yaml
# zeabur-web.yaml
services:
  web-dashboard:
    build:
      context: .
      dockerfile: Dockerfile.web
    ports:
      - "3000:3000"
    environment:
      - TELEGRAM_BOT_TOKEN
      - ANTHROPIC_API_KEY
      - REDIS_URL
      - PORT=3000
```

### Common Deployment Issues and Solutions

#### 502 Bad Gateway Errors
- **Cause**: Service not responding to health checks
- **Solution**: Ensure Express.js server is running and responding to root path (`/`)
- **Verification**: Check that your service listens on the correct port

#### Redis API Compatibility
- **Issue**: `redisClient.setex is not a function` with newer Redis versions
- **Solution**: Use `redisClient.set('key', 'value', { EX: seconds })` syntax

#### Health Check Configuration
- **Best practice**: Define proper health check endpoints in your configuration
- **Interval**: Set appropriate health check intervals (typically 30 seconds)
- **Timeout**: Configure adequate response timeout values

2. Create a simple Dockerfile for the web service:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "run", "web"]
```

### Environment Variables

The web dashboard requires the same environment variables as the main bot:
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
- `ANTHROPIC_API_KEY` - Your Claude AI API key
- `REDIS_URL` - Redis connection string
- `PORT` - Port to run the web server on (default: 3000)

## Customization

### Styling
The dashboard uses CSS variables that can be easily customized in the `<style>` section of `web/index.html`.

### Health Checks
Modify the health checking logic in `server.js` to add custom service checks or change the checking intervals.

### Leaderboard Calculation
Adjust the scoring algorithm in the `/api/leaderboard` endpoint to modify how scores are calculated.

## Security Considerations

- The dashboard exposes service health information - consider adding authentication for production use
- API endpoints return aggregated data only - no personal information is exposed
- User names are masked for privacy protection
- Rate limiting should be implemented for public deployments

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Check `REDIS_URL` environment variable
   - Verify Redis service is running and accessible

2. **Health Checks Showing Offline**
   - Services may be temporarily unavailable
   - Check service credentials in environment variables

3. **Leaderboard Empty**
   - No users have recorded nutrition data today
   - Redis may be empty or misconfigured

### Logs
Check the console output for detailed error messages and service status information.

## Contributing

Feel free to submit issues and enhancement requests!