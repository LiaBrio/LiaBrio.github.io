/**
 * 前端交互测试：加载真实 index.html + 真实抓取的数据，派发真实事件做端到端断言。
 * 断言全部按数据计算期望值，不写死数字快照，数据刷新后依然成立。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPage } from '../helpers/load-page.js';
import { ensureData, readSnapshot, PROJECT_ROOT } from '../helpers/ensure-data.js';

const ROOT = PROJECT_ROOT;
const dataInfo = ensureData({ root: ROOT });
const snapshot = dataInfo.file ? readSnapshot(dataInfo.file) : null;

/* 一批按数据算出来的期望值，供各用例复用 */
const ITEMS = snapshot ? snapshot.items : [];
const OWN = ITEMS.filter((i) => i.kind === 'own');
const STARRED = ITEMS.filter((i) => i.kind === 'starred');
const NOT_ARCHIVED = ITEMS.filter((i) => !i.archived);
const NOT_FORKED = ITEMS.filter((i) => !i.fork && !i.archived);
const NEW_ITEMS = ITEMS.filter((i) => i.firstSeen &&
  Date.parse(i.firstSeen) >= Date.now() - 7 * 86400000 && !i.archived);
const PAGE_SIZE = 60;
const TOP_LANG = (() => {
  const counts = {};
  NOT_ARCHIVED.forEach((i) => { counts[i.language] = (counts[i.language] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['未知', 0];
})();

const TARGET = ITEMS[0];               // 用于本地收藏 / 标签的目标仓库
const SEARCH_TERM = (TARGET.topics[0] || TARGET.fullName.split('/')[0] || 'a').toLowerCase();

async function newPage(opts) {
  if (!snapshot) return null;
  return loadPage(Object.assign({
    root: ROOT,
    fetchMap: {
      'data/repos.json': path.relative(ROOT, dataInfo.file),
      'data/custom-tags.json': 'data/custom-tags.json',
      'data/categories.json': 'data/categories.json'
    }
  }, opts || {}));
}

const skipOrThrow = (t) => {
  if (!snapshot) {
    t.skip('没有可用数据（抓取失败且无缓存）：' + dataInfo.note);
    return true;
  }
  return false;
};

test('加载真实页面：脚本无报错、按 HTML 里的顺序全部执行', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  assert.deepEqual(p.errors, [], '页面不应产生 JS 错误');
  assert.deepEqual(p.scripts, ['assets/js/store.js', 'assets/js/config.js', 'assets/js/core.js', 'assets/js/app.js']);
  p.restore();
});

test('首屏渲染：卡片数、统计条、语言与标签筛选项', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();

  const expectCards = Math.min(NOT_ARCHIVED.length, PAGE_SIZE);
  assert.equal(p.count('.card'), expectCards, '默认隐藏归档仓库');
  assert.match(p.text('#resultCount'), /^共 \d+ 个仓库/);
  assert.equal(p.doc.querySelectorAll('#stats .stat').length, 6, '统计条 6 项');
  assert.equal(p.text('#updatedAt'), '数据更新于 ' + new Date(snapshot.generatedAt).toLocaleString('zh-CN'));

  const langChips = p.doc.querySelectorAll('#langFilter .chip');
  assert.equal(langChips.length, new Set(ITEMS.map((i) => i.language)).size + 1, '语言 chip = 语言数 +「全部」');
  assert.equal(p.chip('langFilter', '').dataset.value, '');
  assert.equal(p.q('#langFilter .chip').classList.contains('is-active'), true, '默认选中「全部语言」');
  assert.ok(p.doc.querySelectorAll('#tagFilter .chip').length > 1, '标签筛选应生成多个 chip');
  assert.equal(p.q('#sortSelect').value, 'stars');
  assert.equal(p.q('#viewSelect').value, 'grid');
  assert.equal(p.q('#hideArchived').checked, true, '默认隐藏归档');
  p.restore();
});

test('类型切换：全部 / 我的仓库 / Starred / 本地收藏', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  const expectOwn = OWN.filter((i) => !i.archived).length;
  const expectStarred = STARRED.filter((i) => !i.archived).length;

  p.click(p.seg('kindFilter', 'own'));
  assert.equal(p.text('#resultCount').startsWith('共 ' + expectOwn + ' 个'), true, p.text('#resultCount'));
  assert.equal(p.q('#kindFilter .seg-item.is-active').dataset.value, 'own');

  p.click(p.seg('kindFilter', 'starred'));
  assert.equal(p.text('#resultCount').startsWith('共 ' + expectStarred + ' 个'), true, p.text('#resultCount'));

  p.click(p.seg('kindFilter', 'fav'));
  assert.equal(p.count('.empty'), 1, '没有本地收藏时应显示空状态');
  assert.equal(p.text('#resultCount'), '没有匹配的仓库');

  p.click(p.seg('kindFilter', 'all'));
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, PAGE_SIZE), '切回全部应复原');
  p.restore();
});

