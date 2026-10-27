// node --test   worker.js against fake Telegram (fetch), a fake LLM gateway binding and an in-memory Postgres stand-in.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker.js';

let sent, realFetch, llmCalls;

// Interprets exactly the queries worker.js issues (matched by their leading words).
function fakeDb() {
  const db = { entries: [], goals: new Map(), users: new Map(), links: new Map(), convs: new Map(), nextId: 1 };
  const sql = async (strings, ...v) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    if (q.startsWith('select id, nutrition from food_analyst.entries')) return db.entries.filter((e) => e.chat_id === v[0] && e.entry_date === v[1]).map(({ id, nutrition }) => ({ id, nutrition }));
    if (q.startsWith('insert into food_analyst.entries')) { const id = db.nextId++; db.entries.push({ id, chat_id: v[0], entry_date: v[1], nutrition: v[2] }); return [{ id }]; }
    if (q.startsWith('delete from food_analyst.entries')) { const i = db.entries.findIndex((e) => e.id === v[0]); if (i < 0) return []; const [e] = db.entries.splice(i, 1); return [{ nutrition: e.nutrition }]; }
    if (q.startsWith('update food_analyst.entries')) { const e = db.entries.find((x) => x.id === v[1]); if (!e) return []; e.nutrition = { ...e.nutrition, ...v[0] }; return [{ chat_id: e.chat_id, entry_date: e.entry_date }]; }
    if (q.startsWith('select calories, protein')) return db.goals.has(v[0]) ? [db.goals.get(v[0])] : [];
    if (q.startsWith('insert into food_analyst.goals')) { db.goals.set(v[0], { calories: v[1], protein: v[2], carbs: v[3], fat: v[4], fiber: v[5], hydration: v[6] }); return []; }
    if (q.startsWith('insert into food_analyst.users')) { db.users.set(v[0], { user_id: v[0], full_name_enc: v[4], last_seen: new Date() }); return []; }
    if (q.startsWith('select user_id')) return [...db.users.values()];
    if (q.startsWith('select entry_id, nutrition from food_analyst.message_links')) return db.links.has(`${v[0]}:${v[1]}`) ? [db.links.get(`${v[0]}:${v[1]}`)] : [];
    if (q.startsWith('insert into food_analyst.message_links')) { db.links.set(`${v[0]}:${v[1]}`, { entry_id: v[2], nutrition: v[3] }); return []; }
    if (q.startsWith('select flow, step, state')) return db.convs.has(`${v[0]}:${v[1]}`) ? [db.convs.get(`${v[0]}:${v[1]}`)] : [];
    if (q.startsWith('insert into food_analyst.conversations')) { db.convs.set(`${v[0]}:${v[1]}`, { flow: v[2], step: v[3], state: v[4], updated_at: new Date() }); return []; }
    if (q.startsWith('delete from food_analyst.conversations')) { db.convs.delete(`${v[0]}:${v[1]}`); return []; }
    if (q.startsWith('select distinct chat_id')) return [...new Set(db.entries.filter((e) => e.entry_date === v[0]).map((e) => e.chat_id))].map((chat_id) => ({ chat_id }));
    if (q.startsWith('select count(*)::int as n from food_analyst.entries')) return [{ n: db.entries.length }];
    if (q.startsWith('select count(*)::int as n from food_analyst.users')) return [{ n: db.users.size }];
    throw new Error('unexpected query: ' + q);
  };
  sql.json = (x) => x;
  return { sql, db };
}

beforeEach(() => {
  sent = [];
  llmCalls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('/file/bot')) return new Response(new Uint8Array([0xff, 0xd8, 0xff]));
    const method = url.split('/').pop();
    const body = JSON.parse(init.body);
    sent.push({ method, ...body });
    if (method === 'getFile') return Response.json({ ok: true, result: { file_path: 'photos/a.jpg' } });
    return Response.json({ ok: true, result: { message_id: 1000 + sent.length } });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const LAKSA = { food_name: 'Laksa', calories: 600, protein: 20, carbs: 60, fat: 30, fiber: 4, hydration: 300, serving_size: '1 bowl', confidence: 'high' };

function env(db = fakeDb()) {
  return {
    SQL: db.sql, BOT_TOKEN: '123456789:AAFakeTokenForTestsOnly_abcdefghijk', WEBHOOK_SECRET: 's', ENCRYPTION_KEY: 'k'.repeat(32),
    BOT_USERNAME: 'FoodAnalystBot', CHAT_ID: '-100777', DEVELOPER_CHAT_ID: '99',
    ASSETS: { fetch: () => new Response('asset') },
    LLM: { fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      llmCalls.push({ useCase: init.headers['X-TBJ-Use-Case'], content: body.messages[0].content });
      const reply = init.headers['X-TBJ-Use-Case'] === 'food-goals'
        ? { calories: 2200, protein: 140, carbs: 260, fat: 70, fiber: 30, hydration: 2500 } : LAKSA;
      return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }], tbj: { provider: 'anthropic' } });
    } }
  };
}

