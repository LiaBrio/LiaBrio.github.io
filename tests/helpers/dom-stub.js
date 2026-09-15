/**
 * 零依赖轻量 DOM / BOM 桩 —— 只为跑通 assets/js/*.js，不是通用浏览器实现。
 *
 * 支持范围（均为本项目实际用到的能力）：
 *  - HTML 解析：标签、属性（双引号/单引号/无值）、文本、注释、DOCTYPE、void 元素
 *  - 选择器：tag / .class / #id / [attr] / [attr="v"]、复合、后代组合、逗号列表、closest()
 *  - 元素：dataset、classList、hidden、textContent、innerHTML、children、value、checked、
 *          focus、select、setAttribute / getAttribute
 *  - 事件：addEventListener + 冒泡链 + preventDefault
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea']);

/* ---------------- 文本节点 ---------------- */

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.text = String(text);
    this.parentNode = null;
  }
  get textContent() { return this.text; }
  set textContent(v) { this.text = String(v == null ? '' : v); }
  serialize() { return escapeText(this.text); }
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------- 属性名转换 ---------------- */

const kebabToCamel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const camelToKebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const datasetHandler = {
  get(el, prop) {
    if (typeof prop !== 'string') return undefined;
    return el.hasAttribute('data-' + camelToKebab(prop)) ? el.getAttribute('data-' + camelToKebab(prop)) : undefined;
  },
  set(el, prop, value) {
    el.setAttribute('data-' + camelToKebab(prop), String(value));
    return true;
  },
  deleteProperty(el, prop) {
    el.removeAttribute('data-' + camelToKebab(prop));
    return true;
  },
  has(el, prop) {
    return typeof prop === 'string' && el.hasAttribute('data-' + camelToKebab(prop));
  }
};

/* ---------------- 元素 ---------------- */

class Element {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.localName = String(tagName).toLowerCase();
    this.attributes = Object.create(null);
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = new Proxy(this, datasetHandler);
    this.style = {};
    this._listeners = Object.create(null);
    this._classes = new Set();
    this.selected = false;
    // 表单控件的自有属性（可被脚本直接赋值）
    if (this.localName === 'input' || this.localName === 'textarea' || this.localName === 'select') {
      this.value = '';
      this.files = null;
      if (this.localName === 'input') this.checked = false;
    }
  }

  /* 属性 */
  get id() { return this.attributes.id || ''; }
  setAttribute(name, value) {
    this.attributes[name] = String(value == null ? '' : value);
    if (name === 'class') this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
    if (name === 'value' && 'value' in this) this.value = String(value);
    if (name === 'checked') this.checked = true;
  }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'class') this._classes = new Set(); }
  hasAttribute(name) { return name in this.attributes; }

  /* class */
  get className() { return [...this._classes].join(' '); }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const el = this;
    return {
      add: (...cs) => { cs.forEach((c) => el._classes.add(c)); syncClass(el); },
      remove: (...cs) => { cs.forEach((c) => el._classes.delete(c)); syncClass(el); },
      contains: (c) => el._classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !el._classes.has(c) : !!force;
        if (on) el._classes.add(c); else el._classes.delete(c);
        syncClass(el);
        return on;
      }
    };
  }

  /* 结构 */
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get textContent() {
    return this.childNodes.map((n) => (n.nodeType === 3 ? n.text : n.textContent)).join('');
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) appendChild(this, new TextNode(v));
  }
  get innerHTML() { return this.childNodes.map((n) => n.serialize()).join(''); }
  set innerHTML(html) {
    this.childNodes = [];
    parseInto(this, String(html));
  }
  appendChild(node) { return appendChild(this, node); }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i !== -1) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) {
    let cur = node;
    while (cur) { if (cur === this) return true; cur = cur.parentNode; }
    return false;
  }
  serialize() {
    const attrs = Object.keys(this.attributes).map((k) =>
      this.attributes[k] === '' ? ` ${k}` : ` ${k}="${this.attributes[k].replace(/"/g, '&quot;')}"`).join('');
    if (VOID_TAGS.has(this.localName)) return `<${this.localName}${attrs}>`;
    return `<${this.localName}${attrs}>${this.childNodes.map((n) => n.serialize()).join('')}</${this.localName}>`;
  }

  /* 表单 / 焦点 */
  focus() { docOf(this).activeElement = this; }
  blur() { if (docOf(this).activeElement === this) docOf(this).activeElement = docOf(this).body; }
  select() { this._selected = true; }
  setAttributeChecked() { this.checked = true; }

  /* 查询 */
  matches(selector) {
    return matchesSelectorInTree(this, selector);
  }
  closest(selector) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (matchesSelectorInTree(cur, selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    return queryAll(this, selector);
  }

  /* 事件 */
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type] || [];
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    let node = this;
    while (node) {
      const list = node._listeners && node._listeners[ev.type];
      if (list) {
        ev.currentTarget = node;
        list.slice().forEach((fn) => fn.call(node, ev));
      }
      if (!ev.bubbles) break;
      node = node.parentNode;
    }
    return !ev.defaultPrevented;
  }
}

