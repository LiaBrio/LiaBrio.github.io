#!/usr/bin/env node
/**
 * 抓取 GitHub 数据，生成 data/repos.json。
 *
 * 用法：
 *   GITHUB_USERNAME=yourname GITHUB_TOKEN=ghp_xxx node scripts/fetch-data.mjs
 *   node scripts/fetch-data.mjs --username yourname --include-private
 *   node scripts/fetch-data.mjs --username yourname --out=.tmp/repos.json   # 测试用临时输出
 *
 * 环境变量 / 参数：
 *   GITHUB_USERNAME / --username   目标用户名（默认取仓库 owner，CI 里由工作流传入）
 *   GITHUB_TOKEN                   Personal Access Token（可选；不填走未鉴权 API，限速 60 次/小时）
 *   --include-private              把自己的私有仓库也写入数据（注意：页面是公开的！）
 *   --max-pages=N                  每种接口最多翻多少页（默认 100，即 1 万个仓库）
 *   --out=<path>                   输出文件（默认 data/repos.json；也作为增量对比的上一份快照）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- 参数 ---------------- */

const argv = process.argv.slice(2);
/** 同时支持 --name value 与 --name=value 两种写法 */
const argOf = (name) => {
  for (const a of argv) {
    if (a === '--' + name) return argv[argv.indexOf(a) + 1];
    if (a.startsWith('--' + name + '=')) return a.slice(name.length + 3);
  }
  return undefined;
};
const hasFlag = (name) => argv.includes('--' + name);

const USERNAME = process.env.GITHUB_USERNAME || process.env.USERNAME || argOf('username') || '';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const INCLUDE_PRIVATE = hasFlag('include-private');
const MAX_PAGES = Number(argOf('max-pages') || 100);
const OUT_FILE = path.resolve(ROOT, argOf('out') || path.join('data', 'repos.json'));

if (!USERNAME) {
  console.error('✗ 缺少用户名：请设置 GITHUB_USERNAME 环境变量或传 --username');
  process.exit(1);
}

/* ---------------- GitHub API ---------------- */

const API = 'https://api.github.com';
let requestsMade = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(pathname) {
  const url = pathname.startsWith('http') ? pathname : API + pathname;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
        'User-Agent': 'github-hub-data-fetcher'
      }
    });
    requestsMade++;

    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const waitMs = Math.min(Math.max(reset - Date.now(), 0), 60_000);
      if (remaining === '0' && waitMs > 0) {
        console.warn(`  ⏳ 触发速率限制，等待 ${Math.ceil(waitMs / 1000)}s…`);
        await sleep(waitMs + 1000);
        continue;
      }
      throw new Error(`请求被限流：${res.status} ${url}`);
    }

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`请求失败 ${res.status} ${res.statusText} → ${url}`);
    return res.json();
  }
  throw new Error(`重试后仍失败：${url}`);
}

/** 跟随 Link 头的分页抓取 */
async function ghPaged(pathname) {
  const out = [];
  const base = pathname.startsWith('http') ? pathname : API + pathname;
  let url = base + (base.includes('?') ? '&' : '?') + 'per_page=100';
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
        'User-Agent': 'github-hub-data-fetcher'
      }
    });
    requestsMade++;

    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const waitMs = Math.min(Math.max(reset - Date.now(), 0), 60_000);
      if (remaining === '0' && waitMs > 0) {
        console.warn(`  ⏳ 触发速率限制，等待 ${Math.ceil(waitMs / 1000)}s…`);
        await sleep(waitMs + 1000);
        page--;
        continue;
      }
      throw new Error(`请求被限流：${res.status}`);
    }
    if (!res.ok) throw new Error(`请求失败 ${res.status} ${res.statusText} → ${url}`);

    const batch = await res.json();
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < 100) break;

    const link = res.headers.get('link') || '';
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
    await sleep(80); // 轻微限速，避免打到 secondary limit
  }
  return out;
}

/* ---------------- 抓取 ---------------- */

function normalize(repo, kind) {
  return {
    id: repo.id,
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner && repo.owner.login,
    description: repo.description || '',
    url: repo.html_url,
    homepage: repo.homepage || '',
    language: repo.language || '未知',
    topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 12) : [],
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    issues: repo.open_issues_count || 0,
    license: repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
      ? repo.license.spdx_id : '',
    archived: !!repo.archived,
    fork: !!repo.fork,
    private: !!repo.private,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    kind
  };
}

