# dsh-tool-dockerhub 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-dockerhub` |
| 定位 | DeepSeek Harness 的 Docker Hub 只读插件 |
| 版本 | v0.1.0 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | Docker Hub Registry/Hub v2 REST |
| 认证 | username + PAT 换短期 Bearer JWT（内存缓存） |

### 1.1 目录

```text
src/client.ts       DockerHubClient：token 交换与缓存、fetch 注入、超时、错误映射
src/index.ts        8 个 defineTool 定义与插件 apply
tests/client.spec.ts  客户端契约测试（token 交换不回显、分页、认证头）
tests/tools.spec.ts   工具注册、render 测试
examples/cordis.yml   dsh 组合配置示例
```

## 2. 技术决策

### 2.1 认证与 token 安全

- `POST /v2/auth/token` 用 username + PAT 换 JWT，缓存后以 `Authorization: Bearer` 使用；公共搜索不带认证头。
- 任何工具结果都不返回 token 或其片段（v0.1 早期版本曾回显 8 位预览，已移除并有测试兜底）。

### 2.2 语义边界

- `dockerhub_get_namespace` 只返回配置的 namespace 摘要，不再把用户名当作同名仓库查询（Docker Hub 无稳定的 namespace 元数据接口）。
- `page`/`pageSize` 在客户端钳制（page>=1，pageSize 1-100），不信任异常输入。
- 仓库/搜索描述按不可信文本处理，render 限长 200 字符。

### 2.3 错误映射

| 场景 | 返回/行为 |
|---|---|
| 未配置凭证 | `{ ok: false, reason }` / `{ found: false, reason }` |
| HTTP 4xx/5xx | 抛 `DockerHubError`，工具层转规范化失败值 |

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
```

当前 9 个测试覆盖：PAT 交换不回显、分页与 Bearer 认证头、仓库/tag 映射、无凭证公共搜索、限流响应头、缺凭证保护、HTTP 错误映射、工具注册与 render。

## 4. 后续方向

- 401 时清除缓存 token 并重试一次。
- Repository webhook 只读巡检。
- ECR/GHCR 分别并入 `dsh-tool-aws` 与 `dsh-tool-github`，不在本插件扩展。
