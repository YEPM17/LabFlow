# LabFlow scan-code design (LF-A2)

Status: **design frozen on 2026-11-22**, implementation starts 2026-11-23.
Team: LabRunners (14 members).
Owner: 聂迪非 (832401216, interaction design and information architecture) · Implementers: 刘明泽 (832402114), 王梓涵 (832401220) · Reviewer: 陈文俊 (832401202).

## 1. Purpose

Students already have a manual "query by device number" entry (`# 按编号查询` on the student workspace). Walking through the lab, the faster path is to scan the QR label on the device and land directly in a reservation panel with that device pre-selected.

LF-A2 closes this loop. It does **not** add a second scanner or a new search service; it adds a label payload contract, a resolution step, and the hand-off into the existing booking flow.

## 2. Label payload

Each device carries one printed label encoding:

```text
labflow://d/<deviceId>?c=<checksum>
```

| Part | Meaning | Why |
| --- | --- | --- |
| `d/<deviceId>` | Numeric device ID from the database | Stable primary key already used by every endpoint |
| `c=<checksum>` | First 4 hex characters of `sha256(deviceId + LABFLOW_LABEL_SALT)` | Rejects labels copied from another product or hand-typed IDs, before any network call |

Labels are printed per room, so a stale label whose device has been deleted resolves to a clear "device no longer exists" state instead of a 404 page.

## 3. Flow

```text
scan QR
  -> parse payload, validate prefix and checksum      (client, no request)
  -> GET /devices/:id                                 (resolve name, room, type, effective status)
  -> GET /devices/:id/availability?date&start&end     (constraints + blocking slots)
  -> open reservation panel, device prefilled
  -> POST /reservations                               (unchanged booking rules)
```

The scan never creates a reservation by itself. It only pre-fills the panel; the student still confirms the time slot, and every rule of the existing booking flow applies unchanged (30-minute step, 0.5–4 h, 08:00–22:00, overlap check, maintenance block).

## 4. Permissions

- Scanning requires a logged-in student session. Without a session the scan stores the payload and resumes the flow after login.
- The panel calls only the two endpoints above. `availability` already returns blocking slots without student names, so scanning does not leak who booked the device.
- Teachers and admins scanning a label get the teacher-side device detail page instead of the booking panel.

## 5. Failure states

| State | Message | Recovery |
| --- | --- | --- |
| Prefix or checksum invalid | "This code is not a LabFlow device label" | Manual number input stays available |
| Device deleted | "This device is no longer in the catalog" | Back to catalog |
| Device under maintenance | Status shown as `maintenance`, booking disabled | Pick another device |
| Camera denied / unavailable | "Camera unavailable, enter the number manually" | Manual input |
| Network error after a valid parse | Retry banner, payload kept in memory | Retry button |

## 6. Out of scope for this sprint

- Generating and printing the labels themselves (a one-off script, tracked separately).
- QR generation in the teacher workspace.
- Batch checkout/return by scanning (post-Alpha; the current UI has no checkout state).

## 7. Acceptance criteria

1. A valid label opens the reservation panel with the correct device, room and current effective status.
2. An invalid checksum is rejected client-side with no network request.
3. A device deleted after the label was printed produces the "no longer in the catalog" state.
4. A device under maintenance cannot be booked from the scanned panel.
5. Manual number input still works when the camera is unavailable.
6. `GET /devices/:id/availability` responses during the flow contain no student identity.

## 8. Open questions

- Whether the checksum salt is deploy-time configuration or a build constant (back end to decide before implementation).
- Whether the label carries the room code for faster offline validation.
