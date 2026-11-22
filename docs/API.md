# LabFlow REST API

Base URL: `http://127.0.0.1:3000/api`

All request and response bodies use JSON. Authentication uses an HTTP-only session cookie named `labflow_session`; the cookie is refreshed on authenticated requests and expires after 30 minutes of inactivity. State-changing requests must be same-origin.

Unified error shape:

```json
{
  "error": {
    "code": "RESERVATION_CONFLICT",
    "message": "该时间段已有预约申请，请选择其他时间"
  }
}
```

## Roles

| Role | Permissions |
| --- | --- |
| `student` | Read devices, create/cancel own reservations, create and read own repairs, read own notifications |
| `teacher` | Everything a student can read, review reservations, manage repairs, manage equipment, read statistics and staff notifications |
| `admin` | Teacher permissions plus user-account management |

## Authentication

### `POST /auth/login`

```json
{ "username": "student", "password": "Student@2026" }
```

Response `200`:

```json
{
  "user": {
    "id": 1,
    "username": "student",
    "displayName": "陈同学",
    "role": "student",
    "email": null,
    "active": true
  },
  "session": { "idleTimeoutMinutes": 30 }
}
```

Errors: `400 INVALID_CREDENTIALS`, `401 INVALID_CREDENTIALS`, `429 TOO_MANY_ATTEMPTS`.

### `GET /auth/me`

Returns the current user, session expiry and unread-notification count. Requires login.

### `POST /auth/logout`

Deletes the current session and clears the cookie. Returns `204`.

## Public devices

### `GET /public/devices`

No login required. Returns the effective status of every device:

```json
{
  "devices": [
    {
      "id": 1,
      "name": "数字示波器",
      "room": "实验楼 A201",
      "type": "电子测量",
      "description": "用于测量和观察电子信号",
      "status": "available"
    }
  ]
}
```

`status` is one of `available`, `reserved`, `maintenance`. `reserved` means an approved reservation is active at the current time.

## Devices

All endpoints below require login.

### `GET /devices`

Query parameters:

| Name | Description |
| --- | --- |
| `q` | Match name, room or type |
| `status` | `available`, `reserved` or `maintenance` |
| `room` | Exact room name |
| `type` | Exact equipment type |
| `page` | 1-based page, default 1 |
| `pageSize` | Default 100, maximum 200 |

Response includes `items`, `total`, pagination, `summary` and available `filters`:

```json
{
  "items": [],
  "total": 5,
  "page": 1,
  "pageSize": 100,
  "summary": { "total": 5, "available": 4, "reserved": 0, "maintenance": 1 },
  "filters": { "rooms": ["实验楼 A201"], "types": ["电子测量"] }
}
```

### `GET /devices/:id`

Returns `{ "device": { ... } }`.

### `GET /devices/:id/availability`

Query: `date=YYYY-MM-DD&start=HH:mm&end=HH:mm`.

```json
{
  "available": false,
  "code": "RESERVATION_CONFLICT",
  "message": "该时间段已有预约申请，请选择其他时间",
  "constraints": {
    "openTime": "08:00",
    "closeTime": "22:00",
    "minMinutes": 30,
    "maxHours": 4,
    "cancelCutoffMinutes": 30,
    "timeStepMinutes": 30,
    "currentDate": "2026-11-11",
    "currentTime": "17:30"
  },
  "blocks": [{ "start": "09:00", "end": "10:30", "status": "pending" }]
}
```

Blocking reservations do not expose student names.

### `POST /devices` (teacher/admin)

```json
{
  "name": "逻辑分析仪",
  "room": "实验楼 C101",
  "type": "电子测量",
  "description": "用于数字信号分析",
  "status": "available"
}
```

### `PATCH /devices/:id` (teacher/admin)

Any of `name`, `room`, `type`, `description`, `status`. Renaming a device also updates the name snapshot on related reservations and repairs.

### `DELETE /devices/:id` (teacher/admin)

Rejected with `409 DEVICE_IN_USE` when pending/approved reservations or pending/processing repairs exist. Historical records are retained with `deviceId: null` and their name snapshot.

## Reservations

### `GET /reservations`

Students see only their own records. Teachers and admins see all records. Filters: `status`, `date`, `deviceId`, `studentId` (staff only). Pagination: `page`, `pageSize`.

Each item contains:

