# Worker 部署说明

## 准备

1. 安装 wrangler：`npm i -g wrangler`（或 `npx wrangler`）
2. 登录：`wrangler login`

## 步骤

```bash
# 1. 创建 KV
wrangler kv namespace create notepad-kv
# 记下返回的 id

# 2. 复制配置模板并填 id
cp wrangler.toml.example wrangler.toml
# 编辑 wrangler.toml，把 id 换成上一步的值

# 3. 设置访问令牌（生成一个足够随机的字符串，例如 openssl rand -hex 24）
echo "你的令牌" | wrangler secret put NOTE_TOKEN

# 4. 部署
wrangler deploy
```

部署后访问 `https://<worker地址>/api/ping` 会返回 401（需要 Token），带上
`Authorization: Bearer <你的令牌>` 应返回 `{"ok":true,...}`。

## 存储结构（KV）

- `note:{id}` → 笔记 JSON `{id, title, content, updated_at, created_at}`
- `tomb:{id}` → 删除墓碑 `{id, deleted_at}`，30 天 TTL，过期自动清除
