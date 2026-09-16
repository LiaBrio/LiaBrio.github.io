/**
 * 纯逻辑层：数据增强、过滤、排序、分组、标签统计。
 * 不依赖 DOM，浏览器与 Node（测试）共用同一份实现。
 *
 * 浏览器：<script src="assets/js/core.js"></script> → window.GHHubCore
 * Node：  module.exports / globalThis.GHHubCore
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GHHubCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY = 86400000;

  /* ---------------- 格式化 ---------------- */

  function fmtNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }

  /** 相对时间；now 可注入以便测试确定性断言 */
  function relTime(iso, now) {
    if (!iso) return '';
    var diff = ((now == null ? Date.now() : now) - new Date(iso).getTime()) / 1000;
    if (diff < 0) return '刚刚';
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
    if (diff < 31536000) return Math.floor(diff / 2592000) + ' 个月前';
    return Math.floor(diff / 31536000) + ' 年前';
  }

  /* ---------------- 数据增强 ---------------- */

  /** 单项条件是否命中（全等匹配或关键词包含） */
  function hitValue(repo, field, v) {
    switch (field) {
      case 'fullNames': return String(repo.fullName).toLowerCase() === v;
      case 'owners': return String(repo.owner || '').toLowerCase() === v;
      case 'topics': return (repo.topics || []).some(function (t) { return String(t).toLowerCase() === v; });
      case 'languages': return String(repo.language || '').toLowerCase() === v;
      case 'keywords':
        return (repo.fullName + ' ' + (repo.description || '')).toLowerCase().indexOf(v) !== -1;
      default: return false;
    }
  }

  /** 规则命中：conditions 内任意字段匹配即生效 */
  function matchesRule(repo, match) {
    var fields = ['fullNames', 'owners', 'topics', 'languages', 'keywords'];
    for (var i = 0; i < fields.length; i++) {
      var vals = match[fields[i]];
      if (!Array.isArray(vals) || !vals.length) continue;
      for (var j = 0; j < vals.length; j++) {
        var v = String(vals[j]).toLowerCase();
        if (v && hitValue(repo, fields[i], v)) return true;
      }
    }
    return false;
  }

  /** 各类条件的置信权重：越精确的指派越优先 */
  var RULE_WEIGHT = { fullNames: 8, owners: 4, topics: 3, languages: 2, keywords: 1 };

  /** 规则命中得分 = 命中的条件权重之和，0 表示未命中 */
  function ruleScore(repo, match) {
    var fields = Object.keys(RULE_WEIGHT);
    var score = 0;
    for (var i = 0; i < fields.length; i++) {
      var vals = match[fields[i]];
      if (!Array.isArray(vals) || !vals.length) continue;
      for (var j = 0; j < vals.length; j++) {
        var v = String(vals[j]).toLowerCase();
        if (v && hitValue(repo, fields[i], v)) score += RULE_WEIGHT[fields[i]];
      }
    }
    return score;
  }

  var UNCATEGORIZED = '未分类';

  /**
   * 按功能给仓库打分归类，返回按得分降序的分类名数组（可能为空）。
   * cats: [{ name, match }]，顺序用于同分时兜底（靠前者优先）。
   */
  function classify(repo, cats) {
    var scored = [];
    (cats || []).forEach(function (c, idx) {
      if (!c || !c.name) return;
      var s = ruleScore(repo, c.match || c);
      if (s > 0) scored.push({ name: c.name, score: s, idx: idx });
    });
    scored.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
    return scored.map(function (s) { return s.name; });
  }

  /**
   * 把原始条目增强成便于渲染/检索的 item。
   * opts: { favs, tags, newWithinDays, now, categories, catMap }
   * categories 为功能分类规则 [{ name, match }]；catMap 为 fullName → 分类名(数组) 的强指派。
   */
  function buildItems(rawItems, rules, opts) {
    opts = opts || {};
    rules = rules || {};
    var favs = opts.favs || [];
    var tagsMap = opts.tags || {};
    var days = opts.newWithinDays == null ? 7 : opts.newWithinDays;
    var now = opts.now == null ? Date.now() : opts.now;
    var cutoff = now - days * DAY;
    var ruleList = Array.isArray(rules.tags) ? rules.tags : [];
    var ruleMap = rules.map || {};
    var cats = opts.categories || [];
    var catMap = opts.catMap || {};

    return (rawItems || []).map(function (r) {
      var tags = [];
      ruleList.forEach(function (rule) {
        if (rule && rule.name && matchesRule(r, rule.match || rule)) tags.push(rule.name);
      });
      (ruleMap[r.fullName] || []).forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });

      var localTags = tagsMap[r.fullName] || [];
      var topics = r.topics || [];
      var isNew = r.firstSeen ? new Date(r.firstSeen).getTime() >= cutoff : false;

      // 功能分类：强指派优先，其次按规则打分，得分类别按得分降序
      var manual = catMap[r.fullName];
      if (manual && !Array.isArray(manual)) manual = [manual];
      var categories = (manual || []).slice();
      if (!categories.length) categories = classify(r, cats);

      return {
        raw: r,
        id: r.id,
        fullName: r.fullName,
        name: r.name,
        owner: r.owner,
        desc: r.description || '',
        url: r.url,
        homepage: r.homepage && r.homepage !== r.url ? r.homepage : '',
        language: r.language || '未知',
        topics: topics,
        categories: categories,
        category: categories[0] || UNCATEGORIZED,
        customTags: tags,
        localTags: localTags,
        stars: r.stars || 0,
        forks: r.forks || 0,
        issues: r.issues || 0,
        starsDelta: r.starsDelta || 0,
        updatedAt: r.updatedAt,
        pushedAt: r.pushedAt,
        createdAt: r.createdAt,
        firstSeen: r.firstSeen,
        kind: r.kind,
        archived: !!r.archived,
        fork: !!r.fork,
        license: r.license || '',
        fav: favs.indexOf(r.fullName) !== -1,
        isNew: isNew,
        search: (r.fullName + ' ' + (r.description || '') + ' ' + topics.join(' ') + ' ' +
          tags.join(' ') + ' ' + localTags.join(' ') + ' ' + categories.join(' ') + ' ' +
          (r.language || '')).toLowerCase()
      };
    });
  }

  /* ---------------- 过滤 / 排序 / 分组 ---------------- */

  /**
   * criteria: { q, kind, lang, tag, cat, onlyNew, hideArchived, hideForks }
   * 返回新数组，不修改入参。
   */
  function filterItems(items, criteria) {
    criteria = criteria || {};
    var q = String(criteria.q || '').trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];
    var tagKey = criteria.tag || '';
    var cat = criteria.cat || '';
    var kind = criteria.kind || 'all';
    var lang = criteria.lang || '';

    return (items || []).filter(function (it) {
      if (kind === 'own' && it.kind !== 'own') return false;
      if (kind === 'starred' && it.kind !== 'starred') return false;
      if (kind === 'fav' && !it.fav) return false;
      if (lang && it.language !== lang) return false;
      if (cat) {
        if (cat === UNCATEGORIZED) { if (it.categories.length) return false; }
        else if (it.categories.indexOf(cat) === -1) return false;
      }
      if (criteria.hideArchived && it.archived) return false;
      if (criteria.hideForks && it.fork) return false;
      if (criteria.onlyNew && !it.isNew) return false;
      if (tagKey) {
        var pos = tagKey.indexOf(':');
        var type = pos === -1 ? '' : tagKey.slice(0, pos);
        var name = tagKey.slice(pos + 1);
        if (type === 'local') {
          if (it.localTags.indexOf(name) === -1) return false;
        } else if (it.topics.indexOf(name) === -1 && it.customTags.indexOf(name) === -1) {
          return false;
        }
      }
      for (var i = 0; i < terms.length; i++) {
        if (it.search.indexOf(terms[i]) === -1) return false;
      }
      return true;
    });
  }

  var sorters = {
    stars: function (a, b) { return b.stars - a.stars; },
    updated: function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); },
    pushed: function (a, b) { return new Date(b.pushedAt) - new Date(a.pushedAt); },
    created: function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); },
    name: function (a, b) { return a.fullName.localeCompare(b.fullName); }
  };

  /** sort: stars | updated | pushed | created | name */
  function sortItems(items, sort) {
    var list = (items || []).slice();
    list.sort(sorters[sort] || sorters.stars);
    return list;
  }

  /** 按 keyOf 聚合成区块，累计到 shown 条为止；返回 [{ key, items }] */
  function groupItems(items, shown, keyOf) {
    var order = [], buckets = {};
    if (!(shown > 0) || !items.length) return [];
    for (var i = 0; i < items.length; i++) {
      var k = keyOf(items[i]) || '未分类';
      if (!Object.prototype.hasOwnProperty.call(buckets, k)) { buckets[k] = []; order.push(k); }
      buckets[k].push(items[i]);
      if (i + 1 >= shown) break;
    }
    return order.map(function (k) { return { key: k, items: buckets[k] }; });
  }

  /* ---------------- 统计 ---------------- */

  /** 语言计数，按数量降序、名称升序 */
  function langCounts(items) {
    var counts = {};
    (items || []).forEach(function (it) { counts[it.language] = (counts[it.language] || 0) + 1; });
    return Object.keys(counts).map(function (l) {
      return { name: l, count: counts[l] };
    }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  /** 功能分类计数，按数量降序、名称升序；「未分类」永远排最后 */
  function catCounts(items) {
    var counts = {};
    (items || []).forEach(function (it) {
      var seen = {};
      if (!it.categories.length) counts[UNCATEGORIZED] = (counts[UNCATEGORIZED] || 0) + 1;
      it.categories.forEach(function (c) {
        if (seen[c]) return;
        seen[c] = 1;
        counts[c] = (counts[c] || 0) + 1;
      });
    });
    return Object.keys(counts).map(function (name) {
      return { name: name, count: counts[name] };
    }).sort(function (a, b) {
      if (a.name === UNCATEGORIZED) return 1;
      if (b.name === UNCATEGORIZED) return -1;
      return b.count - a.count || a.name.localeCompare(b.name);
    });
  }

  /** 所有可选标签（话题 + 规则标签 + 本地标签），带计数；local 排在最前 */
  function collectTags(items) {
    var counts = {};
    (items || []).forEach(function (it) {
      var seen = {};
      it.topics.concat(it.customTags).forEach(function (t) {
        var k = 'topic:' + t;
        if (seen[k]) return;
        seen[k] = 1;
        counts[k] = (counts[k] || 0) + 1;
      });
      it.localTags.forEach(function (t) {
        counts['local:' + t] = (counts['local:' + t] || 0) + 1;
      });
    });
    return Object.keys(counts)
      .map(function (k) {
        var parts = k.split(':');
        return { key: k, type: parts[0], name: parts.slice(1).join(':'), count: counts[k] };
      })
      .sort(function (a, b) {
        if (a.type !== b.type) return a.type === 'local' ? -1 : 1;
        return b.count - a.count || a.name.localeCompare(b.name);
      });
  }

  return {
    fmtNum: fmtNum,
    relTime: relTime,
    matchesRule: matchesRule,
    ruleScore: ruleScore,
    classify: classify,
    UNCATEGORIZED: UNCATEGORIZED,
    buildItems: buildItems,
    filterItems: filterItems,
    sortItems: sortItems,
    groupItems: groupItems,
    langCounts: langCounts,
    catCounts: catCounts,
    collectTags: collectTags
  };
});