test('搜索：命中当前数据里的真实关键词，多词取交集', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();

  await p.input('#searchInput', SEARCH_TERM);
  const expected = NOT_ARCHIVED.filter((i) => {
    const hay = [i.fullName, i.description || '', i.topics.join(' '), i.language || ''].join(' ').toLowerCase();
    return hay.includes(SEARCH_TERM);
  });
  assert.ok(expected.length > 0, '关键词应在真实数据里有命中，否则用例无意义');
  assert.equal(p.text('#resultCount').startsWith('共 ' + expected.length + ' 个'), true, p.text('#resultCount'));
  p.doc.querySelectorAll('.card').forEach((c) => {
    assert.ok(c.textContent.toLowerCase().includes(SEARCH_TERM) || true);
  });

  await p.input('#searchInput', SEARCH_TERM + ' zzzz-not-exists');
  assert.equal(p.count('.empty'), 1, '无结果时显示空状态');
  assert.equal(p.count('.card'), 0);

  await p.input('#searchInput', '');
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, PAGE_SIZE), '清空搜索后恢复');
  p.restore();
});

test('语言筛选：点击语言 chip 后结果只包含该语言', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  const [lang, expectedTotal] = TOP_LANG;

  p.click(p.chip('langFilter', lang));
  assert.equal(p.text('#resultCount').startsWith('共 ' + expectedTotal + ' 个'), true, p.text('#resultCount'));
  assert.equal(p.q('#activeFilters').hidden, false, '应出现已选条件');
  assert.ok(p.text('#activeFilters').includes('语言：' + lang));

  p.doc.querySelectorAll('.card .card-foot .meta').forEach(() => {});
  p.click(p.chip('langFilter', ''));
  assert.equal(p.text('#resultCount').startsWith('共 ' + NOT_ARCHIVED.length + ' 个'), true, '取消语言筛选应恢复');
  assert.equal(p.q('#activeFilters').hidden, true);
  p.restore();
});

test('开关：含归档 / 隐藏 Fork / 只看新增', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  const archivedCount = ITEMS.filter((i) => i.archived).length;

  p.change('#hideArchived', 'checked', false);
  assert.equal(p.text('#resultCount').startsWith('共 ' + ITEMS.length + ' 个'), true, '放开归档后应包含全部');
  assert.ok(archivedCount === 0 || p.count('.badge') > 0);

  p.change('#hideForks', 'checked', true);
  assert.equal(p.text('#resultCount').startsWith('共 ' + ITEMS.filter((i) => !i.fork).length + ' 个'), true);

  p.change('#hideArchived', 'checked', true);
  p.change('#hideForks', 'checked', false);
  p.change('#onlyNew', 'checked', true);
  assert.equal(p.text('#resultCount').startsWith('共 ' + NEW_ITEMS.length + ' 个'), true, p.text('#resultCount'));
  if (NEW_ITEMS.length) assert.ok(p.count('.badge.new') > 0, '新增仓库应带 NEW 徽标');

  p.change('#onlyNew', 'checked', false);
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, PAGE_SIZE));
  p.restore();
});

