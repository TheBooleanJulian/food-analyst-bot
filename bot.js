require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  
  // Only respond to configured chat
  if (chatId.toString() !== process.env.CHAT_ID) {
    return;
  }

  try {
    await bot.sendMessage(chatId, '🔍 Analyzing your food...');
    
    // Get highest quality photo
    const photo = msg.photo[msg.photo.length - 1];
    const base64Image = await downloadImage(photo.file_id);
    
    // Analyze with Claude
    const nutrition = await analyzeFood(base64Image);
    
    // Format response
    const response = `🍽️ **${nutrition.food_name}**

📊 **Nutritional Information:**
- Calories: ${nutrition.calories} kcal
- Protein: ${nutrition.protein}g
- Carbs: ${nutrition.carbs}g
- Fat: ${nutrition.fat}g

📏 Serving: ${nutrition.serving_size}
🎯 Confidence: ${nutrition.confidence}

_Note: These are estimates based on visual analysis._`;

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
    
    // Format response
    const response = `🍽️ **${nutrition.food_name}**

📊 **Nutritional Information:**
- Calories: ${nutrition.calories} kcal
- Protein: ${nutrition.protein}g
- Carbs: ${nutrition.carbs}g
- Fat: ${nutrition.fat}g

📏 Serving: ${nutrition.serving_size}
🎯 Confidence: ${nutrition.confidence}

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
  if (chatId.toString() === process.env.CHAT_ID) {
    bot.sendMessage(
      chatId,
      '👋 Welcome to Food Analyst Bot!\n\n' +
      '📸 Send me a photo of your food and I\'ll analyze its nutritional content.\n\n' +
      'Powered by Claude AI 🤖'
    );
  }
});

console.log('🤖 Food Analyst Bot is running...');