Object.defineProperty(Element.prototype, 'hidden', {
  get() { return this.hasAttribute('hidden'); },
  set(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); },
  configurable: true
});

function syncClass(el) {
  el.attributes.class = [...el._classes].join(' ');
}

function appendChild(parent, node) {
  node.parentNode = parent;
  parent.childNodes.push(node);
  return node;
}

function docOf(node) {
  let cur = node;
  while (cur && cur.parentNode) cur = cur.parentNode;
  return cur && cur._isDocument ? cur : global.document;
}

/* ---------------- 选择器引擎 ---------------- */

function parseToken(token) {
  const out = { tag: '', id: '', classes: [], attrs: [] };
  let rest = token;
  const attrRe = /\[([a-zA-Z0-9_:\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let m;
  while ((m = attrRe.exec(token))) {
    out.attrs.push({ name: m[1], value: m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : null)) });
    rest = rest.replace(m[0], '');
  }
  const idMatch = /#([A-Za-z0-9_\-:]+)/.exec(rest);
  if (idMatch) { out.id = idMatch[1]; rest = rest.replace(idMatch[0], ''); }
  const clsIter = rest.matchAll(/\.([A-Za-z0-9_\-:]+)/g);
  for (const c of clsIter) out.classes.push(c[1]);
  const tagMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(rest.replace(/\.[A-Za-z0-9_\-:]+/g, ''));
  if (tagMatch) out.tag = tagMatch[0].toUpperCase();
  return out;
}

function matchToken(el, token) {
  if (el.nodeType !== 1) return false;
  if (token.tag && token.tag !== '*' && el.tagName !== token.tag) return false;
  if (token.id && el.id !== token.id) return false;
  for (const c of token.classes) if (!el._classes.has(c)) return false;
  for (const a of token.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== null && el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

function descendants(root, out) {
  out = out || [];
  root.childNodes.forEach((n) => {
    if (n.nodeType === 1) { out.push(n); descendants(n, out); }
  });
  return out;
}

function matchAncestorChain(el, tokens) {
  let i = tokens.length - 1;
  let cur = el.parentNode;
  while (i >= 0) {
    if (!cur || cur.nodeType !== 1) return false;
    if (matchToken(cur, tokens[i])) i--;
    cur = cur.parentNode;
  }
  return true;
}

function queryAllPart(root, part) {
  const tokens = part.split(/\s+/).filter(Boolean).map(parseToken);
  if (!tokens.length) return [];
  const last = tokens[tokens.length - 1];
  const rest = tokens.slice(0, -1);
  return descendants(root).filter((el) => matchToken(el, last) && matchAncestorChain(el, rest));
}

function queryAll(root, selector) {
  return String(selector).split(',').reduce((acc, part) => acc.concat(queryAllPart(root, part.trim())), []);
}

function matchesSelectorInTree(el, selector) {
  return String(selector).split(',').some((part) => {
    const tokens = part.trim().split(/\s+/).filter(Boolean).map(parseToken);
    if (tokens.length !== 1) return false;
    return matchToken(el, tokens[0]);
  });
}

/* ---------------- HTML 解析器 ---------------- */

function parseInto(parent, html) {
  const stack = [];
  let current = parent;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { pushText(current, html.slice(i)); break; }
    if (lt > i) pushText(current, html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end).trim().toLowerCase();
      i = end + 1;
      // 弹栈直到匹配的开始标签（容忍不规范嵌套）
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].localName === name) { stack.length = s; break; }
      }
      current = stack.length ? stack[stack.length - 1] : parent;
      continue;
    }

    const attrs = {};
    let j = lt + 1;
    let tagName = '';
    while (j < html.length && !/[\s/>]/.test(html[j])) { tagName += html[j]; j++; }
    tagName = tagName.toLowerCase();
    while (j < html.length) {
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === '>' || html.startsWith('/>', j)) break;
      let name = '';
      while (j < html.length && !/[\s=/>]/.test(html[j])) { name += html[j]; j++; }
      while (j < html.length && /\s/.test(html[j])) j++;
      let value = '';
      if (html[j] === '=') {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        const quote = html[j];
        if (quote === '"' || quote === "'") {
          j++;
          const end = html.indexOf(quote, j);
          value = html.slice(j, end === -1 ? html.length : end);
          j = end === -1 ? html.length : end + 1;
        } else {
          while (j < html.length && !/[\s>]/.test(html[j])) { value += html[j]; j++; }
        }
      }
      attrs[name] = value;
    }
    const selfClose = html.startsWith('/>', j);
    i = (html.indexOf('>', j) === -1 ? html.length : html.indexOf('>', j)) + 1;

    if (!tagName) continue;
    const el = new Element(tagName);
    Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    if (VOID_TAGS.has(tagName)) {
      appendChild(current, el);
    } else if (!selfClose) {
      appendChild(current, el);
      stack.push(el);
      current = el;
      if (RAW_TEXT_TAGS.has(tagName)) {
        const close = html.toLowerCase().indexOf('</' + tagName, i);
        const stop = close === -1 ? html.length : close;
        const text = html.slice(i, stop);
        if (text) appendChild(el, new TextNode(text));
        i = stop === html.length ? html.length : html.indexOf('>', stop) + 1;
        stack.pop();
        current = stack.length ? stack[stack.length - 1] : parent;
      }
    } else {
      appendChild(current, el);
    }
  }
}

