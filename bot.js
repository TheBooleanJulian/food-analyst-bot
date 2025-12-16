require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Data storage functions
const DATA_DIR = path.join(__dirname, 'data');
const NUTRITION_FILE = path.join(DATA_DIR, 'nutrition.json');
const GOALS_FILE = path.join(DATA_DIR, 'goals.json');

// Initialize data directory
async function initializeDataDirectory() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR);
  }
  
  // Create empty files if they don't exist
  try {
    await fs.access(NUTRITION_FILE);
  } catch {
    await fs.writeFile(NUTRITION_FILE, JSON.stringify({}));
  }
  
  try {
    await fs.access(GOALS_FILE);
  } catch {
    await fs.writeFile(GOALS_FILE, JSON.stringify({
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 70
    }));
  }
}

// Load nutrition data
async function loadNutritionData() {
  try {
    const data = await fs.readFile(NUTRITION_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Save nutrition data
async function saveNutritionData(data) {
  await fs.writeFile(NUTRITION_FILE, JSON.stringify(data, null, 2));
}

// Load goals
async function loadGoals() {
  try {
    const data = await fs.readFile(GOALS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 70
    };
  }
}

// Save goals
async function saveGoals(goals) {
  await fs.writeFile(GOALS_FILE, JSON.stringify(goals, null, 2));
}

// Add food entry to nutrition data
async function addFoodEntry(chatId, nutrition) {
  const data = await loadNutritionData();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  if (!data[chatId]) {
    data[chatId] = {};
  }
  
  if (!data[chatId][today]) {
    data[chatId][today] = [];
  }
  
  data[chatId][today].push({
    timestamp: new Date().toISOString(),
    ...nutrition
  });
  
  await saveNutritionData(data);
  return data[chatId][today];
}

// Get today's nutrition totals
async function getTodayTotals(chatId) {
  const data = await loadNutritionData();
  const today = new Date().toISOString().split('T')[0];
  
  if (!data[chatId] || !data[chatId][today]) {
    return { calories: 0, protein: 0, carbs: 0, fat: 0 };
  }
  
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  
  data[chatId][today].forEach(entry => {
    totals.calories += entry.calories;
    totals.protein += entry.protein;
    totals.carbs += entry.carbs;
    totals.fat += entry.fat;
  });
  
  return totals;
}

// Get daily summary
async function getDailySummary(chatId) {
  const data = await loadNutritionData();
  const today = new Date().toISOString().split('T')[0];
  
  if (!data[chatId] || !data[chatId][today]) {
    return null;
  }
  
  const entries = data[chatId][today];
  const totals = await getTodayTotals(chatId);
  const goals = await loadGoals();
  
  let summary = `🍽️ *Daily Nutrition Summary* (${today})\n\n`;
  
  entries.forEach((entry, index) => {
    summary += `${index + 1}. ${entry.food_name} - ${entry.calories} kcal\n`;
  });
  
  summary += `\n📊 *Total Nutrition:*\n`;
  summary += `- Calories: ${totals.calories}/${goals.calories} kcal\n`;
  summary += `- Protein: ${totals.protein}/${goals.protein}g\n`;
  summary += `- Carbs: ${totals.carbs}/${goals.carbs}g\n`;
  summary += `- Fat: ${totals.fat}/${goals.fat}g\n\n`;
  
  // Progress indicators
  const calorieProgress = Math.min(100, Math.round((totals.calories / goals.calories) * 100));
  const proteinProgress = Math.min(100, Math.round((totals.protein / goals.protein) * 100));
  const carbProgress = Math.min(100, Math.round((totals.carbs / goals.carbs) * 100));
  const fatProgress = Math.min(100, Math.round((totals.fat / goals.fat) * 100));
  
  summary += `📈 *Progress:*\n`;
  summary += `- Calories: ${calorieProgress}%\n`;
  summary += `- Protein: ${proteinProgress}%\n`;
  summary += `- Carbs: ${carbProgress}%\n`;
  summary += `- Fat: ${fatProgress}%\n`;
  
  return summary;
}

// Initialize data directory
initializeDataDirectory();

// Schedule daily summary at 23:59
// Note: This will run in the server's timezone
cron.schedule('59 23 * * *', async () => {
  console.log('Sending daily summaries...');
  
  // Load nutrition data to get all chat IDs
  const data = await loadNutritionData();
  
  // Send summary to each chat that has data
  for (const chatId in data) {
    try {
      const summary = await getDailySummary(chatId);
      if (summary) {
        await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error(`Failed to send daily summary to chat ${chatId}:`, error);
    }
  }
});

// Download image from Telegram and convert to base64
async function downloadImage(fileId) {
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  
  return new Promise((resolve, reject) => {
    https.get(fileUrl, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('base64'));
      });
      res.on('error', reject);
    });
  });
}