```json
{
  "id": "uuid",
  "studentId": 1,
  "studentName": "陈同学",
  "studentUsername": "student",
  "deviceId": 1,
  "deviceName": "数字示波器",
  "currentDeviceName": "数字示波器",
  "date": "2026-11-12",
  "start": "09:00",
  "end": "10:30",
  "status": "pending",
  "rejectReason": null,
  "createdAt": "2026-11-11 17:30:00",
  "canCancel": true,
  "cancelBlockedReason": null
}
```

### `POST /reservations` (student)

```json
{ "deviceId": 1, "date": "2026-11-12", "start": "09:00", "end": "10:30" }
```

Rules:

- Date cannot be in the past; start time must be in the future.
- Times align to 30-minute steps.
- Duration from 30 minutes to 4 hours.
- Within opening hours `08:00-22:00` (configurable).
- No overlap with pending or approved reservations for the same device.
- Device must not be under maintenance.

Returns `201` with `{ "reservation": {...} }`. A conflict returns `409 RESERVATION_CONFLICT`.

### `POST /reservations/:id/cancel` (student, owner)

Pending reservations can be cancelled before their start time. Approved reservations can be cancelled up to 30 minutes before start; otherwise `409 CANCEL_WINDOW_CLOSED`.

### `POST /reservations/:id/review` (teacher/admin)

```json
{ "decision": "approved", "rejectReason": null }
```

`decision` is `approved` or `rejected`. Approval re-checks device state and approved-only overlap. The student receives an in-app notification. Returns `409 ALREADY_REVIEWED` on duplicate review.

## Repairs

Photos are sent as base64 data URLs in JSON. This keeps the project dependency-free; the server validates MIME signatures, limits each photo to 2 MB and accepts at most three photos.

### `POST /repairs` (student)

```json
{
  "deviceId": 2,
  "title": "电源无输出",
  "description": "开机后指示灯不亮",
  "photos": [
    { "name": "fault.png", "type": "image/png", "data": "[image omitted]" }
  ]
}
```

### `GET /repairs`

Students see their own records; staff see all. Filter by `status` and `deviceId`. Each repair includes a `photos` array:

```json
{
  "photos": [
    {
      "id": "uuid",
      "url": "/api/repairs/<repair-id>/photos/<photo-id>",
      "originalName": "fault.png",
      "mimeType": "image/png",
      "sizeBytes": 1234
    }
  ]
}
```

### `GET /repairs/:id/photos/:photoId`

Streams the image after an ownership check. Students can only read their own repair photos; teachers and admins can read all.

### `POST /repairs/:id/start` (teacher/admin)

`pending` → `processing`; sets the device to `maintenance` and notifies the student.

### `POST /repairs/:id/complete` (teacher/admin)

`processing` → `completed`; sets the device back to `available` when no other processing repair exists and notifies the student.

## Notifications

### `GET /notifications`

Query: `limit` (maximum 100), `unreadOnly=true`. Returns `items`, `total`, `unreadCount`.

### `POST /notifications/:id/read`

Marks one of the current user's notifications as read.

### `POST /notifications/read-all`

Marks all current-user notifications as read.

The scheduler creates a reminder notification when an approved reservation is within 15 minutes of starting.

## Statistics

### `GET /stats/overview?days=7` (teacher/admin)

Returns current device/reservation/repair status counts and a rolling weekly summary:

```json
{
  "range": { "startDate": "2026-11-05", "endDate": "2026-11-11", "days": 7 },
  "devices": { "total": 5, "available": 4, "reserved": 0, "maintenance": 1 },
  "reservations": { "total": 3, "pending": 1, "approved": 1, "rejected": 0, "cancelled": 1 },
  "repairs": { "total": 1, "pending": 1 },
  "weekly": {
    "reservationCount": 2,
    "approvedHours": 1.5,
    "utilizationRate": 2.1,
    "peakHours": [{ "hour": "09:00", "label": "09:00-10:00", "count": 1 }],
    "daily": [{ "date": "2026-11-05", "reservationCount": 0, "approvedHours": 0 }]
  }
}
```

Utilization = approved booking hours ÷ (device count × days × opening hours), capped at 100%.

## User management

All endpoints require the `admin` role.

### `GET /users`

Filters: `role`, `active`, pagination.

### `POST /users`

```json
{
  "username": "student2",
  "displayName": "王同学",
  "role": "student",
  "password": "Student2@2026",
  "email": null
}
```

### `PATCH /users/:id`

Any of `displayName`, `role`, `active`, `email`, `password`. The last active administrator cannot be demoted or disabled (`409 LAST_ADMIN`).

## Health

### `GET /health`

No login required:

```json
{ "status": "ok", "database": "ok", "time": "2026-11-11T09:30:00.000Z" }
```
