/**
 * 页面加载助手：读取真实 index.html → 建立 DOM → 按 <script src> 顺序执行真实脚本，
 * 返回一组便于断言/交互的工具。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createDocument, createMemoryStorage, installGlobals, runScript, MouseEventImpl, DOMEvent
} from './dom-stub.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string} opts.root       项目根目录
 * @param {string} [opts.index]    入口 HTML，默认 index.html
 * @param {object} [opts.fetchMap] URL 路径 → 文件路径的映射（用于喂测试数据）
 * @param {object} [opts.storage]  localStorage 初始内容
 * @param {string} [opts.hash]     初始 location.hash
 */
export async function loadPage(opts) {
  const root = opts.root;
  const html = fs.readFileSync(path.join(root, opts.index || 'index.html'), 'utf8');
  const doc = createDocument(html);
  const errors = [];

  const restore = installGlobals({
    doc,
    rootDir: root,
    fetchMap: opts.fetchMap || {},
    storage: createMemoryStorage(opts.storage || {}),
    onError: (msg) => errors.push(msg)
  });
  if (opts.hash) globalThis.location.hash = opts.hash;

  const scripts = doc.querySelectorAll('script')
    .map((s) => s.getAttribute('src'))
    .filter(Boolean);

  scripts.forEach((src) => {
    try {
      runScript(path.join(root, src));
    } catch (err) {
      errors.push(src + ' 抛错：' + (err.stack || err.message));
    }
  });

  const win = globalThis;

  const api = {
    win,
    doc,
    errors,
    scripts,
    restore,
    wait,
    q: (sel) => doc.querySelector(sel),
    qa: (sel) => doc.querySelectorAll(sel),
    text: (sel) => {
      const el = doc.querySelector(sel);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    },
    count: (sel) => doc.querySelectorAll(sel).length,
    click: (elOrSel) => {
      const el = typeof elOrSel === 'string' ? doc.querySelector(elOrSel) : elOrSel;
      if (!el) throw new Error('找不到元素：' + elOrSel);
      el.dispatchEvent(new MouseEventImpl('click', { bubbles: true }));
      return el;
    },
    input: (elOrSel, value, settleMs) => {
      const el = typeof elOrSel === 'string' ? doc.querySelector(elOrSel) : elOrSel;
      if (!el) throw new Error('找不到输入框：' + elOrSel);
      el.value = value;
      el.dispatchEvent(new DOMEvent('input', { bubbles: true }));
      return wait(settleMs == null ? 300 : settleMs); // 输入有 220ms 防抖
    },
    change: (elOrSel, key, value) => {
      const el = typeof elOrSel === 'string' ? doc.querySelector(elOrSel) : elOrSel;
      if (!el) throw new Error('找不到控件：' + elOrSel);
      if (key) el[key] = value;
      el.dispatchEvent(new DOMEvent('change', { bubbles: true }));
      return el;
    },
    keydown: (key) => doc.dispatchEvent(new DOMEvent('keydown', { bubbles: true, key })),
    seg: (containerId, value) =>
      doc.querySelectorAll('#' + containerId + ' .seg-item').find((b) => b.dataset.value === value),
    chip: (containerId, value) =>
      doc.querySelectorAll('#' + containerId + ' .chip').find((c) => (c.dataset.value || '') === value),
    async ready(settleMs) {
      await wait(settleMs == null ? 50 : settleMs);
      return api;
    }
  };

  return api.ready();
}

export { wait };