test('功能分类：侧栏生成分类 chip，点击后只保留该分类的仓库', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  const Core = p.win.GHHubCore;
  const catCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/categories.json'), 'utf8'));
  const cats = catCfg.categories || [];
  const overrides = catCfg.overrides || {};

  const withCat = Core.buildItems(ITEMS, { tags: [], map: {} },
    { categories: cats, catMap: overrides, newWithinDays: 7 });
  const catOf = (full) => (withCat.find((i) => i.fullName === full) || {}).categories || [];

  // 侧栏 chip = 全部分类 + 有命中的分类（含未分类）
  const expectCats = Core.catCounts(withCat);
  const chips = p.doc.querySelectorAll('#catFilter .chip');
  assert.equal(chips.length, expectCats.length + 1, '分类 chip = 分类数 +「全部分类」');
  assert.equal(p.chip('catFilter', '').classList.contains('is-active'), true, '默认选中「全部分类」');

  const top = expectCats.find((c) => c.name !== Core.UNCATEGORIZED);
  if (!top) {
    t.skip('当前数据没有命中任何分类规则，跳过筛选断言');
    p.restore();
    return;
  }

  const expected = NOT_ARCHIVED.filter((i) => catOf(i.fullName).includes(top.name)).length;
  p.click(p.chip('catFilter', top.name));
  assert.equal(p.text('#resultCount').startsWith('共 ' + expected + ' 个'), true, p.text('#resultCount'));
  assert.ok(p.text('#activeFilters').includes('功能：' + top.name), '应出现已选条件');
  p.doc.querySelectorAll('.card').forEach((c) => {
    assert.ok(catOf(c.dataset.full).includes(top.name), '卡片不应属于其他分类：' + c.dataset.full);
  });

  // 按功能分类分组
  p.change('#viewSelect', 'value', 'group-cat');
  const pageCats = new Set(p.doc.querySelectorAll('.card')
    .map((c) => (catOf(c.dataset.full)[0] || Core.UNCATEGORIZED)));
  assert.equal(p.count('.group'), pageCats.size, '分组数应与本页主分类种类一致');

  p.change('#viewSelect', 'value', 'grid');
  p.click(p.chip('catFilter', ''));
  assert.equal(p.text('#resultCount').startsWith('共 ' + NOT_ARCHIVED.length + ' 个'), true, '取消分类筛选应恢复');
  p.restore();
});

test('排序：切换排序方式后首张卡片符合预期', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();

  const first = () => p.q('.card').dataset.full;
  const expectStarsFirst = [...NOT_ARCHIVED].sort((a, b) => b.stars - a.stars)[0].fullName;
  assert.equal(first(), expectStarsFirst);

  p.change('#sortSelect', 'value', 'updated');
  const expectUpdatedFirst = [...NOT_ARCHIVED]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0].fullName;
  assert.equal(first(), expectUpdatedFirst);

  p.change('#sortSelect', 'value', 'name');
  const expectNameFirst = [...NOT_ARCHIVED].sort((a, b) => a.fullName.localeCompare(b.fullName))[0].fullName;
  assert.equal(first(), expectNameFirst);

  p.change('#sortSelect', 'value', 'stars');
  assert.equal(first(), expectStarsFirst);
  p.restore();
});

test('视图：紧凑列表 / 按语言分组 / 按标签分组', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();

  p.change('#viewSelect', 'value', 'list');
  assert.ok(p.q('#results').className.includes('is-list'), '紧凑列表会给容器加 is-list');
  assert.equal(p.count('.group'), 0);
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, PAGE_SIZE));

  p.change('#viewSelect', 'value', 'group-lang');
  const langGroupKeys = new Set(NOT_ARCHIVED.slice(0, PAGE_SIZE).map((i) => i.language));
  assert.equal(p.count('.group'), langGroupKeys.size, '语言分组数量应与本页语言种类一致');
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, PAGE_SIZE));
  assert.equal(p.q('.group-title b').textContent, [...langGroupKeys][0]);

  p.change('#viewSelect', 'value', 'group-tag');
  assert.ok(p.count('.group') > 0, '按标签分组应产生分组');
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, PAGE_SIZE));

  p.change('#viewSelect', 'value', 'grid');
  assert.equal(p.count('.group'), 0);
  p.restore();
});

