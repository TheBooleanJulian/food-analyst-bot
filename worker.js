// Food Analyst Bot on Cloudflare Workers (replaces zeabur-bot.js + Redis on Zeabur).
//
//   POST /webhook   Telegram updates (secret_token checked). Photos are analysed through thebooleanjulian-llm
//                   (use case food-vision); replies to an analysis correct it ("500ml coke") or remove it ("remove").
//   cron            23:59 SGT daily summary to every chat that logged food today (cron 59 15 * * * UTC)
//   GET  /          dashboard (web/index.html, Julian Unified UI)    /status  bot-core status page
//   GET  /healthz   bot-core health JSON (fan-out gate)             /api/leaderboard /api/stats /api/health
//
// Data: schema food_analyst in the shared Supabase project via Hyperdrive. Changes from the old bot, on purpose:
// days are Singapore dates; goals are per chat (were one global object); replies are linked to the exact entry
// (corrections/removals by reply never worked before); multi-step questions are stored, not in-memory listeners.
import { log, api, verifyWebhook, parseCommand, healthz, statusPage, serveBrand } from 'thebooleanjulian-bot-core';
import { withDb } from 'thebooleanjulian-bot-core/db';
import {
  DEFAULT_GOALS, NUTRIENTS, sgtDate, encrypt, decrypt, parseUserCorrection, isRemoval, foodPrompt, goalsPrompt,
  parseJsonReply, validNutrition, validGoals, totalsOf, formatAnalysis, formatSummary, formatProgress, formatGoals,
  score, maskUserName, breakdown
} from './food.js';

const FLOW_TTL_MS = { goals_ai: 10 * 60e3, default: 5 * 60e3 };

// ── storage ────────────────────────────────────────────────────────────────────────────────────────────────
const store = {
  entries: async (sql, chat, date) =>
    (await sql`select id, nutrition from food_analyst.entries where chat_id = ${chat} and entry_date = ${date} order by logged_at, id`)
      .map((r) => ({ id: r.id, ...r.nutrition })),
  addEntry: async (sql, chat, date, n) =>
    (await sql`insert into food_analyst.entries (chat_id, entry_date, nutrition) values (${chat}, ${date}, ${sql.json(n)}) returning id`)[0].id,
  deleteEntry: async (sql, id) => (await sql`delete from food_analyst.entries where id = ${id} returning nutrition`)[0]?.nutrition || null,
  patchEntry: async (sql, id, patch) =>
    (await sql`update food_analyst.entries set nutrition = nutrition || ${sql.json(patch)} where id = ${id} returning chat_id, entry_date`)[0] || null,
  goals: async (sql, chat) => {
    const r = (await sql`select calories, protein, carbs, fat, fiber, hydration from food_analyst.goals where chat_id = ${chat}`)[0];
    return r ? { ...r } : { ...DEFAULT_GOALS };
  },
  setGoals: async (sql, chat, g) =>
    sql`insert into food_analyst.goals (chat_id, calories, protein, carbs, fat, fiber, hydration, updated_at)
        values (${chat}, ${g.calories}, ${g.protein}, ${g.carbs}, ${g.fat}, ${g.fiber}, ${g.hydration}, now())
        on conflict (chat_id) do update set calories = excluded.calories, protein = excluded.protein, carbs = excluded.carbs,
        fat = excluded.fat, fiber = excluded.fiber, hydration = excluded.hydration, updated_at = now()`,
  saveUser: async (sql, env, from, profile = null) => {
    const k = env.ENCRYPTION_KEY;
    const full = from.first_name + (from.last_name ? ` ${from.last_name}` : '');
    await sql`insert into food_analyst.users (user_id, first_name_enc, last_name_enc, username_enc, full_name_enc, profile, last_seen)
      values (${String(from.id)}, ${encrypt(from.first_name, k) || null}, ${encrypt(from.last_name, k) || null},
              ${encrypt(from.username, k) || null}, ${encrypt(full, k) || null}, ${sql.json(profile || {})}, now())
      on conflict (user_id) do update set first_name_enc = excluded.first_name_enc, last_name_enc = excluded.last_name_enc,
        username_enc = excluded.username_enc, full_name_enc = excluded.full_name_enc, last_seen = now(),
        profile = case when ${profile !== null} then excluded.profile else food_analyst.users.profile end`;
  },
  users: async (sql) => sql`select user_id, first_name_enc, last_name_enc, username_enc, full_name_enc, last_seen from food_analyst.users order by last_seen desc nulls last`,
  link: async (sql, chat, msgId) => (await sql`select entry_id, nutrition from food_analyst.message_links where chat_id = ${chat} and message_id = ${String(msgId)}`)[0] || null,
  saveLink: async (sql, chat, msgId, entryId, n) =>
    sql`insert into food_analyst.message_links (chat_id, message_id, entry_id, nutrition) values (${chat}, ${String(msgId)}, ${entryId}, ${sql.json(n)})
        on conflict (chat_id, message_id) do update set entry_id = excluded.entry_id, nutrition = excluded.nutrition`,
  conversation: async (sql, chat, user) => (await sql`select flow, step, state, updated_at from food_analyst.conversations where chat_id = ${chat} and user_id = ${user}`)[0] || null,
  setConversation: async (sql, chat, user, flow, step, state = {}) =>
    sql`insert into food_analyst.conversations (chat_id, user_id, flow, step, state, updated_at) values (${chat}, ${user}, ${flow}, ${step}, ${sql.json(state)}, now())
        on conflict (chat_id, user_id) do update set flow = excluded.flow, step = excluded.step, state = excluded.state, updated_at = now()`,
  clearConversation: async (sql, chat, user) => sql`delete from food_analyst.conversations where chat_id = ${chat} and user_id = ${user}`,
  chatsOn: async (sql, date) => (await sql`select distinct chat_id from food_analyst.entries where entry_date = ${date}`).map((r) => r.chat_id)
};