async function update(e, u) {
  const p = [];
  await worker.fetch(new Request('https://x/webhook', { method: 'POST', body: JSON.stringify(u), headers: { 'X-Telegram-Bot-Api-Secret-Token': 's' } }), e, { waitUntil: (x) => p.push(x) });
  await Promise.all(p);
}
const priv = (text, extra = {}) => ({ message: { message_id: 5, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Julian' }, text, ...extra } });

test('a photo becomes an entry, analysed through the gateway, and the reply is linked to that entry', async () => {
  const { sql, db } = fakeDb();
  const e = env({ sql, db });
  await update(e, { message: { message_id: 6, chat: { id: 42, type: 'private' }, from: { id: 42 }, photo: [{ file_id: 'small' }, { file_id: 'big' }], caption: 'laksa' } });
  assert.equal(llmCalls[0].useCase, 'food-vision');
  assert.match(llmCalls[0].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(llmCalls[0].content[1].text, /laksa/);
  assert.equal(db.entries.length, 1);
  const analysis = sent.find((s) => s.method === 'sendMessage' && /Laksa/.test(s.text));
  assert.match(analysis.text, /Calories: 600\/2000 kcal/);
  assert.equal(db.links.size, 1);
});

test('replying to an analysis corrects that entry; replying "remove" deletes it (both broken before)', async () => {
  const { sql, db } = fakeDb();
  const e = env({ sql, db });
  await update(e, { message: { message_id: 6, chat: { id: 42, type: 'private' }, from: { id: 42 }, photo: [{ file_id: 'p' }] } });
  const analysisId = sent.findIndex((s) => /Laksa/.test(s.text || '')) + 1001;
  await update(e, priv('500ml coke', { reply_to_message: { message_id: analysisId } }));
  assert.equal(db.entries[0].nutrition.food_name, 'Coke');
  assert.ok(sent.some((s) => s.method === 'editMessageText' && /manually corrected/.test(s.text)));
  await update(e, priv('remove', { reply_to_message: { message_id: analysisId } }));
  assert.equal(db.entries.length, 0);
  assert.ok(sent.some((s) => /✅ Removed: Coke/.test(s.text || '')));
});

test('/goals → manual → six numbers sets per-chat goals, through a stored conversation', async () => {
  const { sql, db } = fakeDb();
  const e = env({ sql, db });
  await update(e, priv('/goals'));
  await update(e, priv('manual'));
  await update(e, priv('2100, 140, 250, 70, 30, 2500'));
  assert.deepEqual(db.goals.get('42'), { calories: 2100, protein: 140, carbs: 250, fat: 70, fiber: 30, hydration: 2500 });
  assert.equal(db.convs.size, 0);
});

test('a command during a pending question runs the command instead of being eaten as an answer', async () => {
  const { sql, db } = fakeDb();
  const e = env({ sql, db });
  await update(e, priv('/goals'));
  await update(e, priv('/summary'));
  assert.ok(sent.some((s) => /No food entries recorded today/.test(s.text || '')));
});

test('AI-guided goals walk six questions, then ask the gateway (food-goals) and save the result', async () => {
  const { sql, db } = fakeDb();
  const e = env({ sql, db });
  for (const t of ['/goals', 'ai', '30', '175', '70', 'Asian', 'maintain', 'moderate']) await update(e, priv(t));
  assert.equal(llmCalls.at(-1).useCase, 'food-goals');
  assert.match(llmCalls.at(-1).content, /Activity Level: moderate/);
  assert.equal(db.goals.get('42').calories, 2200);
});

test('chats other than private and the configured channel are ignored', async () => {
  const e = env();
  await update(e, { message: { message_id: 1, chat: { id: -555, type: 'group' }, from: { id: 1 }, text: '/summary' } });
  assert.equal(sent.length, 0);
});

test('the 23:59 SGT cron sends a summary to every chat that logged food today', async () => {
  const { sql, db } = fakeDb();
  const e = env({ sql, db });
  await update(e, { message: { message_id: 6, chat: { id: 42, type: 'private' }, from: { id: 42 }, photo: [{ file_id: 'p' }] } });
  sent = [];
  await worker.scheduled({ cron: '59 15 * * *' }, e, {});
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Daily Nutrition Summary/);
});

test('/api/leaderboard hides chat ids; /healthz checks the database and key length', async () => {
  const { sql, db } = fakeDb();
  const e = env({ sql, db });
  await update(e, { message: { message_id: 6, chat: { id: 42, type: 'private' }, from: { id: 42 }, photo: [{ file_id: 'p' }] } });
  const lb = await (await worker.fetch(new Request('https://x/api/leaderboard'), e, {})).json();
  assert.equal(lb.totalUsers, 1);
  assert.ok(!('userId' in lb.leaderboard[0]));
  const h = await (await worker.fetch(new Request('https://x/healthz'), { ...e, BOT_CORE_SHA: 'abc' }, {})).json();
  assert.equal(h.status, 'pass');
});