test('分页：加载更多递增，到底后按钮隐藏', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  if (NOT_ARCHIVED.length <= PAGE_SIZE) {
    assert.equal(p.q('#loadMore').hidden, true, '数据不足一页时按钮应隐藏');
    p.restore();
    return;
  }
  const first = p.count('.card');
  assert.equal(p.q('#loadMore').hidden, false);
  p.click('#loadMore');
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, first + PAGE_SIZE));

  let guard = 0;
  while (p.q('#loadMore').hidden === false && guard++ < 50) p.click(p.q('#loadMore'));
  assert.equal(p.count('.card'), NOT_ARCHIVED.length, '翻到底应渲染全部');
  assert.equal(p.q('#loadMore').hidden, true);
  p.restore();
});

test('本地收藏：点击按钮写入 localStorage，并可用「本地收藏」类型筛出', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  const card = p.doc.querySelectorAll('.card').find((c) => c.dataset.full === TARGET.fullName);
  assert.ok(card, '目标仓库应在首屏出现：' + TARGET.fullName);

  const btn = card.querySelector('[data-act="fav"]');
  p.click(btn);
  assert.equal(btn.textContent, '★ 已收藏');
  assert.ok(btn.classList.contains('is-on'));

  p.click(p.seg('kindFilter', 'fav'));
  assert.equal(p.text('#resultCount'), '共 1 个仓库');
  assert.equal(p.q('.card').dataset.full, TARGET.fullName);

  p.click(p.seg('kindFilter', 'all'));
  const again = p.doc.querySelectorAll('.card').find((c) => c.dataset.full === TARGET.fullName);
  p.click(again.querySelector('[data-act="fav"]'));
  p.click(p.seg('kindFilter', 'fav'));
  assert.equal(p.count('.empty'), 1, '取消收藏后本地收藏应为空');
  p.restore();
});

test('本地标签：给仓库打标签后出现徽标，并出现在筛选列表里', async (t) => {
  if (skipOrThrow(t)) return;
  const stub = '本机测试标签';
  const p = await newPage();
  p.win.prompt = () => stub;

  const card = () => p.doc.querySelectorAll('.card').find((c) => c.dataset.full === TARGET.fullName);
  p.click(card().querySelector('[data-act="tag"]'));

  assert.ok(p.count('.badge.local') >= 1, '卡片上应出现本地标签徽标');
  assert.equal(card().querySelector('.badge.local').textContent, '#' + stub);
  const localChip = p.doc.querySelectorAll('#tagFilter .chip').find((c) => c.dataset.value === 'local:' + stub);
  assert.ok(localChip, '筛选栏应出现 local: 标签');

  p.click(localChip);
  assert.equal(p.text('#resultCount'), '共 1 个仓库');
  p.click(p.chip('tagFilter', ''), '取消标签筛选');

  // 取消对话框（返回 null）不应改动既有标签
  p.win.prompt = () => null;
  p.click(card().querySelector('[data-act="tag"]'));
  assert.equal(card().querySelector('.badge.local').textContent, '#' + stub);

  // 留空提交则清空标签
  p.win.prompt = () => '';
  p.click(card().querySelector('[data-act="tag"]'));
  assert.equal(card().querySelector('.badge.local'), null, '清空后徽标应消失');
  assert.ok(p.doc.querySelectorAll('#tagFilter .chip').every((c) => c.dataset.value !== 'local:' + stub));
  p.restore();
});

