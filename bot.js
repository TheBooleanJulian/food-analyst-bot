require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const redis = require('redis');
const crypto = require('crypto');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Connect to Redis
redisClient.connect().catch(console.error);

// Encryption utilities
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
const IV_LENGTH = 16; // For AES, this is always 16

function encrypt(text) {
  if (!text) return text;
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (error) {
    console.error('Encryption error:', error);
    return text; // Return original text if encryption fails
  }
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error);
    return text; // Return original text if decryption fails
  }
}

// Developer Telegram ID (for feedback)
const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || null;

// Data storage functions
const DATA_DIR = path.join(__dirname, 'data');
const NUTRITION_FILE = path.join(DATA_DIR, 'nutrition.json');
const GOALS_FILE = path.join(DATA_DIR, 'goals.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGE_ASSOCIATIONS_FILE = path.join(DATA_DIR, 'message_associations.json');

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
  
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, JSON.stringify({}));
  }
  
  // Create message associations file if it doesn't exist
  try {
    await fs.access(MESSAGE_ASSOCIATIONS_FILE);
  } catch {
    await fs.writeFile(MESSAGE_ASSOCIATIONS_FILE, JSON.stringify({}));
  }
}

// Load nutrition data
async function loadNutritionData() {
  try {
    const data = await redisClient.get('nutrition_data');
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

// Save nutrition data
async function saveNutritionData(data) {
  await redisClient.set('nutrition_data', JSON.stringify(data));
}

// Load goals
async function loadGoals() {
  try {
    const data = await redisClient.get('goals');
    return data ? JSON.parse(data) : {
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 70
    };
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
  await redisClient.set('goals', JSON.stringify(goals));
}

// Save user information
async function saveUserInfo(userId, userInfo) {
  try {
    // Get existing users data from Redis
    const usersData = await redisClient.get('users');
    const users = usersData ? JSON.parse(usersData) : {};
    
    // Encrypt sensitive user information
    const encryptedUserInfo = {
      ...userInfo,
      firstName: userInfo.firstName ? encrypt(userInfo.firstName) : undefined,
      lastName: userInfo.lastName ? encrypt(userInfo.lastName) : undefined,
      username: userInfo.username ? encrypt(userInfo.username) : undefined,
      fullName: userInfo.fullName ? encrypt(userInfo.fullName) : undefined,
      lastSeen: new Date().toISOString()
    };
    
    // Update user info
    users[userId] = encryptedUserInfo;
    
    // Save updated users data to Redis
    await redisClient.set('users', JSON.stringify(users));
  } catch (error) {
    console.error('Error saving user info to Redis:', error);
  }
}

// Load message associations
async function loadMessageAssociations() {
  try {
    const data = await redisClient.get('message_associations');
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

// Save message associations
async function saveMessageAssociations(data) {
  await redisClient.set('message_associations', JSON.stringify(data));
}

// Parse user correction input
function parseUserCorrection(input) {
  // Simple parser for corrections like "500ml coke" or "coffee 200ml"
  const lowerInput = input.toLowerCase().trim();
  
  // Extract serving size (e.g., 500ml, 200g, 1 cup)
  const servingSizeMatch = lowerInput.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|oz|cup|cups|tbsp|tsp)/);
  let servingSize = "Standard serving";
  let quantity = 1;
  let unit = "serving";
  
  if (servingSizeMatch) {
    quantity = parseFloat(servingSizeMatch[1]);
    unit = servingSizeMatch[2];
    servingSize = `${quantity}${unit}`;
  }
  
  // Extract food name (everything except the serving size part)
  let foodName = lowerInput;
  if (servingSizeMatch) {
    foodName = foodName.replace(servingSizeMatch[0], '').trim();
  }
  
  // Clean up the food name
  foodName = foodName.replace(/^\W+|\W+$/g, '') || 'Unknown food';
  
  // Capitalize first letter
  foodName = foodName.charAt(0).toUpperCase() + foodName.slice(1);
  
  // Estimate nutrition based on common foods and serving sizes
  const nutritionEstimates = estimateNutrition(foodName, quantity, unit);
  
  return {
    food_name: foodName,
    calories: nutritionEstimates.calories,
    protein: nutritionEstimates.protein,
    carbs: nutritionEstimates.carbs,
    fat: nutritionEstimates.fat,
    serving_size: servingSize
  };
}

// Estimate nutrition based on food name and serving size
function estimateNutrition(foodName, quantity, unit) {
  // This is a simplified estimation - in a real app, you'd use a proper nutrition database
  const baseNutrition = getBaseNutrition(foodName);
  
  // Calculate multiplier based on serving size
  const multiplier = calculateServingMultiplier(quantity, unit);
  
  return {
    calories: Math.round(baseNutrition.calories * multiplier),
    protein: parseFloat((baseNutrition.protein * multiplier).toFixed(1)),
    carbs: parseFloat((baseNutrition.carbs * multiplier).toFixed(1)),
    fat: parseFloat((baseNutrition.fat * multiplier).toFixed(1))
  };
}

// Get base nutrition values for common foods (per standard serving)
function getBaseNutrition(foodName) {
  const foodDatabase = {
    'Coffee': { calories: 5, protein: 0.3, carbs: 0, fat: 0 },
    'Coke': { calories: 140, protein: 0, carbs: 39, fat: 0 },
    'Cola': { calories: 140, protein: 0, carbs: 39, fat: 0 },
    'Apple': { calories: 95, protein: 0.5, carbs: 25, fat: 0.3 },
    'Banana': { calories: 105, protein: 1.3, carbs: 27, fat: 0.4 },
    'Orange': { calories: 62, protein: 1.2, carbs: 15, fat: 0.2 },
    'Bread': { calories: 80, protein: 3, carbs: 15, fat: 1 },
    'Rice': { calories: 205, protein: 4, carbs: 45, fat: 0.4 },
    'Chicken': { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    'Beef': { calories: 250, protein: 26, carbs: 0, fat: 15 },
    'Fish': { calories: 120, protein: 22, carbs: 0, fat: 3 },
    'Salad': { calories: 15, protein: 1, carbs: 3, fat: 0.2 },
    'Pasta': { calories: 200, protein: 7, carbs: 43, fat: 1 },
    'Pizza': { calories: 285, protein: 12, carbs: 36, fat: 10 },
    'Burger': { calories: 295, protein: 15, carbs: 30, fat: 12 },
    'Sandwich': { calories: 220, protein: 9, carbs: 25, fat: 9 },
    'Milk': { calories: 103, protein: 8, carbs: 12, fat: 2.4 },
    'Cheese': { calories: 113, protein: 7, carbs: 1, fat: 9 },
    'Yogurt': { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
    'Ice cream': { calories: 207, protein: 3.5, carbs: 24, fat: 11 },
    'Cake': { calories: 237, protein: 2.3, carbs: 33, fat: 10 },
    'Cookie': { calories: 78, protein: 0.9, carbs: 10, fat: 4 },
    'Chocolate': { calories: 155, protein: 1.5, carbs: 15, fat: 9 },
    'Water': { calories: 0, protein: 0, carbs: 0, fat: 0 },
    'Tea': { calories: 2, protein: 0, carbs: 0.5, fat: 0 },
    'Juice': { calories: 110, protein: 0.5, carbs: 26, fat: 0.3 },
    'Soda': { calories: 140, protein: 0, carbs: 39, fat: 0 },
    'Beer': { calories: 153, protein: 1.6, carbs: 13, fat: 0 },
    'Wine': { calories: 125, protein: 0.1, carbs: 3.8, fat: 0 },
    'Default': { calories: 100, protein: 5, carbs: 15, fat: 3 }
  };
  
  // Try to find a match (case insensitive)
  for (const [key, value] of Object.entries(foodDatabase)) {
    if (foodName.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }
  
  // Return default if no match found
  return foodDatabase['Default'];
}

// Calculate serving multiplier based on quantity and unit
function calculateServingMultiplier(quantity, unit) {
  // Standard serving multipliers (these would ideally come from a database)
  const unitMultipliers = {
    'ml': quantity / 250,    // Standard glass is 250ml
    'l': quantity * 4,       // 1L = 4 * 250ml
    'g': quantity / 100,     // Standard serving is 100g
    'kg': quantity * 10,     // 1kg = 10 * 100g
    'oz': quantity / 4,      // 4 oz = 113g standard serving
    'cup': quantity,         // 1 cup is standard
    'cups': quantity,        // plural
    'tbsp': quantity / 16,   // 16 tbsp = 1 cup
    'tsp': quantity / 48,    // 48 tsp = 1 cup
    'serving': 1             // Default
  };
  
  return unitMultipliers[unit] || 1;
}

async function saveMessageAssociation(messageId, chatId, nutritionData) {
  const associations = await loadMessageAssociations();
  
  // Store the association with chat ID and nutrition data
  associations[messageId] = {
    chatId: chatId,
    nutritionData: nutritionData,
    timestamp: new Date().toISOString()
  };
  
  await saveMessageAssociations(associations);
}

// Update nutrition data based on message ID
async function updateNutritionByMessageId(messageId, updatedNutritionData) {
  const associations = await loadMessageAssociations();
  
  if (!associations[messageId]) {
    throw new Error('No association found for this message');
  }
  
  const association = associations[messageId];
  
  // Load current nutrition data
  const nutritionData = await loadNutritionData();
  
  // Find and update the specific entry
  const today = new Date().toISOString().split('T')[0];
  
  if (nutritionData[association.chatId] && nutritionData[association.chatId][today]) {
    // Find the entry that matches the original nutrition data
    const entries = nutritionData[association.chatId][today];
    const index = entries.findIndex(entry => 
      entry.food_name === association.nutritionData.food_name &&
      entry.calories === association.nutritionData.calories &&
      entry.protein === association.nutritionData.protein &&
      entry.carbs === association.nutritionData.carbs &&
      entry.fat === association.nutritionData.fat
    );
    
    if (index !== -1) {
      // Update the entry with new data
      nutritionData[association.chatId][today][index] = {
        ...nutritionData[association.chatId][today][index],
        ...updatedNutritionData,
        timestamp: new Date().toISOString()
      };
      
      await saveNutritionData(nutritionData);
      return true;
    }
  }
  
  return false;
}

// Process user correction to bot analysis
async function processCorrection(msg) {
  const chatId = msg.chat.id;
  const replyMessageId = msg.reply_to_message.message_id;
  
  try {
    // Parse the user's correction
    const correction = parseUserCorrection(msg.text);
    
    // Update the nutrition data
    const success = await updateNutritionByMessageId(replyMessageId, correction);
    
    if (success) {
      // Send confirmation to user
      await bot.sendMessage(chatId, 
        `✅ Analysis updated successfully!\n\n` +
        `🍽️ Food: ${correction.food_name}\n` +
        `📊 Calories: ${correction.calories} kcal\n` +
        `🥩 Protein: ${correction.protein}g\n` +
        `🍞 Carbs: ${correction.carbs}g\n` +
        `🧈 Fat: ${correction.fat}g\n` +
        `📏 Serving: ${correction.serving_size}`,
        { reply_to_message_id: msg.message_id }
      );
      
      // Update the original message with the corrected information
      try {
        const associations = await loadMessageAssociations();
        const association = associations[replyMessageId];
        
        if (association) {
          // Get updated totals
          const totals = await getTodayTotals(chatId);
          const goals = await loadGoals();
          
          // Format updated response
          const updatedResponse = `🍽️ **${correction.food_name}**

` +
            `📊 **Nutritional Information:**
` +
            `- Calories: ${correction.calories} kcal
` +
            `- Protein: ${correction.protein}g
` +
            `- Carbs: ${correction.carbs}g
` +
            `- Fat: ${correction.fat}g

` +
            `📏 Serving: ${correction.serving_size}
` +
            `🎯 Confidence: manually corrected

` +
            `📊 **Today's Totals:**
` +
            `- Calories: ${totals.calories}/${goals.calories} kcal
` +
            `- Protein: ${totals.protein}/${goals.protein}g
` +
            `- Carbs: ${totals.carbs}/${goals.carbs}g
` +
            `- Fat: ${totals.fat}/${goals.fat}g

` +
            `_Note: Updated based on user correction._
` +
            `Powered by _Claude AI 🤖_`;
          
          await bot.editMessageText(updatedResponse, {
            chat_id: chatId,
            message_id: replyMessageId,
            parse_mode: 'Markdown'
          });
        }
      } catch (error) {
        console.error('Error updating original message:', error);
      }
    } else {
      await bot.sendMessage(chatId, 
        '❌ Could not find the original analysis to update.',
        { reply_to_message_id: msg.message_id }
      );
    }
  } catch (error) {
    console.error('Error processing correction:', error);
    await bot.sendMessage(chatId, 
      '❌ Sorry, I couldn\'t process your correction. Please make sure your message follows the format:\n\n' +
      '"500ml coke" or "coffee 200ml"\n\n' +
      'I\'ll try to interpret the food item and serving size from your message.',
      { reply_to_message_id: msg.message_id }
    );
  }
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

    // Save message association for future corrections
    const sentMessage = await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    await saveMessageAssociation(sentMessage.message_id, chatId, nutrition);
    
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

    // Save message association for future corrections
    const sentMessage = await bot.sendMessage(chatId, response, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
    await saveMessageAssociation(sentMessage.message_id, chatId, nutrition);
    
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
    '📬 *Feedback Commands:*\n' +
    '/feedback - Send bug reports or suggestions to the developer\n\n' +
    'ℹ️ *Usage Tips:*\n' +
    '- Works in both direct messages and channel posts\n' +
    '- Goals are set in format: calories protein carbs fat\n' +
    '- Example: /goals 2000 150 250 70\n\n' +
    '💬 *For Developers:*\n' +
    '- User names in feedback are clickable links\n' +
    '- Use /users to see recent user interactions\n\n' +
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
    // Ensure we only process messages from the same chat
    if (responseMsg.chat.id !== chatId) return;
    
    // Remove the listener immediately to prevent stacking
    try {
      bot.removeTextListener(goalListener);
      bot.removeListener(goalListener);
    } catch (e) {
      // Ignore errors if listener is already removed
    }
    
    // Handle cancellation
    if (responseMsg.text === '/cancel') {
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
  
  // Auto-remove listener after 5 minutes to prevent stacking
  setTimeout(() => {
    try {
      bot.removeTextListener(goalListener);
      bot.removeListener(goalListener);
    } catch (e) {
      // Ignore errors if listener is already removed
    }
  }, 5 * 60 * 1000); // 5 minutes
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

// Feedback command
bot.onText(/\/feedback/, (msg) => {
  const chatId = msg.chat.id;
  // Allow both channel and direct messages
  const isAuthorized = chatId.toString() === process.env.CHAT_ID || msg.chat.type === 'private';
  if (!isAuthorized) return;
  
  bot.sendMessage(
    chatId,
    '📬 *Send Feedback*\n\n' +
    'Please type your bug report or suggestion and I\'ll forward it to my developer @JulianC97.\n\n' +
    'You can also contact the developer directly on Telegram: @JulianC97\n\n' +
    'Or type /cancel to cancel.'
  , { parse_mode: 'Markdown' });
  
  // Set up listener for feedback input
  const feedbackListener = bot.on('message', async (responseMsg) => {
    // Ensure we only process messages from the same chat
    if (responseMsg.chat.id !== chatId) return;
    
    // Remove the listener immediately to prevent stacking
    try {
      bot.removeTextListener(feedbackListener);
      bot.removeListener(feedbackListener);
    } catch (e) {
      // Ignore errors if listener is already removed
    }
    
    // Handle cancellation
    if (responseMsg.text === '/cancel') {
      bot.sendMessage(chatId, 'Feedback cancelled.');
      return;
    }
    
    // Forward feedback to developer
    try {
      const userInfo = `${responseMsg.from.first_name || ''} ${responseMsg.from.last_name || ''}`.trim() || 
                      responseMsg.from.username || 
                      `User ${responseMsg.from.id}`;
      
      // Save user information for future reference
      await saveUserInfo(responseMsg.from.id, {
        firstName: responseMsg.from.first_name,
        lastName: responseMsg.from.last_name,
        username: responseMsg.from.username,
        fullName: userInfo
      });
      
      const feedbackMessage = `📬 *New Feedback*\n\n` +
        `From: [${userInfo}](tg://user?id=${responseMsg.from.id}) (${responseMsg.from.id})\n` +
        `Date: ${new Date().toLocaleString()}\n\n` +
        `📝 Message:\n${responseMsg.text}\n\n` +
        `🔄 *To Respond:*\n` +
        `Click on the user's name above to open a chat with them directly.`;
      
      // Send feedback to developer if chat ID is configured
      if (DEVELOPER_CHAT_ID) {
        await bot.sendMessage(DEVELOPER_CHAT_ID, feedbackMessage, { parse_mode: 'Markdown' });
      } else {
        // Fallback: Log to console if no developer chat ID is set
        console.log(`Feedback received from ${userInfo}: ${responseMsg.text}`);
        console.log('Note: Set DEVELOPER_CHAT_ID in environment variables to receive feedback directly.');
      }
      
      await bot.sendMessage(chatId, 'Thank you for your feedback! I\'ve forwarded it to my developer.');
    } catch (error) {
      console.error('Error sending feedback:', error);
      bot.sendMessage(chatId, 'Sorry, there was an error sending your feedback. Please try again later.');
    }
  });
  
  // Auto-remove listener after 5 minutes to prevent stacking
  setTimeout(() => {
    try {
      bot.removeTextListener(feedbackListener);
      bot.removeListener(feedbackListener);
    } catch (e) {
      // Ignore errors if listener is already removed
    }
  }, 5 * 60 * 1000); // 5 minutes
});

// View recent users command (developer only)
bot.onText(/\/users/, async (msg) => {
  // Only allow developer to use this command
  if (msg.from.id.toString() !== DEVELOPER_CHAT_ID) {
    return;
  }
  
  try {
    // Get users data from Redis
    const usersData = await redisClient.get('users');
    const users = usersData ? JSON.parse(usersData) : {};
    
    let response = '👥 *Recent Users*\n\n';
    
    // Convert to array and sort by last seen
    const userList = Object.entries(users)
      .map(([id, info]) => ({ 
        id, 
        ...info,
        firstName: info.firstName ? decrypt(info.firstName) : undefined,
        lastName: info.lastName ? decrypt(info.lastName) : undefined,
        username: info.username ? decrypt(info.username) : undefined,
        fullName: info.fullName ? decrypt(info.fullName) : undefined
      }))
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      .slice(0, 10); // Show only last 10 users
    
    if (userList.length === 0) {
      response += 'No users found.';
    } else {
      userList.forEach(user => {
        const name = user.fullName || user.username || `User ${user.id}`;
        const date = new Date(user.lastSeen).toLocaleDateString();
        response += `• [${name}](tg://user?id=${user.id}) (${user.id}) - ${date}\n`;
      });
    }
    
    await bot.sendMessage(DEVELOPER_CHAT_ID, response, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error fetching users:', error);
    await bot.sendMessage(DEVELOPER_CHAT_ID, '❌ Error fetching user list.');
  }
});

// Handle user replies to bot messages (for correcting analysis)
bot.on('message', async (msg) => {
  // Check if this message is a reply to another message
  if (!msg.reply_to_message) return;
  
  // Check if the reply is to a bot message (from this bot)
  if (msg.reply_to_message.from.id.toString() !== bot.options.polling.id.toString()) return;
  
  // Process the correction
  try {
    await processCorrection(msg);
  } catch (error) {
    console.error('Error processing correction:', error);
    // Don't send error message to avoid spamming the user
  }
});

console.log('🤖 Food Analyst Bot is running...');

// Test Redis connection
redisClient.on('connect', () => {
  console.log('✅ Connected to Redis successfully');
  
  // Test Redis read/write
  redisClient.set('test_key', 'test_value')
    .then(() => redisClient.get('test_key'))
    .then(value => {
      if (value === 'test_value') {
        console.log('✅ Redis read/write test passed');
      } else {
        console.log('❌ Redis read/write test failed');
      }
    })
    .catch(err => {
      console.error('❌ Redis read/write test error:', err);
    });
    
  // Test encryption/decryption
  const testData = 'This is a test string for encryption';
  const encrypted = encrypt(testData);
  const decrypted = decrypt(encrypted);
  
  if (testData === decrypted) {
    console.log('✅ Encryption/decryption test passed');
  } else {
    console.log('❌ Encryption/decryption test failed');
    console.log('Original:', testData);
    console.log('Encrypted:', encrypted);
    console.log('Decrypted:', decrypted);
  }
});