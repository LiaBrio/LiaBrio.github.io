# My GitHub Hub

一个部署在 GitHub Pages 上的个人仓库 / Star 收藏馆。

- 自动汇总**自己的仓库**和**已 Star 的仓库**，解决「star 之后再也找不到」的问题
- 支持**语言 / 类型 / 话题 / 自定义标签**多维筛选，全文搜索、排序、分组浏览
- GitHub Actions **每天定时**抓取新增的仓库与 star，自动更新数据并重新部署页面
- 响应式布局：桌面端左侧常驻筛选栏，移动端抽屉式筛选 + 单列卡片

## 目录结构

```
.
├── index.html                  # 单页应用（无构建步骤）
├── assets/
│   ├── css/style.css
│   └── js/
│       ├── app.js              # 过滤 / 排序 / 分组 / 渲染
│       ├── config.js           # 站点配置（标题、数据源、语言配色）
│       └── store.js            # 本地收藏与标签（localStorage）
├── data/
│   ├── repos.json              # 抓取脚本生成的数据快照（自动生成，勿手改）
│   └── custom-tags.json        # 自定义标签规则（手写，Actions 不会覆盖）
├── scripts/fetch-data.mjs      # 抓取脚本
└── .github/workflows/update-data.yml
```

## 快速开始

1. **用本仓库作为模板**：点击 `Use this template`，或把代码推到你的仓库，仓库名建议 `<用户名>.github.io`。
2. **开启 Pages**：仓库 `Settings → Pages → Build and deployment → Source` 选 **GitHub Actions**。
3. **触发第一次抓取**：`Actions → Update GitHub data → Run workflow`（username 留空即使用仓库 owner）。
4. 完成后访问 `https://<用户名>.github.io/<仓库名>/`（用户级仓库则直接是 `https://<用户名>.github.io/`）。

> 仓库自带的 `data/repos.json` 是示例数据（公开抓取自 `@ruanyf`），第一次工作流运行后会被替换成你自己的数据。

## 定时更新

默认每天 UTC 03:17（北京时间 11:17）跑一次。修改 `.github/workflows/update-data.yml`：

```yaml
schedule:
  - cron: '0 * * * *'   # 每小时
```

工作流会：抓取数据 → 若有变化则提交 `data/repos.json` → 打包全部静态文件 → 部署到 Pages。

**「新增」是怎么算出来的**：脚本会把上一份快照读回来，用 `firstSeen` 记录每个仓库首次出现的时间，新出现的仓库被打上 `NEW` 标记（默认 7 天内，可在 `assets/js/config.js` 的 `newWithinDays` 调整），同时用 `starsDelta` 记录 star 数量的增量。

**速率限制**：不带令牌时 GitHub API 限速 60 次/小时，Star 数量多时会不够用。建议在 `Settings → Secrets and variables → Actions` 里新增 Secret `DATA_TOKEN`（Personal Access Token，只需要 `public_repo` 只读权限即可），工作流会自动优先使用它。不想用变量/settings 也可以在工作流里直接写死用户名变量 `vars.GITHUB_USERNAME`。

## 自定义标签

两种方式，可以同时用：

### 1. 规则标签（多设备生效）

编辑 `data/custom-tags.json`，`match` 内任意字段命中即打标签（字段之间是「或」）：

```json
{
  "tags": [
    {
      "name": "AI / LLM",
      "match": {
        "fullNames": ["openai/whisper"],
        "owners": ["vuejs"],
        "topics": ["llm", "rag"],
        "languages": ["TypeScript"],
        "keywords": ["脚手架"]
      }
    }
  ],
  "map": { "facebook/react": ["必读"] }
}
```

提交后 Actions 下次运行时页面即可看到，这个文件**不会被自动覆盖**。

### 2. 本地标签 / 收藏（只存在当前浏览器）

在任意仓库卡片上点 `# 标签` 输入标签，或点 `☆ 收藏`。数据存在 localStorage，可在右上角 ⚙ 面板里**导出 / 导入 JSON** 做备份或迁移到别的设备。

## 本地预览

```bash
node scripts/fetch-data.mjs --username 你的用户名      # 可选：先拉一份自己的数据
python3 -m http.server 5173                            # 任意静态服务器
# 打开 http://localhost:5173
```

> 必须走 HTTP 访问：直接双击 `index.html`（`file://`）会被浏览器的 CORS 策略拦住 fetch。

## 常用配置

`assets/js/config.js`：

| 字段 | 说明 |
| --- | --- |
| `title` / `subtitle` | 站点标题，留空则自动取 GitHub 用户名 |
| `dataUrl` / `customTagsUrl` | 数据文件路径 |
| `pageSize` | 每屏渲染条数，配合「加载更多」 |
| `newWithinDays` | NEW 标记的时间窗口 |
| `langColors` | 语言色板 |

URL 会自动带上当前筛选状态（如 `#q=cli&lang=Go&sort=stars`），可直接把筛选结果分享出去。

## 本地测试

零依赖，用 Node 内置 `node:test` 跑（需要 Node ≥ 18）：

```bash
npm test              # 全部：纯逻辑 + 前端交互 + 真实 API 校验
npm run test:unit     # 纯逻辑：筛选 / 排序 / 分组 / 收藏 / 本地存储
npm run test:dom      # 前端交互：真实 index.html + 真实数据 + 真实事件
npm run test:live     # 真实调用 api.github.com 做交叉校验（断网/限流会自动跳过）
```

说明：

- 前端交互测试用自研的轻量 DOM 桩加载真实 `index.html` 与真实脚本，断言由数据实时计算得出，不写死数字快照。
- 测试数据来自真实抓取，写到 `.tmp/`（已 gitignore），**不会覆盖 `data/repos.json`**；缓存 30 分钟内复用，无网时自动降级到已有数据。
- `npm run fetch:test` 可单独刷新测试数据；`SKIP_LIVE=1 npm test` 可跳过真实 API 校验。
- 页面的纯计算逻辑集中在 `assets/js/core.js`，浏览器与测试共用同一份实现。

## 隐私提醒

页面是公开的。脚本默认**只抓公开仓库**；`--include-private` 会把私有仓库也写进 JSON，除非部署在私有环境，否则不要开启。