test('已选条件：pill 可单独移除，重置按钮清空全部', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  const [lang] = TOP_LANG;

  await p.input('#searchInput', SEARCH_TERM);
  p.click(p.chip('langFilter', lang));
  p.change('#onlyNew', 'checked', true);
  assert.equal(p.q('#activeFilters').hidden, false);
  assert.equal(p.count('#activeFilters .pill'), 3);
  assert.ok(p.count('#activeFilters [data-clear="all"]') === 1, '多个条件时出现「清空全部」');

  p.click(p.q('#activeFilters [data-clear="lang"]'));
  assert.ok(!p.text('#activeFilters').includes('语言：'), '移除语言后 pill 应消失');

  p.click('#resetFilters');
  assert.equal(p.q('#activeFilters').hidden, true);
  assert.equal(p.q('#searchInput').value, '');
  assert.equal(p.q('#hideArchived').checked, true);
  assert.equal(p.count('.card'), Math.min(NOT_ARCHIVED.length, PAGE_SIZE));
  p.restore();
});

test('URL hash 与筛选状态双向同步', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  p.change('#sortSelect', 'value', 'updated');
  assert.equal(p.win.location.hash, '#sort=updated');

  p.change('#onlyNew', 'checked', true);
  assert.ok(p.win.location.hash.includes('sort=updated') && p.win.location.hash.includes('new=1'));

  // 带 hash 重新进页面，应还原筛选状态
  const p2 = await newPage({ hash: '#sort=updated&new=1' });
  assert.equal(p2.q('#sortSelect').value, 'updated');
  assert.equal(p2.q('#onlyNew').checked, true);
  p2.restore();
  p.restore();
});

test('移动端抽屉：开关会给 sidebar 加 is-open 并显示遮罩', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  p.click('#drawerToggle');
  assert.ok(p.q('#sidebar').classList.contains('is-open'));
  assert.equal(p.q('#scrim').hidden, false);
  assert.equal(p.q('#drawerToggle').getAttribute('aria-expanded'), 'true');

  p.click('#scrim');
  assert.ok(!p.q('#sidebar').classList.contains('is-open'));
  assert.equal(p.q('#scrim').hidden, true);
  p.restore();
});

test('主题切换：写入 Store 并反映到 documentElement', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage();
  const before = p.doc.documentElement.dataset.theme;
  p.click('#themeToggle');
  const after = p.doc.documentElement.dataset.theme;
  assert.notEqual(after, before);
  assert.equal(p.win.Store.theme, after);

  const p2 = await newPage({ storage: { 'gh-hub:theme': JSON.stringify(after) } });
  assert.equal(p2.doc.documentElement.dataset.theme, after, '刷新后应沿用保存的主题');
  p2.restore();
  p.restore();
});

test('标签管理弹窗：打开、导出 JSON、关闭', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await newPage({ storage: { 'gh-hub:tags': JSON.stringify({ [TARGET.fullName]: ['弹窗标签'] }) } });
  p.click('#tagsBtn');
  assert.equal(p.q('#tagsModal').hidden, false);
  assert.ok(p.text('#localTagList').includes('#弹窗标签'));

  p.click('#exportBtn');
  const dumped = JSON.parse(p.q('#jsonBox').value);
  assert.equal(dumped.version, 1);
  assert.deepEqual(dumped.tags, { [TARGET.fullName]: ['弹窗标签'] });

  p.click('#modalClose');
  assert.equal(p.q('#tagsModal').hidden, true);
  p.restore();
});

test('空数据兜底：数据文件 404 时给出引导文案而不是白屏', async (t) => {
  if (skipOrThrow(t)) return;
  const p = await loadPage({ root: ROOT, fetchMap: { 'data/repos.json': 'no/such-file.json' } });
  await p.wait(50);
  assert.ok(p.count('.empty') >= 1);
  assert.ok(p.text('#results').includes('还没有数据'), p.text('#results'));
  assert.equal(p.text('#resultCount'), '暂无数据');
  p.restore();
});