// ── telegram helpers ───────────────────────────────────────────────────────────────────────────────────────
// Legacy Markdown breaks on stray _ or * (food names, user text): retry as plain text instead of losing the reply.
async function send(env, chatId, text, extra = {}) {
  try {
    return await api(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });
  } catch (err) {
    if (err.status === 400 && /parse entities/i.test(err.message)) return api(env, 'sendMessage', { chat_id: chatId, text, ...extra });
    throw err;
  }
}
const edit = (env, chatId, messageId, text) =>
  api(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown' })
    .catch(() => api(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text }).catch(() => {}));

const authorized = (env, msg) => msg.chat.type === 'private' || String(msg.chat.id) === String(env.CHAT_ID);

async function llm(env, useCase, content) {
  const res = await env.LLM.fetch('https://llm/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TBJ-Service': 'food-analyst', 'X-TBJ-Use-Case': useCase },
    body: JSON.stringify({ messages: [{ role: 'user', content }] })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`gateway ${res.status} ${data?.error?.code || ''} trace ${res.headers.get('x-tbj-trace-id') || '-'}`);
  return data.choices?.[0]?.message?.content || '';
}

async function photoDataUrl(env, fileId) {
  const file = await api(env, 'getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
  if (!res.ok) throw new Error(`file download ${res.status}`);
  const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}

// ── features ───────────────────────────────────────────────────────────────────────────────────────────────
async function analysePhoto(env, sql, msg, isChannel) {
  const chat = String(msg.chat.id);
  const replyTo = isChannel ? { reply_to_message_id: msg.message_id } : {};
  await api(env, 'sendMessage', { chat_id: chat, text: '🔍 Analyzing your food...', ...replyTo });
  try {
    const image = await photoDataUrl(env, msg.photo[msg.photo.length - 1].file_id);
    const nutrition = parseJsonReply(await llm(env, 'food-vision', [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: foodPrompt(msg.caption) }]));
    if (!validNutrition(nutrition)) throw new Error('model reply was not nutrition JSON');
    for (const k of NUTRIENTS) nutrition[k] = Number(nutrition[k]) || 0;
    const date = sgtDate();
    const entryId = await store.addEntry(sql, chat, date, nutrition);
    const [entries, goals] = await Promise.all([store.entries(sql, chat, date), store.goals(sql, chat)]);
    const sent = await send(env, chat, formatAnalysis(nutrition, totalsOf(entries), goals, { channel: isChannel }), replyTo);
    await store.saveLink(sql, chat, sent.message_id, entryId, nutrition);
  } catch (err) {
    log.error('photo analysis failed', { error: err.message });
    await api(env, 'sendMessage', { chat_id: chat, text: '❌ Sorry, I had trouble analyzing that image. Please try again.', ...replyTo });
  }
}

