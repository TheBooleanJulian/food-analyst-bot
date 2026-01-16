const express = require('express');
const redis = require('redis');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, 'web')));
app.use(express.json());

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Connect to Redis
redisClient.connect().catch(console.error);

// Middleware
app.use(express.static('web'));
app.use(express.json());

// Utility function to mask user names
function maskUserName(fullName) {
  if (!fullName || fullName.length <= 3) {
    return fullName || 'Anonymous';
  }
  
  const firstChar = fullName.charAt(0);
  const lastChar = fullName.charAt(fullName.length - 1);
  const middleLength = Math.max(1, fullName.length - 2);
  const maskedMiddle = '*'.repeat(middleLength);
  
  return `${firstChar}${maskedMiddle}${lastChar}`;
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const healthStatus = {
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Check Redis
  try {
    await redisClient.ping();
    healthStatus.services.redis = {
      status: 'online',
      message: 'Connected successfully'
    };
  } catch (error) {
    healthStatus.services.redis = {
      status: 'offline',
      message: 'Connection failed',
      error: error.message
    };
  }

  // Check Telegram Bot (basic connectivity)
  try {
    if (process.env.TELEGRAM_BOT_TOKEN) {
      // This is a basic check - in production you might want to make an actual API call
      healthStatus.services.telegram = {
        status: 'online',
        message: 'Token configured'
      };
    } else {
      healthStatus.services.telegram = {
        status: 'warning',
        message: 'Token not configured'
      };
    }
  } catch (error) {
    healthStatus.services.telegram = {
      status: 'offline',
      message: 'Service unavailable',
      error: error.message
    };
  }

  // Check Claude AI
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      healthStatus.services.claude = {
        status: 'online',
        message: 'API key configured'
      };
    } else {
      healthStatus.services.claude = {
        status: 'warning',
        message: 'API key not configured'
      };
    }
  } catch (error) {
    healthStatus.services.claude = {
      status: 'offline',
      message: 'Service unavailable',
      error: error.message
    };
  }

  // Web service status
  healthStatus.services.web = {
    status: 'online',
    message: 'Web interface operational'
  };

  res.json(healthStatus);
});

// Leaderboard API endpoint
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Load nutrition data to get all active users
    const nutritionData = await redisClient.get('nutrition_data');
    const usersData = await redisClient.get('users');
    const goalsData = await redisClient.get('goals');
    
    const nutrition = nutritionData ? JSON.parse(nutritionData) : {};
    const users = usersData ? JSON.parse(usersData) : {};
    const goals = goalsData ? JSON.parse(goalsData) : {
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 70,
      fiber: 25,
      hydration: 2000
    };
    
    const leaderboard = [];
    const today = new Date().toISOString().split('T')[0];
    
    // Process each user who has nutrition data
    for (const chatId in nutrition) {
      // Check if user has data for today
      if (nutrition[chatId] && nutrition[chatId][today]) {
        // Calculate totals for today
        const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, hydration: 0 };
        
        nutrition[chatId][today].forEach(entry => {
          totals.calories += entry.calories || 0;
          totals.protein += entry.protein || 0;
          totals.carbs += entry.carbs || 0;
          totals.fat += entry.fat || 0;
          totals.fiber += entry.fiber || 0;
          totals.hydration += entry.hydration || 0;
        });
        
        // Calculate percentage for each category
        const percentages = {
          calories: totals.calories / goals.calories,
          protein: totals.protein / goals.protein,
          carbs: totals.carbs / goals.carbs,
          fat: totals.fat / goals.fat,
          fiber: totals.fiber / goals.fiber,
          hydration: totals.hydration / goals.hydration
        };
        
        // Calculate absolute deviations from 100% (1.0)
        const deviations = {
          calories: Math.abs(percentages.calories - 1),
          protein: Math.abs(percentages.protein - 1),
          carbs: Math.abs(percentages.carbs - 1),
          fat: Math.abs(percentages.fat - 1),
          fiber: Math.abs(percentages.fiber - 1),
          hydration: Math.abs(percentages.hydration - 1)
        };
        
        // Calculate average deviation
        const avgDeviation = (
          deviations.calories + 
          deviations.protein + 
          deviations.carbs + 
          deviations.fat + 
          deviations.fiber + 
          deviations.hydration
        ) / 6;
        
        // Convert to score (1000 - deviation * 1000)
        const score = Math.max(0, Math.round(1000 - (avgDeviation * 1000)));
        
        // Get user info
        let displayName = `User ${chatId}`;
        if (users[chatId]) {
          const userInfo = users[chatId];
          // In a real implementation, you'd decrypt the user data here
          if (userInfo.username) {
            displayName = userInfo.username.replace(/:/g, ''); // Remove encryption markers
          } else if (userInfo.fullName) {
            displayName = userInfo.fullName.replace(/:/g, '');
          }
        }
        
        if (score > 0) {
          leaderboard.push({
            userId: chatId,
            displayName: maskUserName(displayName),
            score: score,
            percentages: percentages,
            totals: totals,
            goals: goals
          });
        }
      }
    }
    
    // Sort by score descending
    leaderboard.sort((a, b) => b.score - a.score);
    
    // Add rankings
    const rankedLeaderboard = leaderboard.map((user, index) => ({
      ...user,
      rank: index + 1,
      details: `C:${Math.round(user.percentages.calories * 100)}% P:${Math.round(user.percentages.protein * 100)}% C:${Math.round(user.percentages.carbs * 100)}% F:${Math.round(user.percentages.fat * 100)}% Fi:${Math.round(user.percentages.fiber * 100)}% H:${Math.round(user.percentages.hydration * 100)}%`
    }));
    
    res.json({
      timestamp: new Date().toISOString(),
      leaderboard: rankedLeaderboard,
      totalUsers: rankedLeaderboard.length
    });
    
  } catch (error) {
    console.error('Error generating leaderboard:', error);
    res.status(500).json({
      error: 'Failed to generate leaderboard',
      message: error.message
    });
  }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const stats = {
      timestamp: new Date().toISOString()
    };
    
    // Get user count
    const usersData = await redisClient.get('users');
    const users = usersData ? JSON.parse(usersData) : {};
    stats.totalUsers = Object.keys(users).length;
    
    // Get today's entries count
    const nutritionData = await redisClient.get('nutrition_data');
    const nutrition = nutritionData ? JSON.parse(nutritionData) : {};
    const today = new Date().toISOString().split('T')[0];
    
    let todayEntries = 0;
    for (const chatId in nutrition) {
      if (nutrition[chatId] && nutrition[chatId][today]) {
        todayEntries += nutrition[chatId][today].length;
      }
    }
    stats.todayEntries = todayEntries;
    
    // Get goals
    const goalsData = await redisClient.get('goals');
    stats.currentGoals = goalsData ? JSON.parse(goalsData) : {};
    
    res.json(stats);
    
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      error: 'Failed to get statistics',
      message: error.message
    });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  // If requesting root, serve the dashboard if it exists, otherwise return health status
  const indexPath = path.join(__dirname, 'web', 'index.html');
  
  // Check if index.html exists in web directory
  fs.access(indexPath, fs.constants.F_OK)
    .then(() => {
      // If index.html exists, serve the dashboard
      res.sendFile(indexPath);
    })
    .catch(() => {
      // If index.html doesn't exist, return health status
      res.json({ 
        status: 'healthy', 
        service: 'Food Analyst Bot Dashboard',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
});

// Start server
app.listen(port, () => {
  console.log(`🤖 Food Analyst Bot Health Dashboard running on port ${port}`);
  console.log(`📊 Access dashboard at: http://localhost:${port}`);
});

module.exports = app;