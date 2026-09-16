/**
 * 站点配置 —— 部署前按需修改这里即可。
 * 数据文件路径相对于 index.html，因此同时支持「用户名.github.io」和用户级项目站点（/仓库名/）。
 */
window.SITE_CONFIG = {
  // 站点标题与副标题（留空则自动从抓取数据里取 GitHub 用户名）
  title: '',
  subtitle: '仓库与 Star 收藏馆',

  // 数据源（由 scripts/fetch-data.mjs 生成）
  dataUrl: 'data/repos.json',
  // 自定义标签规则：可对所有设备生效，见 README「自定义标签」
  customTagsUrl: 'data/custom-tags.json',
  // 功能分类规则：命中即给仓库打上「用途」维度的分类，见 README「功能分类」
  categoriesUrl: 'data/categories.json',

  // 每页渲染数量（用于几千条 star 时的渐进渲染，配合「加载更多」）
  pageSize: 60,

  // 最近新增的天数阈值：firstSeen 在此区间内的仓库会被打上 NEW 标记
  newWithinDays: 7,

  // 语言色板，未列出的语言使用默认灰色
  langColors: {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219',
    Go: '#00add8', Rust: '#dea584', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600',
    CSS: '#563d7c', HTML: '#e34c26', Vue: '#41b883', Svelte: '#ff3e00', Swift: '#f05138',
    Kotlin: '#A97BFF', Ruby: '#701516', PHP: '#4F5D95', Shell: '#89e051', Dart: '#00B4AB',
    Lua: '#000080', Scala: '#c22d40', Pine: '#8a2be2', 'Jupyter Notebook': '#DA5B0B',
    Makefile: '#427819', Dockerfile: '#384d54', 'Objective-C': '#438eff', Solidity: '#AA6746',
    Zig: '#ec915c', Elixir: '#6e4a7e', Haskell: '#5e5086', Astro: '#ff5a03', MDX: '#fcb32c'
  },
  defaultLangColor: '#8b949e'
};