function pushText(parent, text) {
  const cleaned = text.replace(/&[a-z]+;|&#\d+;/g, ''); // 不需要实体解码精度，先剥离
  if (cleaned.trim() === '') return;
  appendChild(parent, new TextNode(cleaned));
}

/* ---------------- Document ---------------- */

class Document {
  constructor() {
    this.nodeType = 9;
    this._isDocument = true;
    this.parentNode = null;
    this.childNodes = [];
    this.title = '';
    this.readyState = 'complete';
    this._listeners = Object.create(null);
    this.documentElement = null;
    this.body = null;
    this.activeElement = null;
  }
  getElementById(id) {
    return descendants(this).find((el) => el.id === id) || null;
  }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  createElement(tag) { return new Element(tag); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const list = this._listeners[type] || [];
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }
  dispatchEvent(ev) { return Element.prototype.dispatchEvent.call(this, ev); }
  execCommand() { return true; }
  get textContent() { return this.documentElement ? this.documentElement.textContent : ''; }
}

function createDocument(html) {
  const doc = new Document();
  parseInto(doc, String(html));
  const roots = doc.childNodes.filter((n) => n.nodeType === 1);
  doc.documentElement = roots.find((r) => r.localName === 'html') || roots[0] || null;
  doc.body = doc.documentElement
    ? doc.documentElement.children.find((c) => c.localName === 'body') || doc.documentElement
    : null;
  doc.activeElement = doc.body;
  return doc;
}

/* ---------------- 事件对象 ---------------- */

class DOMEvent {
  constructor(type, opts) {
    opts = opts || {};
    this.type = type;
    this.bubbles = !!opts.bubbles;
    this.cancelable = !!opts.cancelable;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    if (opts.key !== undefined) this.key = opts.key;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.bubbles = false; }
}

class MouseEventImpl extends DOMEvent {
  constructor(type, opts) { super(type, opts); this.button = 0; }
  get dataset() { return (this.target && this.target.dataset) || {}; }
}

/* ---------------- 内存 localStorage ---------------- */

function createMemoryStorage(seed) {
  const map = new Map();
  if (seed) Object.keys(seed).forEach((k) => map.set(k, String(seed[k])));
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] || null,
    get length() { return map.size; },
    // 允许 Object.keys(localStorage)（store.clearAll 用了它）
    _map: map
  };
}

