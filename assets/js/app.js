/**
 * 页面主逻辑：数据加载 → 过滤/排序/分组 → 渐进渲染。
 * 无任何构建依赖，直接用浏览器打开（需通过 HTTP 提供，file:// 下 fetch 会被 CORS 拦截）。
 */
(function () {
  'use strict';

  var CFG = window.SITE_CONFIG;
  var Core = window.GHHubCore;
  var PAGE_SIZE = CFG.pageSize;

  var state = {
    data: null,
    items: [],
    langs: [],
    tagCounts: [],
    q: '',
    kind: 'all',
    lang: '',
    tag: '',
    sort: 'stars',
    view: 'grid',
    onlyNew: false,
    hideArchived: true,
    hideForks: false,
    page: 1,
    visible: []
  };

  var el = {};
  [
    'searchInput', 'clearSearch', 'themeToggle', 'themeIcon', 'tagsBtn', 'githubLink', 'drawerToggle',
    'drawerClose', 'scrim', 'sidebar', 'stats', 'kindFilter', 'langFilter', 'tagFilter', 'onlyNew',
    'hideArchived', 'hideForks', 'resetFilters', 'sortSelect', 'viewSelect', 'resultCount',
    'activeFilters', 'results', 'loadMore', 'updatedAt', 'tagsModal', 'modalClose', 'localTagList',
    'exportBtn', 'copyBtn', 'importFile', 'clearLocalBtn', 'jsonBox', 'toast', 'siteTitle', 'siteSubtitle'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  var fmtNum = Core.fmtNum;
  var relTime = Core.relTime;

  var toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function langColor(lang) {
    return CFG.langColors[lang] || CFG.defaultLangColor;
  }

  /* ---------------- 数据加载 ---------------- */

  function loadJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
  }

  function init() {
    applyTheme(window.Store.theme);
    restoreStateFromHash();
    bindEvents();

    Promise.all([
      loadJSON(CFG.dataUrl),
      loadJSON(CFG.customTagsUrl).catch(function () { return { tags: [], map: {} }; })
    ]).then(function (res) {
      state.data = res[0];
      var rules = res[1] || { tags: [], map: {} };
      state.rules = rules;
      buildItems(state.data, rules);
      renderChrome(state.data);
      renderFilters();
      render();
    }).catch(function (err) {
      el.results.className = 'results';
      el.results.innerHTML =
        '<div class="empty"><h2>还没有数据</h2>' +
        '<p>请先在仓库 Settings → Actions 里手动运行一次 <code>Update GitHub data</code> 工作流，' +
        '或在本地执行 <code>node scripts/fetch-data.mjs</code> 生成 <code>data/repos.json</code>。</p>' +
        '<p style="opacity:.6;font-size:12px">' + esc(err.message) + '</p></div>';
      el.resultCount.textContent = '暂无数据';
    });
  }

  /** 把原始数据增强成便于渲染/检索的 item */
  function buildItems(data, rules) {
    state.items = Core.buildItems(data && data.items, rules, {
      favs: window.Store.favs,
      tags: window.Store.tags,
      newWithinDays: CFG.newWithinDays
    });
  }

  /* ---------------- 头部与筛选器 ---------------- */

  function renderChrome(data) {
    var title = CFG.title || (data.user && data.user.login ? data.user.login + ' 的 GitHub Hub' : 'My GitHub Hub');
    document.title = title + ' · 仓库与 Star 管理';
    el.siteTitle.textContent = title;
    el.siteSubtitle.textContent = CFG.subtitle;
    el.githubLink.href = data.user && data.user.url ? data.user.url : 'https://github.com';

    var all = data.stats || {};
    var stats = [
      ['我的仓库', all.repos], ['Starred', all.starred], ['合计', all.total],
      ['语言', Object.keys(all.languages || {}).length],
      ['本期新增', all.newCount], ['更新于', relTime(data.generatedAt)]
    ];
    el.stats.innerHTML = stats.map(function (s) {
      if (s[1] === undefined || s[1] === null) return '';
      var value = typeof s[1] === 'number' ? fmtNum(s[1]) : s[1];
      return '<span class="stat">' + esc(s[0]) + ' <b>' + esc(value) + '</b></span>';
    }).join('');
    el.updatedAt.textContent = '数据更新于 ' + (data.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN') : '未知');
  }

  function renderFilters() {
    // 语言
    state.langs = Core.langCounts(state.items);

    el.langFilter.innerHTML = chipHtml('', '全部语言', state.items.length, state.lang === '') +
      state.langs.map(function (l) {
        return chipHtml(l.name, l.name, l.count, state.lang === l.name, langColor(l.name));
      }).join('');

    // 标签
    state.tagCounts = Core.collectTags(state.items);
    var limit = 60;
    el.tagFilter.innerHTML = chipHtml('', '全部标签', state.items.length, state.tag === '') +
      state.tagCounts.slice(0, limit).map(function (t) {
        return chipHtml(t.key, t.name, t.count, state.tag === t.key);
      }).join('') +
      (state.tagCounts.length > limit
        ? '<button class="chip" data-more-tags="1">+ ' + (state.tagCounts.length - limit) + ' 个标签…</button>'
        : '');

    Array.prototype.forEach.call(el.kindFilter.children, function (b) {
      b.classList.toggle('is-active', b.dataset.value === state.kind);
    });
    el.sortSelect.value = state.sort;
    el.viewSelect.value = state.view;
    el.onlyNew.checked = state.onlyNew;
    el.hideArchived.checked = state.hideArchived;
    el.hideForks.checked = state.hideForks;
  }

  function chipHtml(value, label, count, active, color) {
    return '<button class="chip' + (active ? ' is-active' : '') + '" data-value="' + esc(value) + '"' +
      (color ? ' data-color="' + esc(color) + '"' : '') + '>' +
      (color ? '<i class="lang-dot" style="background:' + esc(color) + '"></i>' : '') +
      esc(label) + '<span class="cnt">' + count + '</span></button>';
  }

  /* ---------------- 过滤 / 排序 ---------------- */

  function applyFilters() {
    var list = Core.filterItems(state.items, {
      q: state.q,
      kind: state.kind,
      lang: state.lang,
      tag: state.tag,
      onlyNew: state.onlyNew,
      hideArchived: state.hideArchived,
      hideForks: state.hideForks
    });
    state.visible = Core.sortItems(list, state.sort);
  }

  function render() {
    applyFilters();
    renderFilters();
    renderActiveFilters();
    renderResults();
    syncHash();
  }

  function renderActiveFilters() {
    var pills = [];
    if (state.q) pills.push(['搜索：' + state.q, 'q']);
    if (state.kind !== 'all') pills.push(['类型：' + kindLabel(state.kind), 'kind']);
    if (state.lang) pills.push(['语言：' + state.lang, 'lang']);
    if (state.tag) pills.push(['标签：' + state.tag.split(':').slice(1).join(':'), 'tag']);
    if (state.onlyNew) pills.push(['只看新增', 'onlyNew']);
    if (!state.hideArchived) pills.push(['含归档', 'hideArchived']);
    if (state.hideForks) pills.push(['隐藏 Fork', 'hideForks']);

    el.activeFilters.hidden = pills.length === 0;
    el.activeFilters.innerHTML = pills.map(function (p) {
      return '<span class="pill">' + esc(p[0]) +
        '<button data-clear="' + p[1] + '" aria-label="移除筛选">×</button></span>';
    }).join('') + (pills.length > 1 ? '<button class="chip" data-clear="all">清空全部</button>' : '');
  }

  function kindLabel(k) {
    return { all: '全部', own: '我的仓库', starred: 'Starred', fav: '本地收藏' }[k] || k;
  }

  /* ---------------- 卡片渲染 ---------------- */

  function cardHtml(it) {
    var badges = '';
    if (it.isNew) badges += '<span class="badge new" title="最近加入">NEW</span>';
    if (it.kind === 'own') badges += '<span class="badge" title="我自己的仓库">OWN</span>';
    if (it.fork) badges += '<span class="badge" title="Fork 仓库">FORK</span>';
    if (it.archived) badges += '<span class="badge" title="已归档">ARCHIVED</span>';
    it.localTags.forEach(function (t) { badges += '<span class="badge local">#' + esc(t) + '</span>'; });
    it.customTags.forEach(function (t) { badges += '<span class="badge">' + esc(t) + '</span>'; });

    var topics = it.topics.slice(0, 5).map(function (t) {
      return '<button class="topic" data-topic="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');

    var starDelta = it.starsDelta > 0
      ? '<span class="meta" title="较上次抓取新增 star">+' + it.starsDelta + '</span>' : '';

    return '' +
      '<article class="card" data-full="' + esc(it.fullName) + '">' +
        '<div class="card-head">' +
          '<img src="https://github.com/' + esc(it.owner) + '.png?size=64" alt="" loading="lazy" />' +
          '<div class="card-title">' +
            '<a class="repo-name" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
              '<span class="repo-owner">' + esc(it.owner) + ' / </span>' +
              '<span class="repo-title-text">' + esc(it.name) + '</span>' +
            '</a> ' + badges +
          '</div>' +
        '</div>' +
        '<p class="card-desc">' + esc(it.desc || '（暂无描述）') + '</p>' +
        (topics ? '<div class="card-topics">' + topics + '</div>' : '') +
        '<div class="card-foot">' +
          '<span class="meta"><i class="lang-dot" style="background:' + esc(langColor(it.language)) + '"></i>' + esc(it.language) + '</span>' +
          '<span class="meta" title="Stars">★ ' + fmtNum(it.stars) + '</span>' + starDelta +
          '<span class="meta" title="Forks">⑂ ' + fmtNum(it.forks) + '</span>' +
          '<span class="meta" title="最近更新">⟳ ' + esc(relTime(it.updatedAt)) + '</span>' +
          '<div class="card-actions">' +
            '<button class="mini-btn' + (it.fav ? ' is-on' : '') + '" data-act="fav" aria-label="收藏">' + (it.fav ? '★ 已收藏' : '☆ 收藏') + '</button>' +
            '<button class="mini-btn" data-act="tag"># 标签</button>' +
            (it.homepage ? '<a class="mini-btn" href="' + esc(it.homepage) + '" target="_blank" rel="noopener">站点 ↗</a>' : '') +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderResults() {
    var total = state.visible.length;
    el.resultCount.textContent = total
      ? '共 ' + total + ' 个仓库' + (state.page * PAGE_SIZE < total ? '（显示前 ' + Math.min(total, state.page * PAGE_SIZE) + ' 个）' : '')
      : '没有匹配的仓库';

    var view = state.view;
    el.results.className = 'results' + (view === 'list' ? ' is-list' : '');

    if (!total) {
      el.results.innerHTML = '<div class="empty"><h2>没有匹配结果</h2><p>试试换个关键词，或点击下方的重置筛选。</p>' +
        '<p><button class="btn" data-clear="all">重置全部筛选</button></p></div>';
      el.loadMore.hidden = true;
      return;
    }

    var shown = Math.min(total, state.page * PAGE_SIZE);

    if (view === 'group-lang') {
      el.results.innerHTML = groupHtml(state.visible, shown, function (it) { return it.language; });
    } else if (view === 'group-tag') {
      el.results.innerHTML = groupHtml(state.visible, shown, function (it) {
        if (it.customTags.length) return it.customTags[0];
        if (it.topics.length) return it.topics[0];
        if (it.localTags.length) return '#' + it.localTags[0];
        return '未分类';
      });
    } else {
      el.results.innerHTML = state.visible.slice(0, shown).map(cardHtml).join('');
    }

    el.loadMore.hidden = shown >= total;
    el.loadMore.textContent = '加载更多（还剩 ' + fmtNum(total - shown) + ' 个）';
  }

  /** 视图=分组：从已排序结果里按 key 聚合成区块，累计到 shown 条为止 */
  function groupHtml(list, shown, keyOf) {
    return Core.groupItems(list, shown, keyOf).map(function (g) {
      return '<section class="group">' +
        '<h2 class="group-title">' +
          (CFG.langColors[g.key] ? '<i class="lang-dot" style="background:' + esc(langColor(g.key)) + '"></i>' : '') +
          '<b>' + esc(g.key) + '</b><span>' + g.items.length + '</span>' +
        '</h2>' +
        '<div class="results' + (state.view === 'list' ? ' is-list' : '') + '">' +
          g.items.map(cardHtml).join('') +
        '</div>' +
      '</section>';
    }).join('');
  }

  /* ---------------- URL 状态同步 ---------------- */

  var hashLock = false;

  function syncHash() {
    var p = [];
    if (state.q) p.push('q=' + encodeURIComponent(state.q));
    if (state.kind !== 'all') p.push('kind=' + state.kind);
    if (state.lang) p.push('lang=' + encodeURIComponent(state.lang));
    if (state.tag) p.push('tag=' + encodeURIComponent(state.tag));
    if (state.sort !== 'stars') p.push('sort=' + state.sort);
    if (state.view !== 'grid') p.push('view=' + state.view);
    if (state.onlyNew) p.push('new=1');
    if (!state.hideArchived) p.push('archived=1');
    if (state.hideForks) p.push('nofork=1');
    hashLock = true;
    history.replaceState(null, '', p.length ? '#' + p.join('&') : location.pathname);
    setTimeout(function () { hashLock = false; }, 0);
  }

  function restoreStateFromHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var p = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
      else p[kv] = '1';
    });
    if (p.q) { state.q = p.q; el.searchInput.value = p.q; toggleClear(); }
    if (p.kind) state.kind = p.kind;
    if (p.lang) state.lang = p.lang;
    if (p.tag) state.tag = p.tag;
    if (p.sort) state.sort = p.sort;
    if (p.view) state.view = p.view;
    state.onlyNew = !!p.new;
    state.hideArchived = !p.archived;
    state.hideForks = !!p.nofork;
  }

  /* ---------------- 交互 ---------------- */

  function toggleClear() {
    el.clearSearch.hidden = !el.searchInput.value;
  }

  function bindEvents() {
    el.searchInput.addEventListener('input', debounce(function () {
      state.q = el.searchInput.value;
      state.page = 1;
      toggleClear();
      render();
    }, 220));

    el.clearSearch.addEventListener('click', function () {
      el.searchInput.value = '';
      state.q = '';
      state.page = 1;
      toggleClear();
      render();
      el.searchInput.focus();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== el.searchInput &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        el.searchInput.focus();
      }
      if (e.key === 'Escape') {
        closeModal();
        if (el.sidebar.classList.contains('is-open')) toggleDrawer(false);
      }
    });

    var expandTags = function (e, b) {
      return b.dataset.moreTags ? 'expand' : false;
    };
    el.kindFilter.addEventListener('click', onChipGroup(el.kindFilter, function (v) { state.kind = v; }));
    el.langFilter.addEventListener('click', onChipGroup(el.langFilter, function (v) { state.lang = v; }));
    el.tagFilter.addEventListener('click', onChipGroup(el.tagFilter, function (v) { state.tag = v; }, expandTags));

    el.onlyNew.addEventListener('change', function () { state.onlyNew = this.checked; state.page = 1; render(); });
    el.hideArchived.addEventListener('change', function () { state.hideArchived = this.checked; state.page = 1; render(); });
    el.hideForks.addEventListener('change', function () { state.hideForks = this.checked; state.page = 1; render(); });

    el.sortSelect.addEventListener('change', function () { state.sort = this.value; render(); });
    el.viewSelect.addEventListener('change', function () { state.view = this.value; state.page = 1; render(); });

    el.resetFilters.addEventListener('click', function () { clearFilter('all'); });
    el.activeFilters.addEventListener('click', function (e) {
      var b = e.target.closest('[data-clear]');
      if (b) clearFilter(b.dataset.clear);
    });

    el.results.addEventListener('click', onResultClick);

    el.loadMore.addEventListener('click', function () { state.page++; render(); });

    el.themeToggle.addEventListener('click', function () {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      window.Store.setTheme(document.documentElement.dataset.theme);
    });

    el.tagsBtn.addEventListener('click', openModal);
    el.modalClose.addEventListener('click', closeModal);
    el.tagsModal.addEventListener('click', function (e) { if (e.target === el.tagsModal) closeModal(); });

    el.drawerToggle.addEventListener('click', function () { toggleDrawer(!el.sidebar.classList.contains('is-open')); });
    el.drawerClose.addEventListener('click', function () { toggleDrawer(false); });
    el.scrim.addEventListener('click', function () { toggleDrawer(false); });

    window.addEventListener('hashchange', function () {
      if (hashLock) return;
      restoreStateFromHash();
      if (state.data) render();
    });

    el.exportBtn.addEventListener('click', function () {
      el.jsonBox.value = JSON.stringify(window.Store.exportAll(), null, 2);
      el.jsonBox.select();
      toast('已生成 JSON，可复制或保存');
    });
    el.copyBtn.addEventListener('click', function () {
      if (!el.jsonBox.value) el.jsonBox.value = JSON.stringify(window.Store.exportAll(), null, 2);
      var text = el.jsonBox.value;
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); });
      else { el.jsonBox.select(); document.execCommand('copy'); toast('已复制到剪贴板'); }
    });
    el.importFile.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          window.Store.importAll(JSON.parse(String(reader.result)));
          var textareaVal = el.jsonBox.value;
          refreshAfterLocalChange();
          el.jsonBox.value = textareaVal;
          toast('导入成功');
        } catch (err) {
          toast('导入失败：' + err.message);
        }
      };
      reader.readAsText(f);
      this.value = '';
    });
    el.clearLocalBtn.addEventListener('click', function () {
      if (!confirm('确定清空本机的收藏与标签吗？此操作不可撤销。')) return;
      window.Store.clearAll();
      refreshAfterLocalChange();
      toast('已清空本地数据');
    });
  }

  function renderTagFilterAll() {
    var all = state.tagCounts;
    el.tagFilter.innerHTML = chipHtml('', '全部标签', state.items.length, state.tag === '') +
      chipHtml('__collapse__', '收起', all.length, false) +
      all.map(function (t) { return chipHtml(t.key, t.name, t.count, state.tag === t.key); }).join('');
    el.tagFilter.dataset.expanded = '1';
  }

  function onChipGroup(container, setter, hook) {
    return function (e) {
      var b = e.target.closest('.chip, .seg-item');
      if (!b || !container.contains(b)) return;
      var v = b.dataset.value || '';
      if (hook) {
        var r = hook(e, b);
        if (r === 'expand') { renderTagFilterAll(); return; }
      }
      if (v === '__collapse__') {
        delete el.tagFilter.dataset.expanded;
        state.page = 1;
        render();
        return;
      }
      setter(v);
      state.page = 1;
      render();
      if (window.innerWidth <= 860) toggleDrawer(false);
    };
  }

  function onResultClick(e) {
    var topicBtn = e.target.closest('[data-topic]');
    if (topicBtn) {
      state.tag = 'topic:' + topicBtn.dataset.topic;
      state.page = 1;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.card');
    var fullName = card.dataset.full;
    var item = state.items.filter(function (i) { return i.fullName === fullName; })[0];
    if (!item) return;

    if (btn.dataset.act === 'fav') {
      var added = window.Store.toggleFav(fullName);
      item.fav = added;
      btn.classList.toggle('is-on', added);
      btn.textContent = added ? '★ 已收藏' : '☆ 收藏';
      toast(added ? '已加入本地收藏' : '已取消收藏');
      if (state.kind === 'fav') render();
      return;
    }

    if (btn.dataset.act === 'tag') {
      var input = prompt('为 ' + fullName + ' 添加本地标签（英文逗号分隔，留空则清除）：',
        item.localTags.join(', '));
      if (input === null) return;
      item.localTags = window.Store.setTags(fullName, input);
      render();
      toast('标签已保存（仅本机）');
    }
  }

  function clearFilter(which) {
    switch (which) {
      case 'q': state.q = ''; el.searchInput.value = ''; toggleClear(); break;
      case 'kind': state.kind = 'all'; break;
      case 'lang': state.lang = ''; break;
      case 'tag': state.tag = ''; break;
      case 'onlyNew': state.onlyNew = false; break;
      case 'hideArchived': state.hideArchived = true; break;
      case 'hideForks': state.hideForks = false; break;
      case 'all':
        state.q = ''; el.searchInput.value = ''; toggleClear();
        state.kind = 'all'; state.lang = ''; state.tag = '';
        state.onlyNew = false; state.hideArchived = true; state.hideForks = false;
        delete el.tagFilter.dataset.expanded;
        break;
    }
    state.page = 1;
    render();
  }

  function refreshAfterLocalChange() {
    if (!state.data) return;
    buildItems(state.data, state.rules || { tags: [], map: {} });
    render();
  }

  function toggleDrawer(open) {
    el.sidebar.classList.toggle('is-open', open);
    el.scrim.hidden = !open;
    el.drawerToggle.setAttribute('aria-expanded', String(open));
  }

  function openModal() {
    var counts = window.Store.allLocalTags();
    var keys = Object.keys(counts);
    el.localTagList.innerHTML = keys.length
      ? keys.map(function (t) { return '<span class="chip">#' + esc(t) + '<span class="cnt">' + counts[t] + '</span></span>'; }).join('')
      : '<span class="hint">还没有本地标签。在任意仓库卡片上点「# 标签」即可添加。</span>';
    el.jsonBox.value = JSON.stringify(window.Store.exportAll(), null, 2);
    el.tagsModal.hidden = false;
  }

  function closeModal() {
    el.tagsModal.hidden = true;
  }

  function applyTheme(theme) {
    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.dataset.theme = theme;
    el.themeIcon.textContent = theme === 'dark' ? '☀' : '☾';
  }

  /* ---------------- go ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
