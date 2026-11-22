# LF-A1 部署上线记录

陈文俊（832401202）｜Issue #1｜2026-11-22
## 环境

- 机器：Windows 11，干净目录检出，未安装任何全局依赖
- 运行时：便携 Node 24（仓库内固定，不写进 PATH）
- 端口：3100（避开默认 3000，验证 `PORT` 配置真实生效）

## 执行

```powershell
node src/server.js
```

首次启动自动建库 `data/labflow.db`，写入 5 台演示设备与三个演示账号（student / teacher / admin）。

## 验证

| 检查项 | 结果 |
| --- | --- |
| `GET /api/health` | 200，`{"status":"ok","database":"ok","time":"2026-11-22T12:03:45.497Z"}` |
| `GET /index.html` | 200，6385 字节 |
| `node --test` | 14 通过 / 0 失败，1.16 s |
| 第二台机器复现 | 通过，仅执行上面一条命令 |

## 发现的问题

`docs/API.md` 把健康检查写成 `/health`，路由实际注册在 `/api/health`，按文档探测会拿到 404。已在 README 运行手册中改正，接口文档的修正单独开 Issue 跟踪。

## 结论

满足 LF-A1 验收标准：一台干净机器只按 README 就能跑起来，并且能用一条请求判断服务是否健康。