// Analyze food with Claude
async function analyzeFood(base64Image) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: base64Image
          }
        },
        {
          type: 'text',
          text: `Analyze this food image and provide nutritional estimates. 
          
Return ONLY a JSON object with this exact format (no markdown, no explanation):
{
  "food_name": "name of the dish",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "serving_size": "description",
  "confidence": "high/medium/low"
}

Base estimates on typical serving sizes. Be specific about the food identified.`
        }
      ]
    }]
  });

  const responseText = message.content[0].text.trim();
  // Remove markdown code blocks if present
  const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(jsonText);
}

// Handle photo messages
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  
  // Only respond to configured chat or private messages
  if (chatId.toString() !== process.env.CHAT_ID && msg.chat.type !== 'private') {
    return;
  }

  try {
    await bot.sendMessage(chatId, '🔍 Analyzing your food...');
    
    // Get highest quality photo
    const photo = msg.photo[msg.photo.length - 1];
    const base64Image = await downloadImage(photo.file_id);
    
    // Analyze with Claude
    const nutrition = await analyzeFood(base64Image);
    
    // Save nutrition entry
    await addFoodEntry(chatId, nutrition);
    
    // Get today's totals
    const totals = await getTodayTotals(chatId);
    const goals = await loadGoals();
    
    // Format response
    const response = `🍽️ **${nutrition.food_name}**

📊 **Nutritional Information:**
- Calories: ${nutrition.calories} kcal
- Protein: ${nutrition.protein}g
- Carbs: ${nutrition.carbs}g
- Fat: ${nutrition.fat}g

📏 Serving: ${nutrition.serving_size}
🎯 Confidence: ${nutrition.confidence}

📊 **Today's Totals:**
- Calories: ${totals.calories}/${goals.calories} kcal
- Protein: ${totals.protein}/${goals.protein}g
- Carbs: ${totals.carbs}/${goals.carbs}g
- Fat: ${totals.fat}/${goals.fat}g

_Note: These are estimates based on visual analysis._
Powered by _Claude AI 🤖_`;

    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Error:', error);
    await bot.sendMessage(
      chatId, 
      '❌ Sorry, I had trouble analyzing that image. Please try again.'
    );
  }
});

// Handle channel post photo messages
bot.on('channel_post', async (msg) => {
  // Check if this is a channel post from our configured chat and contains a photo
  if (msg.chat.id.toString() !== process.env.CHAT_ID || !msg.photo) {
    return;
  }

  try {
    // For channel posts, we send the response to the same channel
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId, '🔍 Analyzing your food...', { reply_to_message_id: msg.message_id });
    
    // Get highest quality photo
    const photo = msg.photo[msg.photo.length - 1];
    const base64Image = await downloadImage(photo.file_id);
    
    // Analyze with Claude
    const nutrition = await analyzeFood(base64Image);
    
    // Save nutrition entry
    await addFoodEntry(chatId, nutrition);
    
    // Get today's totals
    const totals = await getTodayTotals(chatId);
    const goals = await loadGoals();
    
    // Format response
    const response = `🍽️ **${nutrition.food_name}**

📊 **Nutritional Information:**
- Calories: ${nutrition.calories} kcal
- Protein: ${nutrition.protein}g
- Carbs: ${nutrition.carbs}g
- Fat: ${nutrition.fat}g

📏 Serving: ${nutrition.serving_size}
🎯 Confidence: ${nutrition.confidence}

📊 **Today's Totals:**
- Calories: ${totals.calories}/${goals.calories} kcal
- Protein: ${totals.protein}/${goals.protein}g
- Carbs: ${totals.carbs}/${goals.carbs}g
- Fat: ${totals.fat}/${goals.fat}g

_Note: These are estimates based on visual analysis._`;

    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
    
  } catch (error) {
    console.error('Error:', error);
    // For channel posts, we still try to respond in the channel
    await bot.sendMessage(
      msg.chat.id, 
      '❌ Sorry, I had trouble analyzing that image. Please try again.',
      { reply_to_message_id: msg.message_id }
    );
  }
});

