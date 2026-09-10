---
name: atlas-realm-trip-sop
description: Use when 在 Atlas Realm 房间做行程标注（层/配色/主备/徒步）。
---

# Atlas Realm 行程标注 SOP

## 何时用

- 用户给了 `map.mgt.moe/?room=...` 并要求「照这个房间的格式做 / 整理 / 加行程」。
- 在房间里新增自驾、徒步、渡轮、备选行程、POI、宿泊点、专题兴趣点。
- 统一或修正房间配色 / 图层结构。

CLI 语法、登录、字段细节看 `atlas-realm` skill；本 skill 管「怎么做才一致、好看、可读」。

## 铁律

1. **一层 = 一个行程单元**（一天 / 一岛 / 一专题）；第一层恒为 `📍 POI & 宿泊`。
2. **一条 route = 一段真实道路**：`--geometry` 必须来自 OSRM/高德（服务端不寻路），坐标一律 **WGS-84**，点串是平铺 `[[lng,lat],…]` 数组（传 GeoJSON Geometry 会退化成 waypoints 直连）。
3. **颜色只编码「时段/单元」**，其余语义走 emoji / label / 线型 / 透明度（见「通道分工」）。
4. **配色只用 Tailwind 默认调色板**：相邻单元同族成对、深浅跳 2 档，相邻 ΔE ≥ 15。
5. **label 短**：`emoji + 名称 + 日期`；细节全部进 note（Markdown）。
6. **note 里的 `←/→ 距离 时间` 必须与 route 的 `distanceText/durationText` 对得上**（这是自检手段）。
7. 改动前先 `snapshot --json`（只读用 `--client-type query`），改完 `annotations get` 回读；**顺序只能用 `reorder` 指定**（`sortKey` 由服务端维护）。
8. **长链接只做一条 text 标注**（天气看板、共享表格）；长 note 走 `--note-file`。

## 从行程文档到地图

行程文档（飞书 wiki 等）常是多层结构，**概览表的「途经 / 备注」列最容易过期**——从旧方案抄下来没删。定事实的顺序：

1. **正文 > 概览表**：「每日详细行程」正文 + 住宿安排优先；概览表的途经点列表、`TBD` 备注与正文冲突时按正文走，并向用户确认一次。
2. **住宿定起讫**：用「哪天住哪家酒店」反推当天起点/终点（例：9/30 住道孚 → 当天终点是道孚，不是新都桥）。
3. **近路先问路由**：文档提到「XX 县道 / 乡道」时，直接向路由引擎要 A→B 直连，别默认绕主干道。例：道孚→党岭村走 179 县道 **106km / 3h**，绕「八美 + 丹巴」是 **232km / 5h+**——差一倍。
4. **几何 OSRM、里程高德**：`--geometry` 取 OSRM（WGS-84 原生）；`distanceText` / `durationText` 用高德驾车 API（山路时长更真实，OSRM 常乐观 30–50%）。两者里程差 >5% 说明走错路或绕路，回头查。高德 Web 服务有 QPS 限制，批量请求要间隔 1–2s，连发会拿到 `CUQPS_HAS_EXCEEDED_THE_LIMIT`。
5. **坐标一律转 WGS-84**：高德给的是 GCJ-02，直接落图会整体偏移 300–500m。用标准 GCJ-02→WGS-84 算法转换（误差 ~5m），并可用高德 `assistant/coordinate/convert`（`coordsys=gps`）反查校验转换是否可信。
6. **点位先落、线路后连**：住宿 / 机场 / 垭口先做成 point，再按它们连 route；端点重合才能看出「断线」。
7. **徒步线只画真轨迹**：没有真实 GPX 就不编造，宁可只放点位，并在汇报里讲清缺哪一段（能从两步路等来源下到 GPX 再补）。

## 通道分工（一通道一含义）

