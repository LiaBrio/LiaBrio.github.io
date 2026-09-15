/**
 * 本地数据层（assets/js/store.js）单元测试：收藏、标签、导入导出、异常降级。
 * 用 DOM 桩提供的 localStorage + window，脚本本身就是浏览器里跑的那一份。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createDocument, createMemoryStorage, installGlobals } from '../helpers/dom-stub.js';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const CODE = fs.readFileSync(path.join(ROOT, 'assets/js/store.js'), 'utf8');

/** 每个用例用一份干净的 storage，重新执行脚本拿到 Store */
function freshStore(seed) {
  const storage = createMemoryStorage({});
  const restore = installGlobals({
    doc: createDocument('<html><body></body></html>'),
    rootDir: ROOT,
    storage,
    fetchMap: {},
    onError: () => {}
  });
  vm.runInThisContext(CODE, { filename: path.join(ROOT, 'assets/js/store.js') });
  const Store = globalThis.Store;
  if (seed) Store.importAll(seed);
  return { Store, storage, restore };
}

test('toggleFav：加入 → 已收藏，再点一次移除，且持久化到 localStorage', () => {
  const { Store, storage } = freshStore();
  assert.equal(Store.isFav('acme/tool'), false);
  assert.equal(Store.toggleFav('acme/tool'), true, '首次点击返回「已加入」');
  assert.deepEqual(Store.favs, ['acme/tool']);
  assert.equal(JSON.parse(storage.getItem('gh-hub:favs')).length, 1, '会写入 localStorage');

  assert.equal(Store.toggleFav('acme/tool'), false, '再次点击返回「已移除」');
  assert.deepEqual(Store.favs, []);

  Store.toggleFav('a/1');
  Store.toggleFav('b/2');
  assert.deepEqual(Store.favs, ['a/1', 'b/2'], '多个收藏保持顺序');
});

test('favs：localStorage 里是脏数据时回退为空数组而不抛错', () => {
  const { Store, storage } = freshStore();
  storage.setItem('gh-hub:favs', '{不是合法 JSON');
  assert.deepEqual(Store.favs, []);
});

test('setTags：中英文逗号与空白切分、去 # 前缀、上限 12 个', () => {
  const { Store } = freshStore();
  assert.deepEqual(Store.setTags('acme/tool', '前端, 工具，cli  常用'), ['前端', '工具', 'cli', '常用']);
  assert.deepEqual(Store.setTags('acme/tool', '#vue #pinia'), ['vue', 'pinia']);
  assert.deepEqual(Store.setTags('acme/tool', ',,,  '), [], '全空时清空标签');
  assert.deepEqual(Store.tagsOf('acme/tool'), [], '空标签不应保留 key');

  const many = Array.from({ length: 15 }, (_, i) => 't' + i).join(',');
  assert.equal(Store.setTags('acme/tool', many).length, 12, '最多保留 12 个标签');
});

test('setTags：结果会持久化，tagsOf 可回读', () => {
  const { Store } = freshStore();
  Store.setTags('acme/tool', 'a,b');
  Store.setTags('acme/other', 'c');
  assert.deepEqual(Store.tagsOf('acme/tool'), ['a', 'b']);
  assert.deepEqual(Store.tagsOf('acme/other'), ['c']);
  assert.deepEqual(Store.tagsOf('nope/nope'), [], '未设置的仓库返回空数组');
  assert.deepEqual(Object.keys(Store.tags).sort(), ['acme/other', 'acme/tool']);
});

test('allLocalTags：统计所有仓库的标签出现次数', () => {
  const { Store } = freshStore();
  Store.setTags('acme/tool', '常用,cli');
  Store.setTags('beta/web', '常用');
  assert.deepEqual(Store.allLocalTags(), { 常用: 2, cli: 1 });
  assert.deepEqual(freshStore().Store.allLocalTags(), {});
});

test('exportAll / importAll：往返一致，且会过滤非法条目', () => {
  const { Store } = freshStore();
  Store.setTags('acme/tool', '常用');
  Store.toggleFav('acme/tool');
  const dump = Store.exportAll();
  assert.equal(dump.version, 1);
  assert.deepEqual(dump.favs, ['acme/tool']);

  const other = freshStore();
  other.Store.importAll(dump);
  assert.deepEqual(other.Store.exportAll(), dump, '导入后应与原数据一致');

  const dirty = freshStore();
  dirty.Store.importAll({ favs: ['ok/ok', 42, null, 'x/y'], tags: { 'a/b': ['t', 7], bad: 'not-array' } });
  assert.deepEqual(dirty.Store.favs, ['ok/ok', 'x/y'], '非字符串收藏被过滤');
  assert.deepEqual(dirty.Store.tags, { 'a/b': ['t'] }, '非字符串标签与非数组值被过滤');
});

test('importAll：非法入参直接抛错', () => {
  const { Store } = freshStore();
  assert.throws(() => Store.importAll(null), /JSON/);
  assert.throws(() => Store.importAll('字符串'), /JSON/);
  assert.throws(() => Store.importAll(undefined), /JSON/);
});

test('clearAll：清空收藏与标签，但保留主题偏好', () => {
  const { Store } = freshStore();
  Store.setTags('acme/tool', '常用');
  Store.toggleFav('acme/tool');
  Store.setTheme('light');
  Store.clearAll();
  assert.deepEqual(Store.favs, []);
  assert.deepEqual(Store.tags, {});
  assert.equal(Store.theme, 'light', '主题是用户偏好，不应被清掉');
});

test('setTheme / theme：读写主题', () => {
  const { Store } = freshStore();
  assert.equal(Store.theme, null, '未设置时返回 null');
  Store.setTheme('dark');
  assert.equal(Store.theme, 'dark');
});

test('localStorage 不可用时（如隐私模式）读写都不抛错', () => {
  const { Store, restore } = freshStore();
  restore(); // 先撤掉内存实现，模拟浏览器禁用存储
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError: localStorage 被禁用'); }
  });
  try {
    assert.doesNotThrow(() => { Store.toggleFav('acme/tool'); });
    assert.doesNotThrow(() => { Store.setTags('acme/tool', 'a'); });
    assert.deepEqual(Store.favs, []);
    assert.deepEqual(Store.tags, {});
  } finally {
    delete globalThis.localStorage;
  }
});
