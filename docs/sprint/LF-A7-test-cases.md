# LF-A7 测试用例与回归清单

解皓喆（832402108）｜Issue #13｜2026-11-22
## 自动化用例（`node --test`，14 条）

| 编号 | 用例 | 覆盖点 |
| --- | --- | --- |
| T01 | health and static frontend | 启动、健康检查、静态托管 |
| T02 | public device directory | 有效状态计算 |
| T03 | authentication guard | 错误口令、未登录拦截 |
| T04 | catalog filters | 关键字/实验室/类型/状态 |
| T05 | reservation create & approve | 冲突检测、审核 |
| T06 | pending cancel | 取消释放时段 |
| T07 | cutoff window | 30 分钟截止 |
| T08 | repair workflow | 照片、设备状态、通知 |
| T09 | equipment management | 角色、快照、删除保护 |
| T10 | user administration | 末位管理员保护 |
| T11 | weekly statistics | 利用率、高峰时段 |
| T12 | 15-minute reminder | 调度器只触发一次 |
| T13 | notification read & logout | 已读、会话失效 |
| T14 | 聚合端到端 | 上述共享同一服务实例，按序验证状态迁移 |

## 浏览器回归（2026-10-31 基线）

首页/学生/教师 4 档分辨率无横向溢出；搜索、预约、冲突提示、报修、审核、维修、设备增改删、取消全部通过。

## 待补边界（11/25–11/26）

1. 照片超过 2 MB、伪装扩展名、非图片签名
2. 同一设备 10 个并发提交（事务串行化）
3. 跨日预约（22:00 结束、次日 08:00 开始）不计冲突
4. 400/413 请求体超限提示