/** 让 Object.keys(storage) 可用：返回一个带索引属性的对象视图 */
function storageProxy(raw) {
  return new Proxy(raw, {
    ownKeys() { return [...raw._map.keys()]; },
    getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
  });
}

/* ---------------- 全局安装 ---------------- */

/**
 * 把 DOM/BOM 桩装到 Node 全局上（浏览器脚本通过 vm 在全局作用域执行）。
 * 返回卸载函数。
 */
function installGlobals(opts) {
  const { doc, rootDir, fetchMap, storage, location: loc, onError } = opts;
  const win = globalThis;
  const prev = {};
  const set = (name, value) => {
    prev[name] = Object.getOwnPropertyDescriptor(win, name);
    Object.defineProperty(win, name, { value, writable: true, configurable: true });
  };

  win.window = win;
  set('window', win);
  set('document', doc);
  set('localStorage', storageProxy(storage));
  set('location', Object.assign({ hash: '', pathname: '/', href: loc || 'http://localhost/' }, {}));
  set('history', {
    replaceState(_state, _title, url) {
      const s = String(url || '');
      const i = s.indexOf('#');
      globalThis.location.hash = i === -1 ? '' : s.slice(i);
    },
    pushState(_state, _title, url) { this.replaceState(_state, _title, url); }
  });
  set('innerWidth', 1280);
  set('scrollTo', () => {});
  set('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  set('prompt', () => null);
  set('confirm', () => true);
  set('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));

  // window 级事件（Node 全局没有 EventTarget）
  const winListeners = Object.create(null);
  set('addEventListener', (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); });
  set('removeEventListener', (type, fn) => {
    const list = winListeners[type] || [];
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  });
  set('dispatchEvent', (ev) => {
    const list = winListeners[ev.type] || [];
    ev.target = ev.target || null;
    list.slice().forEach((fn) => fn(ev));
    return !ev.defaultPrevented;
  });

  const nav = { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'node-dom-stub' };
  try {
    Object.defineProperty(win, 'navigator', { value: nav, writable: true, configurable: true });
  } catch (e) { /* 忽略：某些 Node 版本的 navigator 不可覆盖 */ }

  set('fetch', (url, _init) => {
    let rel = String(url).replace(/^https?:\/\/[^/]+\//, '');
    rel = decodeURIComponent(rel.split('?')[0]);
    const mapped = fetchMap && fetchMap[rel] ? fetchMap[rel] : rel;
    const file = path.isAbsolute(mapped) ? mapped : path.join(rootDir, mapped);
    try {
      const text = fs.readFileSync(file, 'utf8');
      return Promise.resolve({
        ok: true, status: 200, url: String(url),
        json: () => Promise.resolve(JSON.parse(text)),
        text: () => Promise.resolve(text)
      });
    } catch (e) {
      return Promise.resolve({ ok: false, status: 404, url: String(url), json: () => Promise.reject(new Error('404 ' + rel)), text: () => Promise.resolve('') });
    }
  });

  set('MouseEvent', MouseEventImpl);

  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args) => { if (onError) onError(args.join(' ')); };
  console.warn = () => {};

  return function restore() {
    console.error = origError;
    console.warn = origWarn;
    Object.keys(prev).forEach((name) => {
      if (prev[name]) Object.defineProperty(win, name, prev[name]);
      else delete win[name];
    });
  };
}

/** 在全局作用域执行浏览器脚本（等价于浏览器里 <script> 执行） */
function runScript(file, onError) {
  try {
    return vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (err) {
    if (onError) onError(file + ': ' + (err.stack || err.message));
    throw err;
  }
}

export {
  Element, TextNode, Document, DOMEvent, MouseEventImpl,
  createDocument, createMemoryStorage, installGlobals, runScript,
  queryAll, parseToken
};
