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

  /** 规则命中：conditions 内任意字段匹配即生效 */
  function matchesRule(repo, match) {
    var fields = ['fullNames', 'owners', 'topics', 'languages', 'keywords'];
    for (var i = 0; i < fields.length; i++) {
      var vals = match[fields[i]];
      if (!Array.isArray(vals) || !vals.length) continue;
      for (var j = 0; j < vals.length; j++) {
        var v = String(vals[j]).toLowerCase();
        if (!v) continue;
        switch (fields[i]) {
          case 'fullNames': if (String(repo.fullName).toLowerCase() === v) return true; break;
          case 'owners': if (String(repo.owner || '').toLowerCase() === v) return true; break;
          case 'topics': if ((repo.topics || []).some(function (t) { return String(t).toLowerCase() === v; })) return true; break;
          case 'languages': if (String(repo.language || '').toLowerCase() === v) return true; break;
          case 'keywords':
            var hay = (repo.fullName + ' ' + (repo.description || '')).toLowerCase();
            if (hay.indexOf(v) !== -1) return true;
            break;
        }
      }
    }
    return false;
  }

  /**
   * 把原始条目增强成便于渲染/检索的 item。
   * opts: { favs, tags, newWithinDays, now }
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

    return (rawItems || []).map(function (r) {
      var tags = [];
      ruleList.forEach(function (rule) {
        if (rule && rule.name && matchesRule(r, rule.match || rule)) tags.push(rule.name);
      });
      (ruleMap[r.fullName] || []).forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });

      var localTags = tagsMap[r.fullName] || [];
      var topics = r.topics || [];
      var isNew = r.firstSeen ? new Date(r.firstSeen).getTime() >= cutoff : false;

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
          tags.join(' ') + ' ' + localTags.join(' ') + ' ' + (r.language || '')).toLowerCase()
      };
    });
  }

  /* ---------------- 过滤 / 排序 / 分组 ---------------- */

  /**
   * criteria: { q, kind, lang, tag, onlyNew, hideArchived, hideForks }
   * 返回新数组，不修改入参。
   */
  function filterItems(items, criteria) {
    criteria = criteria || {};
    var q = String(criteria.q || '').trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];
    var tagKey = criteria.tag || '';
    var kind = criteria.kind || 'all';
    var lang = criteria.lang || '';

    return (items || []).filter(function (it) {
      if (kind === 'own' && it.kind !== 'own') return false;
      if (kind === 'starred' && it.kind !== 'starred') return false;
      if (kind === 'fav' && !it.fav) return false;
      if (lang && it.language !== lang) return false;
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
    buildItems: buildItems,
    filterItems: filterItems,
    sortItems: sortItems,
    groupItems: groupItems,
    langCounts: langCounts,
    collectTags: collectTags
  };
});