| 通道             | 编码           | 取值                                                                      |
| ---------------- | -------------- | ------------------------------------------------------------------------- |
| **颜色**         | 时段 / 单元    | 色带：同族成对 + 色相递进                                                 |
| **线型**         | 通行方式       | `solid` 陆路机动车 · `dashed` 水路/接驳（渡轮·摆渡·缆车） · `dotted` 徒步 |
| **透明度**       | 主备状态       | 主线 `0.9–0.95` · 备选/可选 `0.45–0.55`                                   |
| **线宽**         | 重要度         | `5` 当日主轴 · `4` 默认 · `3.5` 接驳支线                                  |
| **label 后缀**   | 状态词         | 无 · `(备选)` · `(可选)` · `(已取消)`                                     |
| **note**         | 触发条件与细节 | 见下文模板                                                                |
| **图层 visible** | 是否默认显示   | 主层 `true`；整段 Plan B 层 `false`                                       |

客户端会给 `solid` 线自动加 3px 深色 casing（`#111827`），视觉宽度 ≈ 设定值 +3，**不要自己加粗**；`dashed/dotted` 不套 casing。

线宽参数是 `--width`（**不是** `--line-width`），样式参数统一为 `--width / --color / --opacity / --line-style`；`annotations add route` 会**静默忽略**不认识的参数名，写错只会让线停在默认样式而不会报错——所以改完必须看图确认，不能只看 `ok: true`。

## 图层骨架与命名

```
000010  📍 POI & 宿泊            ← 全程 POI、机场、港口、住宿、取还车、天气看板
000020  🚗 Day 1 8/5 札幌→小平
000030  🚗 Day 2 8/6 小平→稚内
...
0003x0  🚌 / 🥾 离岛专题          ← 单岛线路（观光巴士 + 徒步）
0003x0  🍫 专题层（与日期正交）
0003x0  🔁 备选 · <方案名>        ← 整段替换的多日 Plan B，visible=false
```

| 对象            | 规范                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 图层名          | `emoji + Day N + 日期 + 起→终`：`🚗 Day 2 8/6 小平→稚内`                                                                     |
| 图层顺序        | `sortKey` 由**服务端**按位置维护（`000000010` 起、步长 10，新建即重编号）；要顺序就用 `annotations layers reorder` 传全部 id |
| 图层 id         | 服务端分配 `layer-<uuid>`，**不可指定**；语义写在图层名里                                                                    |
| 标注 id         | 服务端分配 `feature-<uuid>`（point/text/path/polygon/route 一样），**不可指定**；语义写在 label / note 里                    |
| 老房间的既有 id | 保留可寻址（`day3-routes`、`poi-hotel` 等），`get/update/delete/reorder` 继续用                                              |
| label           | `emoji + 名称(+日期/时间)`：`🏔️ 神威岬 8/5`                                                                                  |

> **id 与顺序都归服务端管**（房间同步 v2 §9–§10）：`create` 一定 mint 新 id，客户端传的 `--id` 只是批次内本地引用（不落库），`--sort-key` 被忽略。新增或删除都会把同层所有 `sortKey` 重编号 → **快照前后对照按 id 比对，不要按 sortKey diff**；老房间里的可读 id 继续能寻址。

label 命名习惯：自驾段 `A→B 距离 时长` · 徒步 `🥾 日期 起点→终点 距离 时长` · 点位 `emoji 名称 日期`。想给路线分类就靠 emoji + note，不要指望 id 前缀。

图层样式（file 图层）另有 `--color / --opacity / --line-width / --visible`；`layers add --opacity` 首次上传可能不生效，落好后用 `snapshot` 看一眼，需要时补一条 `layers update <id> --opacity <值>`。

## 配色速查

**规则**：只用 Tailwind 默认板；相邻两天**同一色相**（同系列）但**深浅跳 2 档**（可辨）；每跨一对色相前进一族（看出行程在推进）。硬指标：相邻 ΔE(CIEDE2000) **≥ 15**。

```
Day1 blue-400   #60a5fa   Day2 blue-600   #2563eb
Day3 violet-400 #a78bfa   Day4 violet-600 #7c3aed
Day5 pink-400   #f472b6   Day6 pink-600   #db2777
Day7 amber-400  #fbbf24   Day8 amber-600  #d97706
```

