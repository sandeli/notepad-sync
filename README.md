# 📝 云记事本 notepad-sync

一个极简的 Chrome 记事本插件：多条纯文本笔记，数据自动同步到你自己的 **Cloudflare Workers + KV**，离线也能用。

- 🗒️ 多条笔记列表，点击即编辑，输入自动保存
- 🎨 每条笔记随机分配一个淡色标记，一眼区分
- ☁️ 打开插件自动同步；后台每 30 分钟补一次；断网可写，恢复后自动合并
- 🔑 Token 鉴权，无账号系统，你的数据只在你的 Cloudflare 账户里
- 📦 侧载安装即可，不上架 Chrome 商店

## 目录结构

```
extension/   Chrome 插件（Manifest V3）
worker/      Cloudflare Workers 同步后端
```

## 快速开始

### 1. 部署后端 Worker

```bash
cd worker
wrangler kv namespace create notepad-kv
# 把返回的 id 填进 wrangler.toml（复制 wrangler.toml.example 改名）

# 设置访问令牌（自己生成一个随机字符串）
echo "你的令牌" | wrangler secret put NOTE_TOKEN

wrangler deploy
```

部署成功后记下 Worker 地址，例如 `https://notepad-sync.<你的子域>.workers.dev`。

### 2. 安装插件（侧载）

1. Chrome 打开 `chrome://extensions`，右上角开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择 `extension/` 目录
3. 点插件图标 → ⚙️ 设置页，填入 Worker 地址和令牌 → 「测试连接」
4. 在任意一台电脑重复第 2、3 步，填同样的地址和令牌，就是同一份笔记

> 提示：`manifest.json` 里 `host_permissions` 默认允许示例域名；若你用了自己的 Worker 地址，
> 把它改成你的地址后重新加载插件即可。

## 同步机制

- 每条笔记带 `updated_at`，合并时**后写优先**（last-write-wins），粒度精确到单条笔记
- 删除通过墓碑（tombstone）传播到其他设备，墓碑在 KV 中保留 30 天
- 本地用 `chrome.storage.local` 缓存，插件弹窗打开时拉取远端、推送本地变更

## API（Worker）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/ping` | 连通性检查（测试连接用） |
| GET | `/api/notes` | 拉取全部笔记 + 删除墓碑 |
| PUT | `/api/notes/:id` | 新建 / 更新一条笔记 |
| DELETE | `/api/notes/:id` | 删除一条笔记（写墓碑） |
| POST | `/api/sync` | 批量推送 `{notes, tombstones}` |

所有接口需要在请求头带 `Authorization: Bearer <NOTE_TOKEN>`。

## License

MIT
