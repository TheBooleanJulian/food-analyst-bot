// Food Analyst logic, ported from zeabur-bot.js: correction parsing, the nutrition estimate table, prompts,
// message formats, leaderboard scoring, and the user-name encryption (same scheme and key as before, so the
// encrypted names migrated from Redis still decrypt). No I/O here, so it's all unit-testable.
import crypto from 'node:crypto';

export const TZ = 'Asia/Singapore';
export const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'hydration'];
export const DEFAULT_GOALS = { calories: 2000, protein: 150, carbs: 250, fat: 70, fiber: 25, hydration: 2000 };

// Singapore calendar date. (The old bot used UTC dates, so a Singapore day rolled over at 08:00.)
export const sgtDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);

// ── encryption (AES-256-CBC, key = the 32-char ENCRYPTION_KEY as raw bytes, "ivhex:cipherhex") ──────────────
export function encrypt(text, key) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  return iv.toString('hex') + ':' + Buffer.concat([cipher.update(text), cipher.final()]).toString('hex');
}

export function decrypt(text, key) {
  if (!text || !text.includes(':')) return text;
  try {
    const [ivHex, ...rest] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(rest.join(':'), 'hex')), decipher.final()]).toString();
  } catch {
    return text;
  }
}

// ── corrections ("500ml coke", "coffee 200ml") ───────────────────────────────────────────────────────────────
const FOOD_DB = {
  Coffee: [5, 0.3, 0, 0], Coke: [140, 0, 39, 0], Cola: [140, 0, 39, 0], Apple: [95, 0.5, 25, 0.3], Banana: [105, 1.3, 27, 0.4],
  Orange: [62, 1.2, 15, 0.2], Bread: [80, 3, 15, 1], Rice: [205, 4, 45, 0.4], Chicken: [165, 31, 0, 3.6], Beef: [250, 26, 0, 15],
  Fish: [120, 22, 0, 3], Salad: [15, 1, 3, 0.2], Pasta: [200, 7, 43, 1], Pizza: [285, 12, 36, 10], Burger: [295, 15, 30, 12],
  Sandwich: [220, 9, 25, 9], Milk: [103, 8, 12, 2.4], Cheese: [113, 7, 1, 9], Yogurt: [59, 10, 3.6, 0.4], 'Ice cream': [207, 3.5, 24, 11],
  Cake: [237, 2.3, 33, 10], Cookie: [78, 0.9, 10, 4], Chocolate: [155, 1.5, 15, 9], Water: [0, 0, 0, 0], Tea: [2, 0, 0.5, 0],
  Juice: [110, 0.5, 26, 0.3], Soda: [140, 0, 39, 0], Beer: [153, 1.6, 13, 0], Wine: [125, 0.1, 3.8, 0]
};
const DEFAULT_FOOD = [100, 5, 15, 3];
const UNIT = { ml: (q) => q / 250, l: (q) => q * 4, g: (q) => q / 100, kg: (q) => q * 10, oz: (q) => q / 4, cup: (q) => q, cups: (q) => q, tbsp: (q) => q / 16, tsp: (q) => q / 48, serving: () => 1 };

export function parseUserCorrection(input) {
  const lower = input.toLowerCase().trim();
  const m = lower.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|oz|cup|cups|tbsp|tsp)\b/);
  const quantity = m ? parseFloat(m[1]) : 1;
  const unit = m ? m[2] : 'serving';
  let foodName = (m ? lower.replace(m[0], '') : lower).trim().replace(/^\W+|\W+$/g, '') || 'Unknown food';
  foodName = foodName.charAt(0).toUpperCase() + foodName.slice(1);
  const base = Object.entries(FOOD_DB).find(([k]) => foodName.toLowerCase().includes(k.toLowerCase()))?.[1] || DEFAULT_FOOD;
  const mult = (UNIT[unit] || UNIT.serving)(quantity);
  return {
    food_name: foodName,
    calories: Math.round(base[0] * mult),
    protein: +(base[1] * mult).toFixed(1),
    carbs: +(base[2] * mult).toFixed(1),
    fat: +(base[3] * mult).toFixed(1),
    serving_size: m ? `${quantity}${unit}` : 'Standard serving'
  };
}

export const isRemoval = (text) => ['remove', 'delete', 'erase', 'cancel'].some((k) => (text || '').toLowerCase().includes(k));

// ── prompts ─────────────────────────────────────────────────────────────────────────────────────────────────
export function foodPrompt(caption) {
  let p = `Analyze this food image and provide nutritional estimates.

Return ONLY a JSON object with this exact format (no markdown, no explanation):
{
  "food_name": "name of the dish",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number,
  "hydration": number,
  "serving_size": "description",
  "confidence": "high/medium/low"
}

Base estimates on typical serving sizes. Be specific about the food identified. For hydration, estimate water content in ml. For fiber, estimate dietary fiber content in grams.`;
  if (caption) p += `\n\nThe user has provided the following description of the food: "${caption}". Please consider this information when analyzing the image.`;
  return p;
}

