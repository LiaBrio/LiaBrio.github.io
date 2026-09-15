/**
 * 确保存在一份「真实抓取」的数据用于测试。
 *
 * 优先级：新鲜缓存 → 重新抓取真实 GitHub API → 仓库里已有的 data/repos.json
 * 所有产出都写到 .tmp/ 下，绝不覆盖仓库里的 data/repos.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @param {object} opts
 * @param {string} opts.root        项目根目录
 * @param {string} [opts.username]  抓取目标（默认环境变量 GITHUB_USERNAME，否则用公开的示例账号）
 * @param {number} [opts.maxPages]  每种接口翻多少页（默认 1，控制 API 用量）
 * @param {number} [opts.maxAgeMs]  缓存有效期，默认 30 分钟
 * @param {boolean} [opts.offline]  true 则完全不联网，只用现有文件
 * @returns {{ file: string, source: 'cache'|'live'|'repo'|'none', note: string, username: string }}
 */
export function ensureData(opts) {
  const root = opts.root;
  const tmpDir = path.join(root, '.tmp');
  const file = path.join(tmpDir, 'repos.json');
  const maxAgeMs = opts.maxAgeMs == null ? 30 * 60 * 1000 : opts.maxAgeMs;
  const username = opts.username || process.env.GITHUB_USERNAME || process.env.USERNAME || 'ruanyf';

  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < maxAgeMs) {
    return { file, source: 'cache', note: '复用 .tmp/repos.json 缓存', username };
  }

  if (!opts.offline) {
    fs.mkdirSync(tmpDir, { recursive: true });
    const args = [
      path.join(root, 'scripts', 'fetch-data.mjs'),
      '--username', username,
      '--max-pages', String(opts.maxPages || 1),
      '--out', path.join('.tmp', 'repos.json')
    ];
    const res = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180000 });
    if (res.status === 0 && fs.existsSync(file)) {
      return { file, source: 'live', note: '真实抓取 api.github.com', username };
    }
    const reason = (res.stderr || res.stdout || '未知错误').trim().split('\n').slice(-2).join(' | ');
    if (fs.existsSync(file)) return { file, source: 'cache', note: '抓取失败，沿用旧缓存：' + reason, username };

    const fallback = path.join(root, 'data', 'repos.json');
    if (fs.existsSync(fallback)) {
      return { file: fallback, source: 'repo', note: '抓取失败，降级使用仓库内已有的数据：' + reason, username };
    }
    return { file: null, source: 'none', note: '抓取失败且无可用数据：' + reason, username };
  }

  const fallback = path.join(root, 'data', 'repos.json');
  if (fs.existsSync(file)) return { file, source: 'cache', note: '离线模式，使用 .tmp 缓存', username };
  if (fs.existsSync(fallback)) return { file: fallback, source: 'repo', note: '离线模式，使用仓库数据', username };
  return { file: null, source: 'none', note: '离线模式且无可用数据', username };
}

export function readSnapshot(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const PROJECT_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