async function main() {
  console.log(`→ 抓取 @${USERNAME} 的仓库与 Star 列表${TOKEN ? '（已鉴权）' : '（未鉴权，限速较低）'}`);

  const user = await gh(`/users/${USERNAME}`);
  if (!user) throw new Error(`用户 @${USERNAME} 不存在`);
  console.log(`  ✓ 用户：${user.name || user.login}`);

  // 自己的仓库：走 /user/repos 可拿到私有仓库；否则用公开接口
  let ownRaw = [];
  if (TOKEN && INCLUDE_PRIVATE) {
    ownRaw = (await ghPaged('/user/repos?affiliation=owner&sort=updated&direction=desc'))
      .filter((r) => (r.owner && r.owner.login || '').toLowerCase() === USERNAME.toLowerCase());
    console.log('  ✓ 已抓取仓库（含私有）');
  } else {
    ownRaw = await ghPaged(`/users/${USERNAME}/repos?sort=updated&direction=desc`);
  }
  console.log(`  ✓ 仓库：${ownRaw.length} 个`);

  const starredRaw = await ghPaged(`/users/${USERNAME}/starred?sort=created&direction=desc`);
  console.log(`  ✓ Starred：${starredRaw.length} 个`);

  /* 合并：自己的仓库优先，其余为 starred */
  const byName = new Map();
  ownRaw.forEach((r) => {
    if (r.private && !INCLUDE_PRIVATE) return;
    const item = normalize(r, 'own');
    byName.set(item.fullName, item);
  });
  starredRaw.forEach((r) => {
    if (byName.has(r.full_name)) {
      const prev = byName.get(r.full_name);
      prev.alsoStarred = true;
      return;
    }
    byName.set(r.full_name, normalize(r, 'starred'));
  });

  /* 读取上一份快照：保留 firstSeen，计算 star 增量 */
  const prevFile = OUT_FILE;
  let prevItems = [];
  if (existsSync(prevFile)) {
    try {
      prevItems = JSON.parse(await readFile(prevFile, 'utf8')).items || [];
    } catch (e) {
      console.warn('  ! 旧数据解析失败，将重新生成全部历史标记');
    }
  }
  const prevMap = new Map(prevItems.map((i) => [i.fullName, i]));

  const generatedAt = new Date().toISOString();
  const hadSnapshot = prevItems.length > 0;
  let newCount = 0;

  const items = [...byName.values()].map((item) => {
    const prev = prevMap.get(item.fullName);
    // 首次运行没有历史基线，用创建时间兜底，避免把全部历史 star 都标成「新增」
    const firstSeen = prev && prev.firstSeen
      ? prev.firstSeen
      : (hadSnapshot ? generatedAt : item.createdAt);
    if (!prev && hadSnapshot) newCount++;
    return {
      ...item,
      firstSeen,
      starsDelta: prev ? Math.max(0, item.stars - (prev.stars || 0)) : 0
    };
  });

  items.sort((a, b) => b.stars - a.stars || b.updatedAt.localeCompare(a.updatedAt));

  const languages = {};
  items.forEach((i) => { languages[i.language] = (languages[i.language] || 0) + 1; });

  const payload = {
    generatedAt,
    source: {
      username: USERNAME,
      includePrivate: INCLUDE_PRIVATE,
      apiRequests: requestsMade
    },
    user: {
      login: user.login,
      name: user.name || user.login,
      avatar: user.avatar_url,
      bio: user.bio || '',
      url: user.html_url,
      followers: user.followers,
      publicRepos: user.public_repos
    },
    stats: {
      repos: items.filter((i) => i.kind === 'own').length,
      starred: items.filter((i) => i.kind === 'starred').length,
      total: items.length,
      newCount,
      languages: Object.fromEntries(
        Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 40)
      )
    },
    items
  };

  await mkdir(path.dirname(prevFile), { recursive: true });
  await writeFile(prevFile, JSON.stringify(payload), 'utf8');

  console.log(`\n✓ 已写入 ${path.relative(ROOT, prevFile)}`);
  console.log(`  仓库 ${payload.stats.repos} · Starred ${payload.stats.starred} · 本次新增 ${newCount} · API 请求 ${requestsMade} 次`);
}

main().catch((err) => {
  console.error('✗ 抓取失败：', err.message);
  process.exit(1);
});