**为什么必须跳档**：Tailwind 同族相邻档 ΔE 只有 5–11，相邻色相逐档推进也只有 5–12——都低于可辨阈值；同系列靠「同色相」实现，可辨靠「跳档」实现。

**语义要素不另配色**：住宿 / 机场 / 港口 / 取还车 **继承当天单元色**，靠 `🏨✈️⛴️🚗🔑` 区分；唯一破例色 = `#ef4444` red-500（警示/危险点）。

生成与校验：

```bash
python3 scripts/palette_band.py --units 6 --families blue,violet,pink   # 出色带 + ΔE 报告
python3 scripts/palette_band.py --units 8 --start amber --jump 3        # 更强区分
python3 scripts/palette_band.py --check "Day1=#3b82f6,Day2=#8b5cf6"    # 审计已有色序
python3 scripts/palette_band.py --units 6 --chart /tmp/band.png         # 色带图（Pillow）
```

单元多于 4 对时用 `--stride 1`（`blue→indigo→violet→purple→fuchsia→pink→rose` 连续推进），相邻仍同族成对；13~14 天的行程也能全部通过 ΔE ≥ 15。

细节、实测表、重排示例见 `references/color-system.md`。

## note 模板

**点位**

```
emoji **名称** — 日期/时间
📍 地点 · 特色一句话
← 上一站 24km 20m | → 下一站 35km 40m
[官网/维基/Booking 链接]
```

**路线**

```
🚗 8/9 **稚内→宗谷岬**
📏 31km | ⏱ 23min
途经亮点（宗谷丘陵·白い道）
出发地/到达地信息
```

符号词典：`📍` 位置 · `📏` 距离 · `⏱` 时长 · `⏰` 时刻 · `💰` 票价 · `🏨` 住宿 · `⛴️` 船 · `🚌` 巴士 · `🥾` 徒步 · `📈` 累计爬升 · `★` 难度 · `⚠️` 风险 · `←/→` 前后接续。

## 备用 · 徒步 · 可选 · 切换

- **备用行程（Plan B）**：与主线**同色**（颜色不参与主备编码），靠 `dashed + opacity 0.5 + width 3.5 + label 后缀 (备选)` 区分；note **第一行必须是触发条件**；起讫点要与主线的分岔/汇合点重合；排序放在**同层末尾**（`annotations reorder` 把主线 id 排前面），不另开「备选」层。
- **徒步**：独立成层，`--profile walking --line-style dotted --width 4 --opacity 0.85`，颜色继承当天单元色；徒步与接驳（巴士/船 = dashed）**分开画**，不要连成一条；note 必含海拔 / 累计爬升 / 难度★ / 接驳时刻 / 风险。
- **可选加点**：label 后缀 `(可选)`，颜色继承；不单独画 route（要画就 `dotted + opacity 0.45`）。
- **切换逻辑**：写在**决策点**那条 note 里（如「※ 天气最好的那天去礼文岛」），两个方向都画，一主一备。整段替换的多日方案才单独成层，层名以 `🔁` 开头并 `visible=false`。
- **已取消/已完成**：不删除，`layers hide` 或 `visible=false` 保留可追溯；被更好数据取代的线段（重画过的同一段路）可以删，但要在汇报里说明删了什么。

模板与完整示例见 `references/variants-and-hiking.md`。

## 执行流程（CLI）

