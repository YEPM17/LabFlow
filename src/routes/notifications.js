import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "../services/notifications.js";

export function registerNotificationRoutes(router) {
  router.get("/api/notifications", async (ctx) => {
    ctx.json(200, listNotifications(ctx.db, ctx.user.id, {
      limit: ctx.query.limit,
      unreadOnly: ctx.query.unreadOnly === "true" || ctx.query.unreadOnly === "1"
    }));
  }, { auth: true });

  router.post("/api/notifications/:id/read", async (ctx) => {
    const changed = markNotificationRead(ctx.db, ctx.user.id, ctx.params.id);
    ctx.json(200, {
      changed,
      unreadCount: countUnreadNotifications(ctx.db, ctx.user.id)
    });
  }, { auth: true });

  router.post("/api/notifications/read-all", async (ctx) => {
    const changed = markAllNotificationsRead(ctx.db, ctx.user.id);
    ctx.json(200, { changed, unreadCount: 0 });
  }, { auth: true });
}
