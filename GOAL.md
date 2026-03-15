# OG Image via Cloudflare Browser Rendering

## 目标

为 map.mgt.moe 添加 Open Graph image 功能，使链接在社交平台/聊天软件中分享时显示地图截图预览。

## 背景

- 项目：orm-pmtiles-demo，Vanilla JS + MapLibre GL 地图应用
- 部署：Cloudflare Pages，域名 map.mgt.moe
- 当前 URL 使用 hash routing（`#zoom/lat/lng`），需改为 path-based

## 核心功能

### 1. URL 路由改造（hash → path）

- 移除 MapLibre 的 `hash: true`
- 页面加载时从 `window.location.pathname` 解析 `zoom/lat/lng`
- 地图移动时用 `history.replaceState()` 更新 URL
- 格式：`/13.5/32.739/129.865`，根路径 `/` 使用默认位置

### 2. 前端加载完成信号

- 监听 `map.on('idle', ...)` 事件
- 设置 `window.__MAP_READY = true`
- 供 Cloudflare Browser Rendering 检测地图渲染完成

### 3. Worker 请求路由

- `/:zoom/:lat/:lng` + bot User-Agent → 返回带 OG meta tags 的 HTML
- `/og-image/:zoom/:lat/:lng.png` → 返回截图图片（从缓存或现场生成）
- 其他请求 → 返回 SPA（index.html）

Bot 检测通过 User-Agent 匹配：Twitterbot, facebookexternalhit, LinkedInBot, Slackbot, TelegramBot, Discordbot, WhatsApp, Googlebot, bingbot

### 4. 截图生成（Cloudflare Browser Rendering）

- 使用 `@cloudflare/puppeteer` 访问地图页面
- 通过 `page.waitForFunction(() => window.__MAP_READY === true)` 等待渲染完成
- 截取页面截图并返回 PNG

### 5. 截图缓存（Cloudflare D1）

**表结构：**
```sql
CREATE TABLE og_images (
  path_key TEXT PRIMARY KEY,  -- 取整后的 "zoom/lat/lng"
  image BLOB NOT NULL,
  version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

**Cache key 取整规则：**
- zoom：`Math.floor(zoom) + 0.5`（只取 .5，如 13.66→13.5, 14.8→14.5）
- lat/lng：按 zoom level 动态精度：
  - zoom 1-5 → 0 位小数
  - zoom 6-9 → 1 位小数
  - zoom 10-12 → 2 位小数
  - zoom 13-16 → 3 位小数
  - zoom 17+ → 4 位小数

**缓存失效：**
- Worker 环境变量 `OG_CACHE_VERSION`（如 `"v1"`）
- 查询时匹配 path_key + version
- 更新地图样式时改版本号即可失效全部缓存
- 额外 30 天 TTL 兜底

### 6. Wrangler 配置

wrangler.jsonc 需增加：
- D1 数据库 binding
- Browser Rendering binding
- 域名 binding（map.mgt.moe）

## 约束

- 使用 Cloudflare 生态：Workers、D1、Browser Rendering
- 不引入额外框架，保持 Vanilla JS
- 截图失败时优雅降级（返回不带 og:image 的 HTML 或默认图片）
- 需要合并 `cloudflare/workers-autoconfig` 分支的 wrangler 配置

## 验收标准

1. 访问 `/13.5/32.739/129.865` 在普通浏览器中正常显示地图
2. 地图移动后 URL path 自动更新（无 hash）
3. `curl -H "User-Agent: Slackbot" https://map.mgt.moe/13.5/32.739/129.865` 返回包含 `og:image` 的 HTML
4. `curl https://map.mgt.moe/og-image/13.5/32.739/129.865.png` 返回有效 PNG 图片
5. 第二次请求同一路径时从 D1 缓存返回（无需重新截图）
6. 在 Slack 中粘贴链接能显示地图截图预览
7. `window.__MAP_READY` 在地图 idle 后为 `true`