// Start message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  // Allow both channel and direct messages
  const isAuthorized = chatId.toString() === process.env.CHAT_ID || msg.chat.type === 'private';
  if (!isAuthorized) return;
  
  bot.sendMessage(
    chatId,
    '👋 Welcome to Food Analyst Bot!\n\n' +
    '📸 Send me a photo of your food and I\'ll analyze its nutritional content.\n\n' +
    '📋 For available commands, type /help\n\n' +
    '*Works in both direct messages and channel posts!*\n\n' +
    'Powered by Claude AI 🤖'
  );
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  // Allow both channel and direct messages
  const isAuthorized = chatId.toString() === process.env.CHAT_ID || msg.chat.type === 'private';
  if (!isAuthorized) return;
  
  bot.sendMessage(
    chatId,
    '🤖 *Food Analyst Bot Commands*\n\n' +
    '📸 *Food Analysis:*\n' +
    'Simply send a photo of your food to get nutritional information\n\n' +
    '📋 *Tracking Commands:*\n' +
    '/goals - Set your daily nutrition goals\n' +
    '/summary - Get today\'s nutrition summary\n' +
    '/progress - Check your progress toward goals\n\n' +
    'ℹ️ *Usage Tips:*\n' +
    '- Works in both direct messages and channel posts\n' +
    '- Goals are set in format: calories protein carbs fat\n' +
    '- Example: /goals 2000 150 250 70\n\n' +
    'Powered by Claude AI 🤖'
  , { parse_mode: 'Markdown' });
});

// Set nutrition goals
bot.onText(/\/goals/, async (msg) => {
  const chatId = msg.chat.id;
  // Allow both channel and direct messages
  const isAuthorized = chatId.toString() === process.env.CHAT_ID || msg.chat.type === 'private';
  if (!isAuthorized) return;
  
  bot.sendMessage(
    chatId,
    'Please enter your daily nutrition goals in this format:\n' +
    'calories protein carbs fat\n\n' +
    'Example: 2000 150 250 70\n\n' +
    'Or type /cancel to cancel.'
  );
  
  // Set up listener for goal input
  const goalListener = bot.on('message', async (responseMsg) => {
    if (responseMsg.chat.id !== chatId) return;
    
    if (responseMsg.text === '/cancel') {
      bot.removeTextListener(goalListener);
      bot.removeListener(goalListener);
      bot.sendMessage(chatId, 'Goal setting cancelled.');
      return;
    }
    
    const parts = responseMsg.text.split(' ').map(p => parseInt(p)).filter(p => !isNaN(p));
    
    if (parts.length === 4) {
      const goals = {
        calories: parts[0],
        protein: parts[1],
        carbs: parts[2],
        fat: parts[3]
      };
      
      await saveGoals(goals);
      bot.removeTextListener(goalListener);
      bot.removeListener(goalListener);
      
      bot.sendMessage(
        chatId,
        `✅ Nutrition goals updated!\n\n` +
        `🎯 Daily Goals:\n` +
        `- Calories: ${goals.calories} kcal\n` +
        `- Protein: ${goals.protein}g\n` +
        `- Carbs: ${goals.carbs}g\n` +
        `- Fat: ${goals.fat}g`
      );
    } else {
      bot.sendMessage(
        chatId,
        '❌ Invalid format. Please enter goals as four numbers: calories protein carbs fat\n\n' +
        'Example: 2000 150 250 70'
      );
    }
  });
});

// Get daily summary
bot.onText(/\/summary/, async (msg) => {
  const chatId = msg.chat.id;
  // Allow both channel and direct messages
  const isAuthorized = chatId.toString() === process.env.CHAT_ID || msg.chat.type === 'private';
  if (!isAuthorized) return;
  
  const summary = await getDailySummary(chatId);
  
  if (summary) {
    await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, '📭 No food entries recorded today.');
  }
});

// Check progress toward goals
bot.onText(/\/progress/, async (msg) => {
  const chatId = msg.chat.id;
  // Allow both channel and direct messages
  const isAuthorized = chatId.toString() === process.env.CHAT_ID || msg.chat.type === 'private';
  if (!isAuthorized) return;
  
  const totals = await getTodayTotals(chatId);
  const goals = await loadGoals();
  
  const calorieProgress = Math.min(100, Math.round((totals.calories / goals.calories) * 100));
  const proteinProgress = Math.min(100, Math.round((totals.protein / goals.protein) * 100));
  const carbProgress = Math.min(100, Math.round((totals.carbs / goals.carbs) * 100));
  const fatProgress = Math.min(100, Math.round((totals.fat / goals.fat) * 100));
  
  const response = `📈 *Nutrition Progress*\n\n` +
    `- Calories: ${totals.calories}/${goals.calories} kcal (${calorieProgress}%)\n` +
    `- Protein: ${totals.protein}/${goals.protein}g (${proteinProgress}%)\n` +
    `- Carbs: ${totals.carbs}/${goals.carbs}g (${carbProgress}%)\n` +
    `- Fat: ${totals.fat}/${goals.fat}g (${fatProgress}%)\n\n`;
  
  // Add motivational messages
  if (calorieProgress >= 100) {
    response += '🎉 You\'ve reached your calorie goal!';
  } else if (calorieProgress >= 90) {
    response += '🏃 Almost there! You\'re close to your calorie goal.';
  } else if (calorieProgress >= 50) {
    response += '👍 Good progress on your calories!';
  } else {
    response += '🚀 Keep going!';
  }
  
  await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

console.log('🤖 Food Analyst Bot is running...');