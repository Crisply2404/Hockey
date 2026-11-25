# Hockey

黑白线条风格的气垫球网页游戏：人机对战、本地双人与两人联机，支持鼠标、键盘与触屏。球桌上的一切都是线——边墙是会抖的弦，屏障是皮筋，一局打完留下一张进球线图。

## 运行

安装 Node.js 后，在仓库根目录执行：

```bash
npm ci
npm run dev
```

浏览器打开 `http://localhost:3000`。主菜单背后是一场由电脑控制双方的演示比赛。

## 玩法

- **人机对战**：一名玩家控制左方，AI 对手控制右方。难度分简单、普通、困难三档，在主菜单选择。
- **本地双人**：两人共用一台设备。左方用 WASD 或鼠标，右方用方向键；触屏上两人各按住自己的半场。
- **联机对战**：创建房间，把六位房间编号或者邀请链接发给朋友；对方打开链接会直接进入房间。

球拍跟随鼠标或手指移动，碰到冰球即为击球。球门口横着一根皮筋：慢球被它兜住弹回，正面的快球把它绷断后进门。先得 7 分的一方获胜。一局结束后，这一局每个进球的球路会按顺序重画，留下一张线图。

本地比赛中按 `Esc` 或 `P` 暂停；页面切到后台时自动暂停。主菜单右上角可以切换语言、黑白主题和声音。竖屏设备上球桌会旋转 90°，本方半场位于画面下方。

## 联机游戏

游戏只在进入联机大厅时连接部署好的 Cloudflare Worker。联机比赛由房主计算，访客发送输入并显示房主发来的比赛快照；访客自己的球拍在本机先行移动，快照之间的画面由插值补出。房主的页面处于后台时浏览器会停止计算，比赛随之停住，直到房主回到页面。

邀请链接的格式是 `<游戏地址>?room=<房间编号>`。

## 本地运行联机服务

第一份终端启动 Cloudflare Worker：

```bash
npm --prefix cf/worker ci
npm run dev:worker
```

第二份终端启动游戏：

```bash
npm run dev
```

浏览器打开 Vite 页面之后，可以使用多个浏览器页面测试房间。联机检查会自行启动独立的本地 Worker：

```bash
npm run test:online
```

## 检查

```bash
npm run check        # 前端与 Worker 的 TypeScript 检查
npm run test:online  # 房间与消息转发，使用本地 Worker
npm run build        # 生产构建
```

玩法与界面主要靠打开网页实际游玩来核对。

## 部署 Cloudflare Worker

Cloudflare Worker 名称和域名由 `cf/worker/wrangler.toml` 指定；允许访问的网页来源和 SQLite Durable Object 也在此文件中配置。`npm run deploy:worker` 使用项目已经安装的 Wrangler，并将 Worker 部署至当前 Cloudflare 账户。

部署前登录 Cloudflare：

```bash
npm --prefix cf/worker exec -- wrangler login
```

登录后部署，并检查服务状态：

```bash
npm run deploy:worker
curl https://hockey-lobby.tcoinsm.workers.dev/health
```

生产网页自动连接 `wss://hockey-lobby.tcoinsm.workers.dev/ws`。部署网页的人也可以通过构建环境变量 `VITE_LOBBY_WS_URL` 指定游戏使用的服务地址。玩家加入房间时只需要房间编号。

## 项目说明

- 游戏元素与操作名称见 [GLOSSARY.md](./GLOSSARY.md)。
- 规则、双方角色、联机消息和核对记录见 [docs/project-understanding.md](./docs/project-understanding.md)。
- 设计决定见 [docs/adr/](./docs/adr/)。
- Matt engineering skills 配置见 [docs/agents/](./docs/agents/)。
