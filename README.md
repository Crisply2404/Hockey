# Hockey

简洁风格的气垫球网页游戏，支持本地游戏和两人联机。

## 本地游戏

安装 Node.js 后，在仓库根目录执行：

```bash
npm ci
npm run dev
```

进入 `Local` 可以选择人机对战或者本地双人对战。左方使用 WASD、鼠标或者触摸；本地双人对战的右方使用方向键。

## 联机游戏

游戏会自动连接部署好的 Cloudflare Worker。玩家通过 `Create Room` 建立两人房间，并向另一名玩家分享六位房间编号。加入者在大厅输入房间编号或者在公开列表点击 `Enter`。

联机比赛由房主计算。加入者使用 WASD、方向键、鼠标或者触摸控制右方。比赛输入、比分、球门屏障、得分、获胜状态和主要碰撞效果都会同步。

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
- Matt engineering skills 配置见 [docs/agents/](./docs/agents/)。
