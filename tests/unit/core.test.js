/**
 * 纯逻辑单元测试：这些断言决定筛选/排序/分组的结果正确性。
 * 与页面共用同一份实现 assets/js/core.js。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'assets/js/core.js'), 'utf8'), {
  filename: path.join(ROOT, 'assets/js/core.js')
});
const Core = globalThis.GHHubCore;

const NOW = Date.parse('2026-09-15T12:00:00Z');
const DAY = 86400000;

function raw(over) {
  return Object.assign({
    id: 1,
    fullName: 'acme/tool',
    name: 'tool',
    owner: 'acme',
    description: 'a handy CLI',
    url: 'https://github.com/acme/tool',
    homepage: '',
    language: 'Go',
    topics: ['cli'],
    stars: 10,
    forks: 1,
    issues: 0,
    starsDelta: 0,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2021-01-01T00:00:00Z',
    pushedAt: '2021-02-01T00:00:00Z',
    firstSeen: '2020-01-01T00:00:00Z',
    kind: 'own',
    archived: false,
    fork: false,
    private: false,
    license: 'MIT'
  }, over || {});
}

const SAMPLE = [
  raw({ id: 1, fullName: 'acme/alpha', name: 'alpha', stars: 300, language: 'Go', topics: ['cli', 'tool'], kind: 'own', updatedAt: '2026-01-01T00:00:00Z', pushedAt: '2026-01-02T00:00:00Z', createdAt: '2019-01-01T00:00:00Z' }),
  raw({ id: 2, fullName: 'beta/web-ui', name: 'web-ui', owner: 'beta', stars: 900, language: 'TypeScript', topics: ['frontend', 'react'], description: 'react components', kind: 'starred', archived: true, updatedAt: '2026-02-01T00:00:00Z' }),
  raw({ id: 3, fullName: 'acme/old-thing', name: 'old-thing', stars: 5, language: null, topics: [], kind: 'starred', fork: true, firstSeen: new Date(NOW - 2 * DAY).toISOString(), updatedAt: '2022-01-01T00:00:00Z' }),
  raw({ id: 4, fullName: 'gamma/docs', name: 'docs', owner: 'gamma', stars: 120, language: 'Go', topics: ['docs'], kind: 'starred', firstSeen: new Date(NOW - 30 * DAY).toISOString(), updatedAt: '2025-06-01T00:00:00Z' })
];

const build = (opts) => Core.buildItems(SAMPLE, { tags: [], map: {} }, Object.assign({ now: NOW, newWithinDays: 7 }, opts || {}));

test('fmtNum：按数量级做 k 缩写', () => {
  assert.equal(Core.fmtNum(0), '0');
  assert.equal(Core.fmtNum(999), '999');
  assert.equal(Core.fmtNum(1500), '1.5k');
  assert.equal(Core.fmtNum(12345), '12k');
});

test('relTime：各档位与可注入 now', () => {
  assert.equal(Core.relTime('', NOW), '');
  assert.equal(Core.relTime(new Date(NOW - 30 * 1000).toISOString(), NOW), '刚刚');
  assert.equal(Core.relTime(new Date(NOW - 90 * 60 * 1000).toISOString(), NOW), '1 小时前');
  assert.equal(Core.relTime(new Date(NOW - 2 * DAY).toISOString(), NOW), '2 天前');
  assert.equal(Core.relTime(new Date(NOW - 40 * DAY).toISOString(), NOW), '1 个月前');
  assert.equal(Core.relTime(new Date(NOW - 400 * DAY).toISOString(), NOW), '1 年前');
});

test('matchesRule：五种字段命中且大小写无关', () => {
  const repo = raw({ fullName: 'Beta/Web-UI', owner: 'Beta', topics: ['React'], language: 'TypeScript', description: 'Data Table' });
  assert.equal(Core.matchesRule(repo, { fullNames: ['beta/web-ui'] }), true);
  assert.equal(Core.matchesRule(repo, { owners: ['beta'] }), true);
  assert.equal(Core.matchesRule(repo, { topics: ['react'] }), true);
  assert.equal(Core.matchesRule(repo, { languages: ['typescript'] }), true);
  assert.equal(Core.matchesRule(repo, { keywords: ['data table'] }), true);
  assert.equal(Core.matchesRule(repo, { topics: ['vue'] }), false);
  assert.equal(Core.matchesRule(repo, {}), false);
  assert.equal(Core.matchesRule(repo, { topics: [] }), false);
  assert.equal(Core.matchesRule(repo, { topics: [''] }), false);
});

const CAT_RULES = [
  { name: 'AI · 大模型', match: { topics: ['llm', 'ai'], keywords: ['gpt'] } },
  { name: '前端 · UI', match: { topics: ['react', 'frontend'], languages: ['TypeScript'] } },
  { name: '工具 · CLI', match: { topics: ['cli'] } }
];

test('classify：按命中权重排序，同分按规则顺序', () => {
  assert.deepEqual(Core.classify(raw({ topics: ['react'] }), CAT_RULES), ['前端 · UI']);
  assert.deepEqual(Core.classify(raw({ topics: [] }), CAT_RULES), [], '无命中返回空数组');
  assert.deepEqual(Core.classify(raw({ topics: ['cli', 'llm'] }), CAT_RULES), ['AI · 大模型', '工具 · CLI'],
    '两个分类各命中一个话题时按规则顺序');

  // 多条件命中得分更高：Topic(languages=2) + topic(react=3) > AI 的 topic(ai=3)
  const multi = Core.classify(raw({ topics: ['ai', 'react'], language: 'TypeScript' }), CAT_RULES);
  assert.equal(multi[0], '前端 · UI', '命中条件更多的分类优先');

  assert.deepEqual(Core.classify(raw({ fullName: 'acme/tool', topics: [] }),
    [{ name: '指定', match: { fullNames: ['acme/tool'] } }]), ['指定'], 'fullNames 精确匹配命中');
  assert.equal(Core.classify(raw({}), []).length, 0, '没有规则时返回空');
  assert.equal(Core.classify(raw({}), null).length, 0, '规则为 null 时安全返回空');
  assert.equal(Core.classify(raw({ topics: ['llm'] }), [{ match: { topics: ['llm'] } }]).length, 0,
    '缺 name 的规则被忽略');
});

test('ruleScore：权重与命中数累加', () => {
  const repo = raw({ topics: ['llm'], language: 'Go' });
  assert.equal(Core.ruleScore(repo, { topics: ['llm'] }), 3);
  assert.equal(Core.ruleScore(repo, { topics: ['llm', 'ai'] }), 3, '只计命中的条件');
  assert.equal(Core.ruleScore(repo, { topics: ['llm'], languages: ['Go'] }), 5);
  assert.equal(Core.ruleScore(repo, { keywords: ['handy'] }), 1, '关键词命中描述');
  assert.equal(Core.ruleScore(repo, { owners: ['acme'] }), 4);
  assert.equal(Core.ruleScore(repo, {}), 0);
});

test('buildItems：派生 categories / category，强指派优先于规则', () => {
  const items = Core.buildItems(SAMPLE, { tags: [], map: {} },
    { categories: CAT_RULES, now: NOW, newWithinDays: 7 });
  const byName = (n) => items.find((i) => i.fullName === n);

  assert.deepEqual(byName('acme/alpha').categories, ['工具 · CLI']);
  assert.equal(byName('acme/alpha').category, '工具 · CLI');
  assert.deepEqual(byName('beta/web-ui').categories, ['前端 · UI'], '语言+话题同时命中仍只出现一次');
  assert.deepEqual(byName('acme/old-thing').categories, []);
  assert.equal(byName('acme/old-thing').category, Core.UNCATEGORIZED, '无命中归入「未分类」');
  assert.ok(byName('beta/web-ui').search.includes('前端 · ui'), '分类名进入检索索引');

  const overridden = Core.buildItems(SAMPLE, { tags: [], map: {} },
    { categories: CAT_RULES, catMap: { 'acme/alpha': ['自定义分类'], 'acme/old-thing': '单个分类' }, now: NOW });
  assert.deepEqual(overridden.find((i) => i.fullName === 'acme/alpha').categories, ['自定义分类']);
  assert.deepEqual(overridden.find((i) => i.fullName === 'acme/old-thing').categories, ['单个分类'],
    '字符串形式的强指派会被转成数组');
});

test('filterItems：按功能分类筛选，含「未分类」', () => {
  const items = Core.buildItems(SAMPLE, { tags: [], map: {} },
    { categories: CAT_RULES, now: NOW, newWithinDays: 7 });
  const names = (list) => list.map((i) => i.fullName);

  assert.deepEqual(names(Core.filterItems(items, { cat: '工具 · CLI' })), ['acme/alpha']);
  assert.deepEqual(names(Core.filterItems(items, { cat: '前端 · UI' })), ['beta/web-ui']);
  assert.deepEqual(names(Core.filterItems(items, { cat: Core.UNCATEGORIZED })),
    ['acme/old-thing', 'gamma/docs'], '未命中任何规则的仓库归入「未分类」');
  assert.equal(Core.filterItems(items, { cat: '' }).length, 4, '空值表示不筛选');
  assert.deepEqual(names(Core.filterItems(items, { cat: '不存在' })), []);
  assert.deepEqual(names(Core.filterItems(items, { cat: '工具 · CLI', kind: 'starred' })), [],
    '分类筛选与其他条件取交集');
});

test('catCounts：计数按数量降序，「未分类」排最后', () => {
  const items = Core.buildItems(SAMPLE, { tags: [], map: {} },
    { categories: CAT_RULES, now: NOW, newWithinDays: 7 });
  const counts = Core.catCounts(items);
  assert.deepEqual(counts.map((c) => c.name), ['前端 · UI', '工具 · CLI', '未分类']);
  assert.equal(counts[0].count, 1);
  assert.equal(counts[counts.length - 1].name, Core.UNCATEGORIZED);
  assert.deepEqual(Core.catCounts([]), []);
});

test('buildItems：字段补齐、标签合并、收藏与 NEW 判定', () => {
  const items = Core.buildItems(
    SAMPLE,
    {
      tags: [{ name: 'Go 生态', match: { languages: ['Go'] } }],
      map: { 'acme/alpha': ['必读', 'Go 生态'] }
    },
    { favs: ['beta/web-ui'], tags: { 'acme/alpha': ['本地标签'] }, now: NOW, newWithinDays: 7 }
  );

  assert.equal(items.length, SAMPLE.length);
  const alpha = items[0];
  assert.equal(alpha.language, 'Go');
  assert.deepEqual(alpha.localTags, ['本地标签']);
  assert.ok(alpha.customTags.includes('Go 生态') && alpha.customTags.includes('必读'));
  assert.equal(alpha.customTags.filter((t) => t === 'Go 生态').length, 1, '规则与 map 同名标签不应重复');
  assert.equal(alpha.fav, false);
  assert.equal(items[1].fav, true, 'fav 来自传入的收藏列表');

  const newOnes = items.filter((i) => i.isNew).map((i) => i.fullName);
  assert.deepEqual(newOnes, ['acme/old-thing'], '只有 firstSeen 落在窗口内的才算新增');

  const noLang = items.find((i) => i.fullName === 'acme/old-thing');
  assert.equal(noLang.language, '未知', '缺语言时兜底为「未知」');
  assert.equal(build({}).length, SAMPLE.length);
  assert.equal(alpha.search, alpha.search.toLowerCase(), '检索索引统一小写');
});

test('buildItems：NEW 窗口边界（刚好等于 cutoff 视为新增）', () => {
  const exactly = Core.buildItems([raw({ firstSeen: new Date(NOW - 7 * DAY).toISOString() })],
    { tags: [], map: {} }, { now: NOW, newWithinDays: 7 })[0];
  const tooOld = Core.buildItems([raw({ firstSeen: new Date(NOW - 7 * DAY - 1).toISOString() })],
    { tags: [], map: {} }, { now: NOW, newWithinDays: 7 })[0];
  assert.equal(exactly.isNew, true);
  assert.equal(tooOld.isNew, false);
});

test('filterItems：类型 / 语言 / 归档 / Fork / 只看新增', () => {
  const items = build();
  const names = (list) => list.map((i) => i.fullName);

  assert.equal(Core.filterItems(items, { kind: 'own' }).length, 1);
  assert.deepEqual(names(Core.filterItems(items, { kind: 'starred' })), ['beta/web-ui', 'acme/old-thing', 'gamma/docs']);
  assert.deepEqual(names(Core.filterItems(items, { lang: 'Go' })), ['acme/alpha', 'gamma/docs']);
  assert.equal(Core.filterItems(items, { hideArchived: false }).length, 4, '默认不隐藏归档');
  assert.equal(Core.filterItems(items, { hideArchived: true }).length, 3);
  assert.equal(Core.filterItems(items, { hideForks: true }).length, 3);
  assert.deepEqual(names(Core.filterItems(items, { onlyNew: true })), ['acme/old-thing']);
  assert.equal(Core.filterItems(items, { kind: 'fav' }).length, 0, '没有本地收藏时为空');
  assert.deepEqual(names(Core.filterItems(items, { lang: 'Rust' })), []);
});

test('filterItems：标签筛选区分话题 / 规则标签 / 本地标签', () => {
  const items = Core.buildItems(SAMPLE, { tags: [{ name: 'Go 生态', match: { languages: ['Go'] } }], map: {} },
    { tags: { 'acme/alpha': ['私有'] }, now: NOW, newWithinDays: 7 });
  const names = (list) => list.map((i) => i.fullName);

  assert.deepEqual(names(Core.filterItems(items, { tag: 'topic:cli' })), ['acme/alpha']);
  assert.deepEqual(names(Core.filterItems(items, { tag: 'topic:go 生态' })), [], '规则标签不在 topic 命名空间下');
  assert.deepEqual(names(Core.filterItems(items, { tag: 'topic:Go 生态' })), ['acme/alpha', 'gamma/docs'],
    '标签 key 无命名空间前缀时按话题/规则标签匹配');
  assert.deepEqual(names(Core.filterItems(items, { tag: 'topic:不存在' })), []);
  assert.deepEqual(names(Core.filterItems(items, { tag: 'local:私有' })), ['acme/alpha']);
  assert.equal(Core.filterItems(items, { tag: '' }).length, 4);
});

test('filterItems：搜索多词交集、大小写无关、trim', () => {
  const items = build();
  const names = (list) => list.map((i) => i.fullName);
  assert.deepEqual(names(Core.filterItems(items, { q: 'GO' })), ['acme/alpha', 'gamma/docs']);
  assert.deepEqual(names(Core.filterItems(items, { q: 'acme go' })), ['acme/alpha']);
  assert.deepEqual(names(Core.filterItems(items, { q: '  react  ' })), ['beta/web-ui']);
  assert.deepEqual(names(Core.filterItems(items, { q: 'acme rust' })), [], '多词取交集');
  assert.deepEqual(names(Core.filterItems(items, { q: '本地标签' })), [], '本地标签也进入检索索引（未设置时无匹配）');

  const withLocal = Core.buildItems(SAMPLE, { tags: [], map: {} },
    { tags: { 'acme/alpha': ['私有标记'] }, now: NOW, newWithinDays: 7 });
  assert.deepEqual(names(Core.filterItems(withLocal, { q: '私有标记' })), ['acme/alpha']);
});

test('filterItems：返回新数组且不修改入参', () => {
  const items = build();
  const before = items.map((i) => i.fullName).join(',');
  const out = Core.filterItems(items, { kind: 'own' });
  assert.notEqual(out, items);
  assert.equal(items.map((i) => i.fullName).join(','), before);
});

test('sortItems：五种排序方向正确且不改动原数组', () => {
  const items = build();
  const byStars = Core.sortItems(items, 'stars').map((i) => i.fullName);
  assert.deepEqual(byStars, ['beta/web-ui', 'acme/alpha', 'gamma/docs', 'acme/old-thing']);

  assert.equal(Core.sortItems(items, 'updated')[0].fullName, 'beta/web-ui');
  assert.equal(Core.sortItems(items, 'pushed')[0].fullName, 'acme/alpha');
  assert.equal(Core.sortItems(items, 'created')[0].fullName, 'beta/web-ui');
  assert.deepEqual(Core.sortItems(items, 'name').map((i) => i.fullName),
    ['acme/alpha', 'acme/old-thing', 'beta/web-ui', 'gamma/docs']);
  assert.deepEqual(Core.sortItems(items, 'unknown').map((i) => i.fullName), byStars, '未知排序回退到 stars');
  assert.deepEqual(items.map((i) => i.fullName), SAMPLE.map((r) => r.fullName), 'sortItems 不应原地排序');
});

test('groupItems：按 key 首次出现顺序聚合，累计到 shown 条为止', () => {
  const items = Core.sortItems(build(), 'stars');
  const groups = Core.groupItems(items, 3, (it) => it.language);
  assert.deepEqual(groups.map((g) => g.key), ['TypeScript', 'Go']);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[1].items.length, 2);
  assert.equal(Core.groupItems(items, 99, (it) => it.language).length, 3, '未知语言归入「未知」分组');
  assert.deepEqual(Core.groupItems(items, 3, () => null).map((g) => g.key), ['未分类'], 'key 为空时归入「未分类」');
  assert.deepEqual(Core.groupItems(items, 0, (it) => it.language), []);
});

test('langCounts：按数量降序，同数量按名称升序', () => {
  const counts = Core.langCounts(build());
  assert.deepEqual(counts, [{ name: 'Go', count: 2 }, { name: 'TypeScript', count: 1 }, { name: '未知', count: 1 }]);
});

test('collectTags：话题/规则/本地计数去重，本地标签排最前', () => {
  const items = Core.buildItems(
    SAMPLE,
    { tags: [{ name: '前端', match: { topics: ['react'] } }], map: {} },
    { tags: { 'acme/alpha': ['我的常用'], 'gamma/docs': ['我的常用'] }, now: NOW, newWithinDays: 7 }
  );
  const tags = Core.collectTags(items);
  const find = (key) => tags.find((t) => t.key === key);

  assert.equal(find('local:我的常用').count, 2);
  assert.equal(find('topic:cli').count, 1);
  assert.equal(find('topic:前端').count, 1, '规则标签与话题共用 topic 命名空间');
  assert.equal(find('topic:react').count, 1);
  assert.equal(tags[0].type, 'local', '本地标签排在最前');
  assert.equal(tags.filter((t) => t.key === 'topic:cli').length, 1, '同一仓库的重复标签只计一次');
});

test('collectTags：话题与规则标签重名时单个仓库只计一次', () => {
  const items = Core.buildItems([raw({ topics: ['Go 生态'] })],
    { tags: [{ name: 'Go 生态', match: { languages: ['Go'] } }], map: {} }, { now: NOW });
  assert.equal(Core.collectTags(items).find((t) => t.key === 'topic:Go 生态').count, 1);
});
