// One-off migration: the four Redis JSON blobs exported from Zeabur → schema food_analyst. Prints counts only.
//
//   node scripts/import-redis.mjs <secrets-dir> <conn-env-file>
//     reads food-nutrition.json, food-goals.json, food-users.json, food-links.json from <secrets-dir>
//
// - entries keep their stored date (Redis keyed days by UTC date) and timestamp
// - user names stay encrypted exactly as stored (same ENCRYPTION_KEY on the Worker)
// - the old single global goals object seeds every chat that has entries or a user row, so nobody's targets move
// - message links are attached to the entry with the same chat, food and calories (best effort; old ones only
//   matter for replying to old analyses)
// Idempotent: refuses to run if food_analyst.entries already has rows.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, envFile] = process.argv.slice(2);
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8') || 'null') || {};
const nutrition = load('food-nutrition.json');
const goals = load('food-goals.json');
const users = load('food-users.json');
const links = load('food-links.json');
const url = readFileSync(envFile, 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = postgres(url, { max: 1, ssl: 'require', prepare: false });

try {
  const existing = (await sql`select count(*)::int as n from food_analyst.entries`)[0].n;
  if (existing) throw new Error(`food_analyst.entries already has ${existing} rows; refusing to import twice`);
  await sql.begin(async (tx) => {
    const ids = []; // [{ chat, nutrition, id }]
    for (const [chat, days] of Object.entries(nutrition)) {
      for (const [date, entries] of Object.entries(days)) {
        for (const { timestamp, ...n } of entries) {
          const [{ id }] = await tx`insert into food_analyst.entries (chat_id, entry_date, logged_at, nutrition)
            values (${chat}, ${date}, ${timestamp || `${date}T12:00:00Z`}, ${tx.json(n)}) returning id`;
          ids.push({ chat, n, id });
        }
      }
    }
    for (const [userId, u] of Object.entries(users)) {
      await tx`insert into food_analyst.users (user_id, first_name_enc, last_name_enc, username_enc, full_name_enc, last_seen)
        values (${userId}, ${u.firstName || null}, ${u.lastName || null}, ${u.username || null}, ${u.fullName || null}, ${u.lastSeen || null})`;
    }
    const chats = new Set([...Object.keys(nutrition), ...Object.keys(users)]);
    const g = { calories: 2000, protein: 150, carbs: 250, fat: 70, fiber: 25, hydration: 2000, ...goals };
    for (const chat of chats) {
      await tx`insert into food_analyst.goals (chat_id, calories, protein, carbs, fat, fiber, hydration)
        values (${chat}, ${Math.round(g.calories)}, ${Math.round(g.protein)}, ${Math.round(g.carbs)}, ${Math.round(g.fat)}, ${Math.round(g.fiber)}, ${Math.round(g.hydration)})`;
    }
    let matched = 0;
    const used = new Set();
    for (const [messageId, l] of Object.entries(links)) {
      const chat = String(l.chatId);
      const hit = ids.find((x) => !used.has(x.id) && x.chat === chat && x.n.food_name === l.nutritionData?.food_name && x.n.calories === l.nutritionData?.calories);
      if (hit) { used.add(hit.id); matched++; }
      await tx`insert into food_analyst.message_links (chat_id, message_id, entry_id, nutrition, created_at)
        values (${chat}, ${messageId}, ${hit?.id ?? null}, ${tx.json(l.nutritionData || {})}, ${l.timestamp || new Date().toISOString()})
        on conflict (chat_id, message_id) do nothing`;
    }
    console.log(`entries ${ids.length} | users ${Object.keys(users).length} | goals seeded for ${chats.size} chats | links ${Object.keys(links).length} (${matched} matched to an entry)`);
  });
} catch (err) {
  console.error('import failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