async function handleReply(env, sql, msg) {
  const chat = String(msg.chat.id);
  const link = await store.link(sql, chat, msg.reply_to_message.message_id);
  if (!link) return false; // not a reply to one of our analyses
  if (msg.from) await store.saveUser(sql, env, msg.from);
  const opts = { reply_to_message_id: msg.message_id };
  if (isRemoval(msg.text)) {
    const removed = link.entry_id ? await store.deleteEntry(sql, link.entry_id) : null;
    if (!removed) { await send(env, chat, '❌ Could not find the original analysis to remove.', opts); return true; }
    const [entries, goals] = await Promise.all([store.entries(sql, chat, sgtDate()), store.goals(sql, chat)]);
    const t = totalsOf(entries);
    await send(env, chat, `✅ Removed: ${removed.food_name}\n\n📊 *Updated Nutrition Totals:*\n- Calories: ${t.calories}/${goals.calories} kcal\n- Protein: ${t.protein}/${goals.protein}g\n- Carbs: ${t.carbs}/${goals.carbs}g\n- Fat: ${t.fat}/${goals.fat}g`, opts);
    await edit(env, chat, msg.reply_to_message.message_id, '❌ *Entry Removed*\n\nThis food entry has been removed from your daily log.');
    return true;
  }
  const correction = parseUserCorrection(msg.text);
  const updated = link.entry_id ? await store.patchEntry(sql, link.entry_id, correction) : null;
  if (!updated) { await send(env, chat, '❌ Could not find the original analysis to update.', opts); return true; }
  await send(env, chat, `✅ Analysis updated successfully!\n\n🍽️ Food: ${correction.food_name}\n📊 Calories: ${correction.calories} kcal\n🥩 Protein: ${correction.protein}g\n🍞 Carbs: ${correction.carbs}g\n🧈 Fat: ${correction.fat}g\n📏 Serving: ${correction.serving_size}`, opts);
  const [entries, goals] = await Promise.all([store.entries(sql, chat, sgtDate()), store.goals(sql, chat)]);
  await edit(env, chat, msg.reply_to_message.message_id, formatAnalysis({ ...link.nutrition, ...correction }, totalsOf(entries), goals, { corrected: true }));
  return true;
}

