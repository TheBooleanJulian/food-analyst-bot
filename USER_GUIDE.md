# Food Analyst Bot - User Guide

## Getting Started

To begin using the Food Analyst Bot, simply message [@foodanalystbot](https://t.me/foodanalystbot) on Telegram and send the command `/start`.

## How It Works

The Food Analyst Bot uses advanced AI to analyze photos of your food and provide detailed nutritional information. Simply send a photo of your meal, and the bot will respond with:
- Estimated calories
- Protein content
- Carbohydrate content
- Fat content
- Fiber content
- Hydration content
- Serving size information

## Basic Usage

### 1. Sending Food Photos
1. Open a chat with [@foodanalystbot](https://t.me/foodanalystbot)
2. Tap the paperclip icon or attachment button
3. Select a photo of your food
4. (Optional) Add a caption describing the food or drink
5. Send the photo to the bot
6. Wait for the nutritional analysis

Adding a caption helps the AI better understand what you're eating, especially for ambiguous images or specific preparations.

### 2. Viewing Analysis Results
After sending a photo, the bot will respond with:
- Food identification
- Nutritional breakdown (calories, protein, carbs, fat, fiber, hydration)
- Serving size information
- Confidence level of the analysis
- Your daily nutrition totals

## Available Commands

### Core Commands
- `/start` - Start the bot and get welcome message
- `/help` - Display help information and available commands

### Nutrition Tracking
- `/goals` - Set your daily nutrition goals
- `/summary` - Get today's nutrition summary
- `/progress` - Check your progress toward goals
- `/erase` - List and remove food entries from today's log
- `/leaderboard` or `/top` - View the nutrition leaderboard

### Feedback
- `/feedback` - Send bug reports or suggestions to the developer

## Leaderboard Competition

Join the nutrition competition to track your progress against other users:

### Viewing the Leaderboard
- Send `/leaderboard` or `/top` to see the current standings
- Rankings are based on how closely you meet your daily nutrition goals
- Perfect adherence to all goals equals 1000 points
- Deviations from goals reduce your score proportionally
- User names are masked for privacy (e.g., "Jo********")

### Scoring System
- 1000 points: Perfect adherence (all goals at 100%)
- 900 points: ±10% deviation from goals
- Lower scores: Greater deviation from targets
- Score calculated across all nutrition categories: calories, protein, carbs, fat, fiber, hydration

### Web Dashboard
Visit the web dashboard to view real-time health status and live leaderboard:
- Health monitoring of bot services
- Live leaderboard with masked user names
- Complete instructions for using the bot
- Updated every 30 seconds for health checks, every 5 minutes for leaderboard

## Setting Nutrition Goals

You can set personalized nutrition goals to track your daily intake:

1. Send `/goals` to the bot
2. Choose between manual entry or AI-guided setup
3. For manual entry, enter comma-separated values:
   ```
   calories, protein, carbs, fat, fiber, hydration
   ```
4. For AI-guided setup, answer questions about age, height, weight, goals, and activity level
5. Your goals will be saved and used for daily tracking

## Correcting Analysis Results

If the bot's analysis is incorrect, you can easily correct it:

1. Find the bot's analysis message
2. Tap and hold on the message
3. Select "Reply"
4. Type the correct food item and serving size
5. For example: "500ml coke" or "coffee 200ml"
6. Send your correction
7. The bot will update the analysis and your daily totals

## Removing Food Entries

If you accidentally logged a food item or want to remove an entry:

### Method 1: Using the /erase command
1. Send `/erase` to see a list of today's food entries
2. Note the number of the entry you want to remove
3. Send `/erase [number]` (e.g., `/erase 3`)

### Method 2: Replying to analysis messages
1. Find the bot's analysis message you want to remove
2. Tap and hold on the message
3. Select "Reply"
4. Type "remove", "delete", or "erase"
5. Send the message

The bot will remove that entry from your daily log and update your nutrition totals accordingly.

## Daily Summaries

The bot automatically sends you a daily summary at 11:59 PM with:
- All foods logged that day
- Total nutrition consumed
- Progress toward your goals
- Achievement notifications

## Privacy Notice

The Food Analyst Bot respects your privacy:
- Only your Telegram User ID is stored for data association
- Personal information (name, username) is encrypted
- Nutrition data belongs to you and is not shared
- You can stop using the bot at any time
- User names are masked in leaderboard (e.g., "Jo********")

## Troubleshooting

### Common Issues

**Bot doesn't respond to photos:**
- Ensure you're sending actual photos, not files
- Check that your photo is clear and shows food clearly
- Try sending a different photo

**Analysis seems incorrect:**
- Use the reply correction feature to update results
- Send a clearer photo from a different angle
- Include a common object for size reference

**Commands aren't working:**
- Make sure you're typing commands exactly as shown
- Commands are case-sensitive
- Try sending `/help` to see available commands

### Contact Support

If you're experiencing issues not covered here:
1. Use the `/feedback` command to send a message to the developer
2. Include details about the problem you're experiencing
3. Mention what you were trying to do when the issue occurred

## Tips for Best Results

1. **Photo Quality**: Take clear, well-lit photos of your food
2. **Single Items**: Focus on one food item per photo when possible
3. **Good Angles**: Capture the food from angles that show its full size
4. **Include Reference**: Adding a common object (like a fork) helps with size estimation
5. **Fresh Photos**: Send recent photos rather than old ones from your gallery
6. **Add Descriptions**: Use captions to describe what you're eating, especially for drinks, sauces, or unclear items

## Example Workflow

1. **Morning Coffee**:
   - Send photo of your coffee cup
   - Bot responds with nutritional analysis
   - Daily totals update automatically

2. **Lunch**:
   - Send photo of your lunch
   - Receive detailed nutritional breakdown
   - Check progress with `/progress`

3. **Snack Time**:
   - Send photo of your snack
   - Bot updates your daily totals
   - Receive achievement notifications if you're meeting goals

4. **End of Day**:
   - Receive automatic daily summary at 11:59 PM
   - Review your nutrition intake
   - Adjust tomorrow's goals if needed

5. **Making Corrections**:
   - If you accidentally logged something, reply to the message with "remove" or "delete"
   - Or use `/erase` to see a list and remove specific entries
   - Check updated totals with `/progress`

6. **Leaderboard Competition**:
   - Check `/leaderboard` to see how you're doing compared to others
   - Aim for perfect adherence to goals to earn higher scores
   - Visit the web dashboard for real-time updates

## Frequently Asked Questions

**Q: Is my data secure?**
A: Yes, your personal information is encrypted, and your nutrition data is private to you.

**Q: Can I use this in group chats or channels?**
A: Yes, the bot works in both direct messages and configured channels.

**Q: How accurate is the nutritional analysis?**
A: The AI provides estimates based on visual analysis. Actual values may vary.

**Q: What happens if I don't set goals?**
A: Default goals are used (2000 calories, 150g protein, 250g carbs, 70g fat, 25g fiber, 2000ml hydration).

**Q: Can I delete my data?**
A: Contact the developer through the `/feedback` command to request data deletion.

**Q: How do I join the leaderboard competition?**
A: Just use the bot regularly! Your scores are automatically calculated based on how closely you meet your daily goals.

**Q: Where can I view the web dashboard?**
A: The web dashboard URL will be provided by the bot developer for health monitoring and live leaderboard viewing.

## Troubleshooting Deployment Issues

If you encounter deployment issues:

### 502 Bad Gateway Errors
- This usually occurs when the service doesn't respond to health checks
- Ensure your deployment includes proper web server functionality
- Verify that your service listens on the correct port (usually 3000)

### Telegram Conflict Errors
- Error message: `409 Conflict: terminated by other getUpdates request`
- This occurs when multiple instances of the bot try to poll simultaneously
- Ensure only one instance of the bot is running at a time

### Redis Connection Issues
- Verify your Redis URL is correctly configured
- Check that your environment variables are properly set
- Confirm Redis service is running and accessible

## Terms of Use

By using the Food Analyst Bot, you agree that:
- The nutritional information provided is for estimation purposes only
- The bot is not a substitute for professional dietary advice
- You are responsible for the accuracy of any corrections you make
- The developers are not liable for any decisions made based on the bot's analysis

## Acknowledgments

This bot uses:
- Anthropic's Claude AI for image analysis
- Telegram's Bot API for messaging
- Redis for secure data storage