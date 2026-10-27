// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  sgtDate, encrypt, decrypt, parseUserCorrection, isRemoval, parseJsonReply, validNutrition, validGoals,
  totalsOf, formatAnalysis, formatSummary, formatProgress, score, maskUserName, DEFAULT_GOALS
} from '../food.js';

const KEY = 'k'.repeat(32);

test('days roll over at Singapore midnight (the old bot used UTC: 08:00 SGT)', () => {
  assert.equal(sgtDate(new Date('2026-10-28T15:59:00Z')), '2026-10-28');
  assert.equal(sgtDate(new Date('2026-10-28T16:00:00Z')), '2026-10-29');
});

test('encryption round-trips and stays compatible with the old Redis format', () => {
  const enc = encrypt('Julian Cheung', KEY);
  assert.match(enc, /^[0-9a-f]{32}:[0-9a-f]+$/);
  assert.equal(decrypt(enc, KEY), 'Julian Cheung');
  // what zeabur-bot.js produced: iv hex + ':' + ciphertext hex, key = raw 32-char string
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY), iv);
  const legacy = iv.toString('hex') + ':' + Buffer.concat([c.update('Legacy Name'), c.final()]).toString('hex');
  assert.equal(decrypt(legacy, KEY), 'Legacy Name');
  assert.equal(decrypt('plain', KEY), 'plain');
});

test('corrections parse food and serving, scaled from the estimate table', () => {
  assert.deepEqual(parseUserCorrection('500ml coke'), { food_name: 'Coke', calories: 280, protein: 0, carbs: 78, fat: 0, serving_size: '500ml' });
  const c = parseUserCorrection('coffee 200ml');
  assert.equal(c.food_name, 'Coffee');
  assert.equal(c.serving_size, '200ml');
  assert.equal(parseUserCorrection('mystery stew').calories, 100);
});

test('removal keywords', () => {
  assert.ok(isRemoval('please REMOVE this'));
  assert.ok(!isRemoval('500ml coke'));
});

test('model replies: fenced JSON parses; junk and incomplete objects are rejected', () => {
  const n = parseJsonReply('```json\n{"food_name":"Laksa","calories":600,"protein":20,"carbs":60,"fat":30}\n```');
  assert.ok(validNutrition(n));
  assert.ok(!validNutrition(parseJsonReply('{"food_name":"x"}')));
  assert.equal(parseJsonReply('sorry, no'), null);
  assert.ok(validGoals(DEFAULT_GOALS));
  assert.ok(!validGoals({ ...DEFAULT_GOALS, fiber: 0 }));
});

test('totals, summary and progress', () => {
  const entries = [{ food_name: 'A', calories: 500, protein: 20, carbs: 50, fat: 10, fiber: 5, hydration: 200 }, { food_name: 'B', calories: 300, protein: 10.55, carbs: 30, fat: 5 }];
  const t = totalsOf(entries);
  assert.equal(t.calories, 800);
  assert.equal(t.protein, 30.6);
  assert.match(formatSummary('2026-10-28', entries, t, DEFAULT_GOALS), /1\. A - 500 kcal\n2\. B - 300 kcal/);
  assert.match(formatProgress(t, DEFAULT_GOALS), /Calories: 800\/2000 kcal \(40%\)[\s\S]*Keep going!/);
  assert.match(formatAnalysis({ ...entries[0], serving_size: '1 bowl', confidence: 'high' }, t, DEFAULT_GOALS), /🍽️ \*A\*/);
});

test('leaderboard score: 1000 at exactly the goals, lower with deviation; names masked', () => {
  assert.equal(score(DEFAULT_GOALS, DEFAULT_GOALS).score, 1000);
  assert.ok(score({ ...DEFAULT_GOALS, calories: 1000 }, DEFAULT_GOALS).score < 1000);
  assert.equal(maskUserName('Julian'), 'J****n');
  assert.equal(maskUserName('Al'), 'Al');
});
