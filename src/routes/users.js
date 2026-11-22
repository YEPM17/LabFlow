import { createUser, listUsers, updateUser } from "../services/users.js";

export function registerUserRoutes(router) {
  router.get("/api/users", async (ctx) => {
    ctx.json(200, listUsers(ctx.db, ctx.query));
  }, { auth: true, roles: ["admin"] });

  router.post("/api/users", async (ctx) => {
    ctx.json(201, { user: await createUser(ctx.db, ctx.body || {}) });
  }, { auth: true, roles: ["admin"] });

  router.patch("/api/users/:id", async (ctx) => {
    ctx.json(200, { user: await updateUser(ctx.db, ctx.params.id, ctx.body || {}) });
  }, { auth: true, roles: ["admin"] });
}
