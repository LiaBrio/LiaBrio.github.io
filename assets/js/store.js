/* 本地数据层：收藏、自定义标签、主题偏好。全部存在 localStorage，不会上传。 */
(function (global) {
  'use strict';

  var NS = 'gh-hub:';

  function safeGet(key, fallback) {
    try {
      var raw = localStorage.getItem(NS + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  var store = {
    get favs() {
      return safeGet('favs', []);
    },
    get tags() {
      return safeGet('tags', {});
    },
    get theme() {
      return safeGet('theme', null);
    },

    isFav: function (fullName) {
      return this.favs.indexOf(fullName) !== -1;
    },

    toggleFav: function (fullName) {
      var list = this.favs;
      var i = list.indexOf(fullName);
      if (i === -1) list.push(fullName);
      else list.splice(i, 1);
      safeSet('favs', list);
      return i === -1;
    },

    tagsOf: function (fullName) {
      return this.tags[fullName] || [];
    },

    setTags: function (fullName, raw) {
      var tags = String(raw)
        .split(/[,，\s]+/)
        .map(function (t) { return t.trim().replace(/^#/, ''); })
        .filter(Boolean)
        .slice(0, 12);
      var all = this.tags;
      if (tags.length) all[fullName] = tags;
      else delete all[fullName];
      safeSet('tags', all);
      return tags;
    },

    allLocalTags: function () {
      var counts = {};
      Object.keys(this.tags).forEach(function (name) {
        (store.tags[name] || []).forEach(function (t) {
          counts[t] = (counts[t] || 0) + 1;
        });
      });
      return counts;
    },

    exportAll: function () {
      return { version: 1, favs: this.favs, tags: this.tags };
    },

    importAll: function (obj) {
      if (!obj || typeof obj !== 'object') throw new Error('JSON 格式不正确');
      if (Array.isArray(obj.favs)) safeSet('favs', obj.favs.filter(function (x) { return typeof x === 'string'; }));
      if (obj.tags && typeof obj.tags === 'object') {
        var clean = {};
        Object.keys(obj.tags).forEach(function (k) {
          if (Array.isArray(obj.tags[k])) clean[k] = obj.tags[k].filter(function (x) { return typeof x === 'string'; });
        });
        safeSet('tags', clean);
      }
      return true;
    },

    clearAll: function () {
      try {
        Object.keys(localStorage)
          .filter(function (k) { return k.indexOf(NS) === 0 && k !== NS + 'theme'; })
          .forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* noop */ }
    },

    setTheme: function (theme) {
      safeSet('theme', theme);
    }
  };

  global.Store = store;
})(window);