```bash
# 0. 只读盘点（快照常 >1MB，务必落文件再解析；--client-type query 表示只读，不刷新 agent 活跃度）
atlas-realm --host https://map.mgt.moe --room <room> --client-id agent-planner \
  --client-type query snapshot --json > /tmp/snap.json
# 1. 建层（--layer-id 指向不存在的层会崩，先建层）
#    ⚠️ id 由服务端分配：从返回结果取 layer-<uuid>，不要试图指定 id / sortKey
atlas-realm ... annotations layers add --name "🚗 Day 1 8/5 札幌→小平" --json
# 2. 外部寻路取真实道路 → 转 WGS-84 → 写入
#    点串是平铺 [[lng,lat],…]；标注 id 同样是服务端分配（返回 feature-<uuid>）
atlas-realm ... annotations add route --layer-id <layer-uuid> --waypoints "..." --geometry "..." \
  --profile driving --label "札幌→神威岬 104km 1h40m" --color "#60a5fa" --width 4 \
  --opacity 0.9 --line-style solid --distance-text "106km" --duration-text "1h21m" --directed true --json
# 3. 点位 / 长文本（长 note 用 --note-file）
atlas-realm ... annotations add point --layer-id <layer-uuid> --lng 140.346692 --lat 43.33357 \
  --label "🏔️ 神威岬 8/5" --color "#60a5fa" --note-file ./kamui.md --json
# 4. 顺序：把同级 id 全部按目标顺序传进去（局部传 = 只把这几条挪到最前）
atlas-realm ... annotations layers reorder <id1> <id2> <id3> --json
atlas-realm ... annotations reorder <seg1> <seg2> <seg3> --layer-id <layer-uuid> --json
# 5. 回读验证（用返回的真实 id）
atlas-realm ... annotations get <feature-uuid> --json
```

顺序：**snapshot → 建层 → 写 route（带真实 geometry）→ 写 point → reorder → 回读**；一次只做一个 mutation。

批量改动时把 payload 落成 JSON 文件用 `--feature-file` / `--patch-file` 传——既能避免超长命令行，也能避开 `shell=True` + f-string 拼接悄悄吃掉参数（带引号、`#` 颜色等）的坑：那种情况下命令会"成功"，但字段根本没写进去。移动标注到别的层用 `annotations update <id> --layer-id <other>`。

## 验收清单

- [ ] 坐标全为 WGS-84（高德来源已按 GCJ-02→WGS-84 转换并反查校验）
- [ ] 每条 route 都有真实 `geometry`；跨海段才用 3 点直线 + dashed
- [ ] 每条 route 都带 `distanceText` + `durationText`（里程用高德口径），且与前后点的 `←/→` 一致
- [ ] 每个 point 的 label 有日期，note 有出处链接
- [ ] 每层都有 emoji 名称，第一层恒为 `📍 POI & 宿泊`
- [ ] 配色：`palette_band.py --check` 通过（相邻 ΔE ≥ 15，色相差 ≤ 75°），无自定义 hex（参考层导入的历史配色除外）
- [ ] 每个点的颜色 == 其所属单元色（未单独挑色）；住宿/机场等语义要素继承当天色 + emoji
- [ ] 备选线同色 + dashed + 低透明 + label 后缀，且排在**同层末尾**；徒步线 dotted 且与接驳线分开
- [ ] 概览表与正文冲突处已确认（尤其「途经」列表这类旧文案）
- [ ] 新建对象老老实实从返回结果取 id；顺序用 `reorder` 显式指定过
- [ ] 完成后 `snapshot` 复查 + **截图目视一次**（整体 + 关键路段各一张）。地图是 WebGL 渲染，抓不到 DOM 文本，只能截图；`npx playwright screenshot --channel chrome --wait-for-timeout 20000 "<room-url>#<zoom>/<lat>/<lng>" out.png` 就够用，再用像素分析核对每天的颜色是否都真的画出来了

## 配套文件

- `references/color-system.md` —— 配色 SOP 全文（色板来源、实测 ΔE 表、色带模板、重排示例、校验清单）
- `references/variants-and-hiking.md` —— 备用 / 徒步 / 可选 / 切换的写法与 note 模板
- `references/annotation-sop.md` —— 标注 SOP v1.2 完整文档（含数据模型、note 结构、流程）
- `references/palette-options.png` —— 配色方案对比图（现状 / 不可用方案 / 推荐色带 / 加密变体）
- `scripts/palette_band.py` —— 色带生成 + CIEDE2000 相邻可辨度校验（`--chart` 出图需 Pillow）

更多 CLI 细节（路由、坐标、批量写入、id 语义）见 `atlas-realm` skill。
