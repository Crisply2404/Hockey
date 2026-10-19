# Hockey 联机服务

Cloudflare Worker 与 `Lobby` Durable Object 提供房间列表、创建、加入、退出、玩家输入与比赛快照转发。房主计算比赛状态，访客通过同一条 WebSocket 连接发送操作并接收快照。

- `GET /health` 返回 `{"ok":true,"service":"hockey-lobby"}`。
- `GET /ws` 将连接升级为 WebSocket。
- `wrangler.toml` 配置允许的网页来源、Worker 名称与 Durable Object。
- WebSocket attachment 保存临时房间成员关系，供 Durable Object 休眠恢复时读取。

在仓库根目录运行 `npm --prefix cf/worker ci` 安装依赖，使用 `npm run dev:worker` 启动本地服务，使用 `npm run test:online` 执行独立的本地房间与消息检查。

部署方法见根目录的 [README.md](../../README.md)。