export function goalsPrompt(u) {
  return `Based on the following user information, calculate personalized daily nutrition goals.

User Profile:
- Age: ${u.age} years
- Height: ${u.height}
- Weight: ${u.weight}
- Ethnicity: ${u.ethnicity}
- Goal: ${u.goal} weight
- Activity Level: ${u.activity}

Please provide daily nutrition goals in this exact JSON format:
{
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number,
  "hydration": number
}

Consider:
- Basal metabolic rate (BMR) calculations
- Activity level multipliers
- Weight loss/maintenance/gain adjustments
- Ethnicity-appropriate dietary patterns
- Adequate fiber intake (25-35g daily)
- Proper hydration (2000-3000ml daily)

Return ONLY the JSON object with no additional text.`;
}

// First {...} in a model reply, parsed; null if none.
export function parseJsonReply(text) {
  const s = String(text || '').replace(/```json\n?|\n?```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

export function validNutrition(n) {
  return n && typeof n.food_name === 'string' && ['calories', 'protein', 'carbs', 'fat'].every((k) => Number.isFinite(Number(n[k])));
}

export function validGoals(g) {
  return g && NUTRIENTS.every((k) => Number.isFinite(Number(g[k])) && Number(g[k]) > 0);
}

// ── totals and messages (legacy Markdown, as before; ** became * so Telegram renders bold) ─────────────────
export function totalsOf(entries) {
  const t = Object.fromEntries(NUTRIENTS.map((k) => [k, 0]));
  for (const e of entries) for (const k of NUTRIENTS) t[k] += Number(e[k]) || 0;
  for (const k of NUTRIENTS) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}

const totalsBlock = (t, g) => [
  `- Calories: ${t.calories}/${g.calories} kcal`,
  `- Protein: ${t.protein}/${g.protein}g`,
  `- Carbs: ${t.carbs}/${g.carbs}g`,
  `- Fat: ${t.fat}/${g.fat}g`,
  `- Fiber: ${t.fiber}/${g.fiber}g`,
  `- Hydration: ${t.hydration}/${g.hydration}ml`
].join('\n');

export function formatAnalysis(n, totals, goals, { corrected = false, channel = false } = {}) {
  return `🍽️ *${n.food_name}*

📊 *Nutritional Information:*
- Calories: ${n.calories} kcal
- Protein: ${n.protein}g
- Carbs: ${n.carbs}g
- Fat: ${n.fat}g
- Fiber: ${n.fiber || 0}g
- Hydration: ${n.hydration || 0}ml

📏 Serving: ${n.serving_size}
🎯 Confidence: ${corrected ? 'manually corrected' : n.confidence}

📊 *Today's Totals:*
${totalsBlock(totals, goals)}

_${corrected ? 'Note: Updated based on user correction.' : 'Note: These are estimates based on visual analysis.'}_${channel ? '' : '\nPowered by _Claude AI 🤖_'}`;
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function formatSummary(date, entries, totals, goals) {
  const lines = [`🍽️ *Daily Nutrition Summary* (${date})`, ''];
  entries.forEach((e, i) => lines.push(`${i + 1}. ${e.food_name} - ${e.calories} kcal`));
  lines.push('', '📊 *Total Nutrition:*', totalsBlock(totals, goals), '', '📈 *Progress:*');
  lines.push(...NUTRIENTS.map((k) => `- ${k[0].toUpperCase() + k.slice(1)}: ${pct(totals[k], goals[k])}%`));
  return lines.join('\n');
}

export function formatProgress(totals, goals) {
  const unit = { calories: ' kcal', hydration: 'ml' };
  let r = '📈 *Nutrition Progress*\n\n' + NUTRIENTS.map((k) =>
    `- ${k[0].toUpperCase() + k.slice(1)}: ${totals[k]}/${goals[k]}${unit[k] || 'g'} (${pct(totals[k], goals[k])}%)`).join('\n') + '\n\n';
  const c = pct(totals.calories, goals.calories);
  r += c >= 100 ? "🎉 You've reached your calorie goal!" : c >= 90 ? "🏃 Almost there! You're close to your calorie goal." : c >= 50 ? '👍 Good progress on your calories!' : '🚀 Keep going!';
  return r;
}

export const formatGoals = (g, title = '✅ Nutrition goals updated!\n\n🎯 Daily Goals:') =>
  `${title}\n- Calories: ${g.calories} kcal\n- Protein: ${g.protein}g\n- Carbs: ${g.carbs}g\n- Fat: ${g.fat}g\n- Fiber: ${g.fiber}g\n- Hydration: ${g.hydration}ml`;

// ── leaderboard: 1000 = every goal at exactly 100% ─────────────────────────────────────────────────────────
export function score(totals, goals) {
  const percentages = Object.fromEntries(NUTRIENTS.map((k) => [k, goals[k] ? totals[k] / goals[k] : 0]));
  const avgDev = NUTRIENTS.reduce((s, k) => s + Math.abs(percentages[k] - 1), 0) / NUTRIENTS.length;
  return { score: Math.max(0, Math.round(1000 - avgDev * 1000)), percentages };
}

export function maskUserName(name) {
  if (!name || name.length <= 3) return name || 'Anonymous';
  return name[0] + '*'.repeat(Math.max(1, name.length - 2)) + name[name.length - 1];
}

export const breakdown = (p) =>
  `cal:${Math.round(p.calories * 100)}% prot:${Math.round(p.protein * 100)}% carbs:${Math.round(p.carbs * 100)}% fats:${Math.round(p.fat * 100)}% fib:${Math.round(p.fiber * 100)}% hyd:${Math.round(p.hydration * 100)}%`;
