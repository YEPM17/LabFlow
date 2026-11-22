# LF-A2 预约面板预填实现计划

刘明泽（832402114）｜Issue #6｜2026-11-23
## 调用链

```text
扫描结果
  → GET /devices/:id               取名称、实验室、类型、有效状态
  → GET /devices/:id/availability  取约束与占用时段（date/start/end）
  → 渲染预约面板（设备锁定）
  → POST /reservations             学生确认后提交，规则不变
```

## 字段映射

- `device.name` → 面板标题；`device.room` → 副标题
- `availability.constraints` → 时间选择器的最小/最大时长与开放时段
- `availability.blocks` → 灰掉的时段（不带学生姓名）

## 错误处理

- 404：面板不打开，提示设备不存在
- 409 冲突：保留已选时间，标红冲突区间，允许改选
- 401：跳登录，登录后回到本流程

## 约束

不在前端重复实现预约规则（时长、步进、开放时间），全部以 `availability` 返回的约束为准，避免两处口径漂移。

## 验收

扫码后 3 秒内出面板；改期后能正常提交；冲突时提示与 `POST` 返回的错误码一致。