async function leaderboard(env, sql) {
  const date = sgtDate();
  const users = Object.fromEntries((await store.users(sql)).map((u) => [u.user_id, u]));
  const rows = [];
  for (const chat of await store.chatsOn(sql, date)) {
    const [entries, goals] = await Promise.all([store.entries(sql, chat, date), store.goals(sql, chat)]);
    const totals = totalsOf(entries);
    const { score: s, percentages } = score(totals, goals);
    if (s <= 0) continue;
    const u = users[chat];
    const k = env.ENCRYPTION_KEY;
    const name = u ? (decrypt(u.full_name_enc, k) || [decrypt(u.first_name_enc, k), decrypt(u.last_name_enc, k)].filter(Boolean).join(' ') || decrypt(u.username_enc, k)) : `User ${chat}`;
    rows.push({ userId: chat, displayName: maskUserName(name), score: s, percentages, totals, goals });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.map((r, i) => ({ ...r, rank: i + 1, details: breakdown(r.percentages) }));
}

// ── multi-step questions (stored per chat + user) ──────────────────────────────────────────────────────────
const AI_STEPS = {
  age: { next: 'height', ask: '📏 What is your height?\n\nPlease specify in centimeters (cm) or feet and inches.\nExample: `175` or `5\'10"`', check: (t) => { const a = parseInt(t, 10); return a >= 13 && a <= 120 ? a : null; }, bad: '❌ Please enter a valid age between 13 and 120.' },
  height: { next: 'weight', ask: '⚖️ What is your current weight?\n\nPlease specify in kilograms (kg) or pounds (lbs).\nExample: `70` or `154 lbs`', check: (t) => t.trim() },
  weight: { next: 'ethnicity', ask: '🌍 What is your ethnicity?\n\nThis helps provide culturally appropriate recommendations.\nExample: `Asian`, `Caucasian`, `African`, `Hispanic`, etc.', check: (t) => t.trim() },
  ethnicity: { next: 'goal', ask: '🎯 What are your weight goals?\n\nPlease choose one:\n`lose` - Lose weight\n`maintain` - Maintain current weight\n`gain` - Gain weight', check: (t) => t.trim() },
  goal: { next: 'activity', ask: '🏃 What is your activity level?\n\nPlease choose one:\n`sedentary` - Little to no exercise\n`light` - Light exercise 1-3 days/week\n`moderate` - Moderate exercise 3-5 days/week\n`active` - Hard exercise 6-7 days/week\n`very active` - Very hard exercise, physical job', check: (t) => (['lose', 'maintain', 'gain'].includes(t.toLowerCase().trim()) ? t.toLowerCase().trim() : null), bad: '❌ Please choose `lose`, `maintain`, or `gain`.' },
  activity: { next: null, check: (t) => (['sedentary', 'light', 'moderate', 'active', 'very active'].includes(t.toLowerCase().trim()) ? t.toLowerCase().trim() : null), bad: '❌ Please choose from the listed activity levels.' }
};

async function continueConversation(env, sql, msg, conv) {
  const chat = String(msg.chat.id);
  const user = String(msg.from?.id ?? 'channel');
  const text = msg.text || '';
  const ttl = FLOW_TTL_MS[conv.flow] || FLOW_TTL_MS.default;
  if (Date.now() - new Date(conv.updated_at).getTime() > ttl) {
    await store.clearConversation(sql, chat, user);
    return false; // expired: treat the message normally
  }
  if (conv.flow === 'goals_choice') {
    const c = text.toLowerCase().trim();
    if (c === 'manual') {
      await store.setConversation(sql, chat, user, 'goals_manual', 'values');
      { await send(env, chat, '🔢 *Manual Goal Entry*\n\nPlease enter your daily nutrition goals in this format (comma separated):\n`calories, protein, carbs, fat, fiber, hydration`\n\nExample: `2000, 150, 250, 70, 25, 2000`\n\nOr type `/cancel` to cancel.'); return true; }
    }
    if (c === 'ai') {
      await store.setConversation(sql, chat, user, 'goals_ai', 'age', {});
      { await send(env, chat, "🤖 *AI-Guided Nutrition Goals*\n\nLet's collect some information to calculate personalized recommendations.\n\n❓ What is your age? (in years)"); return true; }
    }
    { await send(env, chat, '❌ Invalid choice. Please reply with `manual` or `ai`, or `/cancel` to cancel.'); return true; }
  }
  if (conv.flow === 'goals_manual') {
    const parts = text.split(',').map((p) => parseInt(p.trim(), 10)).filter((n) => !Number.isNaN(n));
    if (parts.length !== 6) { await send(env, chat, '❌ Invalid format. Please enter exactly 6 numbers separated by commas:\n`calories, protein, carbs, fat, fiber, hydration`\n\nExample: `2000, 150, 250, 70, 25, 2000`'); return true; }
    const goals = Object.fromEntries(NUTRIENTS.map((k, i) => [k, parts[i]]));
    await store.setGoals(sql, chat, goals);
    await store.clearConversation(sql, chat, user);
    { await api(env, 'sendMessage', { chat_id: chat, text: formatGoals(goals) }); return true; }
  }
  if (conv.flow === 'goals_ai') {
    const step = AI_STEPS[conv.step];
    const value = step.check(text);
    if (value === null || value === '') { await send(env, chat, step.bad || '❌ Please try again.'); return true; }
    const state = { ...conv.state, [conv.step]: value };
    if (step.next) {
      await store.setConversation(sql, chat, user, 'goals_ai', step.next, state);
      { await send(env, chat, step.ask); return true; }
    }
    await store.clearConversation(sql, chat, user);
    await api(env, 'sendMessage', { chat_id: chat, text: '🧠 Calculating personalized nutrition goals with Claude AI...' });
    try {
      const goals = parseJsonReply(await llm(env, 'food-goals', goalsPrompt(state)));
      if (!validGoals(goals)) throw new Error('model reply was not goals JSON');
      const clean = Object.fromEntries(NUTRIENTS.map((k) => [k, Math.round(Number(goals[k]))]));
      await store.setGoals(sql, chat, clean);
      if (msg.from) await store.saveUser(sql, env, msg.from, state);
      await send(env, chat, formatGoals(clean, '✅ AI-calculated nutrition goals updated!\n\n🎯 Personalized Daily Goals:') + '\n\n_Calculated based on your profile and goals_');
    } catch (err) {
      log.error('ai goals failed', { error: err.message });
      await api(env, 'sendMessage', { chat_id: chat, text: '❌ Sorry, there was an error processing the AI recommendations. Please try the manual entry option instead.' });
    }
    return true;
  }
  if (conv.flow === 'feedback') {
    await store.clearConversation(sql, chat, user);
    const from = msg.from || {};
    const who = `${from.first_name || ''} ${from.last_name || ''}`.trim() || from.username || `User ${from.id}`;
    if (msg.from) await store.saveUser(sql, env, msg.from);
    if (env.DEVELOPER_CHAT_ID) {
      await send(env, env.DEVELOPER_CHAT_ID, `📬 *New Feedback*\n\nFrom: [${who}](tg://user?id=${from.id}) (${from.id})\nDate: ${new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}\n\n📝 Message:\n${text}\n\n🔄 *To Respond:*\nClick on the user's name above to open a chat with them directly.`);
    } else {
      log.info('feedback received, DEVELOPER_CHAT_ID not set');
    }
    { await api(env, 'sendMessage', { chat_id: chat, text: "Thank you for your feedback! I've forwarded it to my developer." }); return true; }
  }
  return false;
}

// ── commands ───────────────────────────────────────────────────────────────────────────────────────────────
const HELP = '🤖 *Food Analyst Bot Commands*\n\n📸 *Food Analysis:*\nSimply send a photo of your food to get nutritional information including fiber and hydration content\n\n📋 *Tracking Commands:*\n/goals - Set your daily nutrition goals (calories, protein, carbs, fat, fiber, hydration)\n/summary - Get today\'s nutrition summary including fiber and hydration\n/progress - Check your progress toward all nutrition goals\n/erase - List and remove food entries\n\n🏆 *Leaderboard Commands:*\n/leaderboard or /top - View the nutrition leaderboard with masked names\n\n📬 *Feedback Commands:*\n/feedback - Send bug reports or suggestions to the developer\n\nℹ️ *Usage Tips:*\n- Works in both direct messages and channel posts\n- Reply to an analysis with a correction like `500ml coke`, or with `remove` to delete it\n\nPowered by Claude AI 🤖';

async function handleCommand(env, sql, msg, cmd) {
  const chat = String(msg.chat.id);
  const user = String(msg.from?.id ?? 'channel');
  if (cmd.name === 'users') {
    if (String(msg.from?.id) !== String(env.DEVELOPER_CHAT_ID)) return;
    const k = env.ENCRYPTION_KEY;
    const rows = (await store.users(sql)).slice(0, 10);
    const lines = rows.map((u) => `• [${decrypt(u.full_name_enc, k) || decrypt(u.username_enc, k) || `User ${u.user_id}`}](tg://user?id=${u.user_id}) (${u.user_id}) - ${u.last_seen ? new Date(u.last_seen).toLocaleDateString('en-SG') : '?'}`);
    return send(env, env.DEVELOPER_CHAT_ID, '👥 *Recent Users*\n\n' + (lines.join('\n') || 'No users found.'));
  }
  if (!authorized(env, msg)) return;
  switch (cmd.name) {
    case 'start':
      return api(env, 'sendMessage', { chat_id: chat, text: "👋 Welcome to Food Analyst Bot!\n\n📸 Send me a photo of your food and I'll analyze its nutritional content.\n\n📋 For available commands, type /help\n\n*Works in both direct messages and channel posts!*\n\nPowered by Claude AI 🤖" });
    case 'help':
      return send(env, chat, HELP);
    case 'cancel':
      await store.clearConversation(sql, chat, user);
      return api(env, 'sendMessage', { chat_id: chat, text: 'Cancelled.' });
    case 'goals':
      await store.setConversation(sql, chat, user, 'goals_choice', 'choice');
      return send(env, chat, "🎯 *Set Nutrition Goals*\n\nChoose how you'd like to set your daily nutrition goals:\n\n1️⃣ *Manual Entry*\nEnter your own target values for all 6 nutrients\n\n2️⃣ *AI-Guided*\nAnswer a few questions and let Claude AI calculate personalized recommendations\n\nPlease reply with:\n`manual` - for manual entry\n`ai` - for AI-guided recommendations\n`/cancel` - to cancel");
    case 'summary': {
      const date = sgtDate();
      const [entries, goals] = await Promise.all([store.entries(sql, chat, date), store.goals(sql, chat)]);
      return entries.length ? send(env, chat, formatSummary(date, entries, totalsOf(entries), goals)) : api(env, 'sendMessage', { chat_id: chat, text: '📭 No food entries recorded today.' });
    }
    case 'progress': {
      const [entries, goals] = await Promise.all([store.entries(sql, chat, sgtDate()), store.goals(sql, chat)]);
      return send(env, chat, formatProgress(totalsOf(entries), goals));
    }
    case 'feedback':
      await store.setConversation(sql, chat, user, 'feedback', 'message');
      return send(env, chat, "📬 *Send Feedback*\n\nPlease type your bug report or suggestion and I'll forward it to my developer @JulianC97.\n\nYou can also contact the developer directly on Telegram: @JulianC97\n\nOr type /cancel to cancel.");
    case 'erase': {
      if (msg.from) await store.saveUser(sql, env, msg.from);
      const date = sgtDate();
      const entries = await store.entries(sql, chat, date);
      if (!cmd.args) {
        if (!entries.length) return api(env, 'sendMessage', { chat_id: chat, text: '📭 No food entries recorded today.' });
        return send(env, chat, `📝 *Today's Food Entries* (${date})\n\n` + entries.map((e, i) => `${i + 1}. ${e.food_name} - ${e.calories} kcal`).join('\n') +
          '\n\nTo remove an entry, send:\n`/erase [number]`\nOr reply to any food analysis with:\n`remove`, `delete`, or `erase`');
      }
      const n = /^\d+$/.test(cmd.args) ? parseInt(cmd.args, 10) - 1 : -1;
      if (n < 0) return send(env, chat, '❌ Please specify a valid entry number. Use `/erase` to see the current list.');
      if (n >= entries.length) return send(env, chat, '❌ Invalid entry number. Please use `/erase` to see the current list.');
      const removed = await store.deleteEntry(sql, entries[n].id);
      const [left, goals] = await Promise.all([store.entries(sql, chat, date), store.goals(sql, chat)]);
      const t = totalsOf(left);
      return send(env, chat, `✅ Removed: ${removed.food_name}\n\n📊 *Updated Nutrition Totals:*\n- Calories: ${t.calories}/${goals.calories} kcal\n- Protein: ${t.protein}/${goals.protein}g\n- Carbs: ${t.carbs}/${goals.carbs}g\n- Fat: ${t.fat}/${goals.fat}g\n- Fiber: ${t.fiber}/${goals.fiber}g\n- Hydration: ${t.hydration}/${goals.hydration}ml`);
    }
    case 'leaderboard':
    case 'top': {
      const rows = await leaderboard(env, sql);
      if (!rows.length) return api(env, 'sendMessage', { chat_id: chat, text: '📭 No users have recorded nutrition data today.' });
      let text = '🏆 *Nutrition Leaderboard*\n\n';
      rows.slice(0, 10).forEach((r) => {
        text += `${['🥇', '🥈', '🥉'][r.rank - 1] || '  '} ${r.rank}. ${r.displayName}: ${r.score}\n`;
        if (r.rank <= 3) text += `   └─ ${r.details}\n`;
      });
      return send(env, chat, text + '\n💡 *Scoring:* 1000 = perfect (all goals at 100%), lower scores = more deviation from goals');
    }
  }
}

async function handleUpdate(update, env) {
  const msg = update.message || update.channel_post;
  if (!msg) return;
  const isChannel = Boolean(update.channel_post);
  await withDb(env, null, async (sql) => {
    try {
      const cmd = msg.text ? parseCommand(msg.text, env.BOT_USERNAME) : null;
      if (cmd) return await handleCommand(env, sql, msg, cmd);
      if (msg.photo) return authorized(env, msg) ? await analysePhoto(env, sql, msg, isChannel) : undefined;
      if (!msg.text || !authorized(env, msg)) return;
      if (msg.reply_to_message && (await handleReply(env, sql, msg))) return;
      const conv = await store.conversation(sql, String(msg.chat.id), String(msg.from?.id ?? 'channel'));
      if (conv) await continueConversation(env, sql, msg, conv);
    } catch (err) {
      log.error('update failed', { update_id: update.update_id, error: err.message });
    }
  });
}

// ── http + cron ────────────────────────────────────────────────────────────────────────────────────────────
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function dbStatus(env) {
  try {
    return await withDb(env, null, async (sql) => ({
      checks: { postgres: 'ok' },
      today: (await sql`select count(*)::int as n from food_analyst.entries where entry_date = ${sgtDate()}`)[0].n,
      users: (await sql`select count(*)::int as n from food_analyst.users`)[0].n
    }));
  } catch (err) {
    return { checks: { postgres: `FAIL: ${String(err.message).replace(/postgres(ql)?:\/\/\S+/g, '<conn>')}` }, today: null, users: null };
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const brand = serveBrand(request);
    if (brand) return brand;

    if (pathname === '/webhook' && request.method === 'POST') {
      if (!verifyWebhook(request, env)) return new Response('forbidden', { status: 403 });
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleUpdate(update, env));
      return new Response('ok');
    }
    if (pathname === '/healthz') {
      const s = await dbStatus(env);
      return healthz(env, { checks: { ...s.checks, encryption_key: env.ENCRYPTION_KEY?.length === 32 ? 'ok' : 'FAIL: ENCRYPTION_KEY must be 32 chars' }, extra: { entries_today: s.today } });
    }
    if (pathname === '/status') {
      const s = await dbStatus(env);
      return statusPage(env, {
        name: 'Food Analyst Bot', username: '@FoodAnalystBot', icon: '🍽️',
        description: 'Send a food photo, get a nutrition estimate; track daily goals and a leaderboard.',
        ok: Object.values(s.checks).every((v) => v === 'ok'),
        metrics: { 'Entries today': s.today ?? '—', 'Users': s.users ?? '—' },
        commands: [['/goals', 'Set daily goals'], ['/summary', "Today's summary"], ['/progress', 'Progress to goals'], ['/erase', 'Remove entries'], ['/leaderboard', 'Leaderboard'], ['/feedback', 'Feedback']],
        sections: [{ title: 'Schedule', html: 'Daily summary: <b>23:59 SGT</b> to every chat that logged food that day' }]
      });
    }
    if (pathname === '/health') return json({ status: 'OK', message: 'Service is running', timestamp: new Date().toISOString() });
    if (pathname === '/api/health') {
      const s = await dbStatus(env);
      return json({ timestamp: new Date().toISOString(), services: {
        database: { status: s.checks.postgres === 'ok' ? 'online' : 'offline', message: s.checks.postgres === 'ok' ? 'Connected successfully' : 'Connection failed' },
        telegram: { status: env.BOT_TOKEN ? 'online' : 'warning', message: env.BOT_TOKEN ? 'Token configured' : 'Token not configured' },
        ai: { status: env.LLM ? 'online' : 'warning', message: 'Via thebooleanjulian-llm' },
        web: { status: 'online', message: 'Web interface operational' }
      } });
    }
    if (pathname === '/api/leaderboard') {
      try {
        const rows = await withDb(env, null, (sql) => leaderboard(env, sql));
        return json({ timestamp: new Date().toISOString(), leaderboard: rows.map(({ userId, ...r }) => r), totalUsers: rows.length });
      } catch (err) {
        return json({ error: 'Failed to generate leaderboard' }, 500);
      }
    }
    if (pathname === '/api/stats') {
      const s = await dbStatus(env);
      return json({ timestamp: new Date().toISOString(), totalUsers: s.users, todayEntries: s.today });
    }
    return env.ASSETS.fetch(request);
  },

  // 23:59 SGT: today's summary to every chat that logged food today.
  async scheduled(event, env) {
    const date = sgtDate();
    await withDb(env, null, async (sql) => {
      let sent = 0;
      for (const chat of await store.chatsOn(sql, date)) {
        try {
          const [entries, goals] = await Promise.all([store.entries(sql, chat, date), store.goals(sql, chat)]);
          if (entries.length) { await send(env, chat, formatSummary(date, entries, totalsOf(entries), goals)); sent++; }
        } catch (err) {
          log.error('daily summary failed', { error: err.message });
        }
      }
      log.info('daily summaries', { date, sent });
    });
  }
};

export { store, handleUpdate, leaderboard };
