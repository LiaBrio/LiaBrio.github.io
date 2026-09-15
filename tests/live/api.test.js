/**
 * 真实 GitHub API 验证：确认「抓取脚本 → 数据文件」与线上一致，而不是只在本地自洽。
 *
 * 请求次数刻意压到很少（抓取 3 次 + 抽样 3 次）；遇到断网 / 限流 / 404 一律 skip，
 * 保证 npm test 在没有网络或额度用尽时依然是绿的。SKIP_LIVE=1 可完全关闭。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { PROJECT_ROOT } from '../helpers/ensure-data.js';

const ROOT = PROJECT_ROOT;
const USERNAME = process.env.GITHUB_USERNAME || 'ruanyf';
const LIVE_FILE = path.join(ROOT, '.tmp', 'live-repos.json');

const LIMIT_HINTS = /rate limit|403|429|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|getaddrinfo|secondary/i;
const isLimited = (text) => LIMIT_HINTS.test(String(text || ''));

function skip(t, why) {
  t.skip(why);
  return true;
}

async function gh(pathname) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'gh-hub-test' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const res = await fetch('https://api.github.com' + pathname, { headers });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

/** 运行真实抓取脚本；失败时返回 { ok:false, reason } 供调用方 skip */
function runFetch(username) {
  fs.mkdirSync(path.dirname(LIVE_FILE), { recursive: true });
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'fetch-data.mjs'),
    '--username', username,
    '--max-pages', '1',
    '--out', path.join('.tmp', 'live-repos.json')
  ], { encoding: 'utf8', timeout: 180000 });
  const out = (res.stdout || '') + (res.stderr || '');
  return {
    ok: res.status === 0 && fs.existsSync(LIVE_FILE),
    reason: out.trim().split('\n').slice(-3).join(' | ')
  };
}

test('真实抓取：产出结构与线上数据自洽', (t) => {
  if (process.env.SKIP_LIVE === '1') return skip(t, 'SKIP_LIVE=1，跳过真实 API 校验');
  const res = runFetch(USERNAME);
  if (!res.ok) return skip(t, '抓取失败（可能断网或限流）：' + res.reason);

  const data = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  assert.ok(!Number.isNaN(Date.parse(data.generatedAt)), 'generatedAt 应是合法时间');
  assert.equal(data.source.username, USERNAME);
  assert.equal(data.user.login.toLowerCase(), USERNAME.toLowerCase(), '用户信息应来自真实接口');
  assert.equal(data.stats.total, data.items.length);
  assert.equal(data.stats.repos + data.stats.starred, data.stats.total);
  assert.ok(data.items.length > 0, '真实账号应有至少一个仓库');

  const required = ['id', 'fullName', 'name', 'owner', 'url', 'language', 'stars', 'kind', 'createdAt', 'updatedAt', 'pushedAt'];
  data.items.slice(0, 20).forEach((it) => {
    required.forEach((k) => assert.ok(it[k] !== undefined && it[k] !== null, it.fullName + ' 缺少字段 ' + k));
    assert.ok(['own', 'starred'].includes(it.kind), 'kind 只能是 own/starred：' + it.kind);
    assert.ok(it.fullName.split('/').length === 2, 'fullName 应为 owner/name：' + it.fullName);
    assert.ok(typeof it.stars === 'number' && it.stars >= 0);
    assert.ok(Array.isArray(it.topics));
    assert.ok(!Number.isNaN(Date.parse(it.updatedAt)), 'updatedAt 应可解析：' + it.fullName);
  });

  const stars = data.items.map((i) => i.stars);
  assert.deepEqual(stars, [...stars].sort((a, b) => b - a), '数据应按 star 数降序');
  assert.ok(data.items.every((i) => i.firstSeen), '每个仓库都应有 firstSeen');
});

test('抽样交叉校验：快照里的仓库与 GitHub 接口一致', async (t) => {
  if (process.env.SKIP_LIVE === '1') return skip(t, 'SKIP_LIVE=1，跳过真实 API 校验');
  if (!fs.existsSync(LIVE_FILE)) {
    const res = runFetch(USERNAME);
    if (!res.ok) return skip(t, '抓取失败（可能断网或限流）：' + res.reason);
  }
  const data = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  const picks = [data.items[0], data.items[Math.floor(data.items.length / 2)], data.items[data.items.length - 1]]
    .filter(Boolean).filter((v, i, a) => a.findIndex((x) => x.fullName === v.fullName) === i)
    .slice(0, 3);

  for (const item of picks) {
    const res = await gh('/repos/' + item.fullName);
    if (res.status === 403 || res.status === 429) return skip(t, 'API 限流，跳过交叉校验');
    if (res.status === 404) return skip(t, item.fullName + ' 在 GitHub 上已不可见（可能改名或删除）');
    if (res.status !== 200 || !res.body) return skip(t, 'GitHub API 不可用：HTTP ' + res.status);

    assert.equal(res.body.id, item.id, item.fullName + ' 的 id 应与线上一致（id 不会变）');
    assert.equal(res.body.full_name.toLowerCase(), item.fullName.toLowerCase());
    assert.ok(Math.abs((res.body.stargazers_count || 0) - item.stars) <= 5,
      item.fullName + ' star 数与线上差异过大：快照 ' + item.stars + ' vs 线上 ' + res.body.stargazers_count);
    assert.equal(res.body.archived, item.archived, item.fullName + ' archived 状态应一致');
  }
});
