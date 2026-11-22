import { overviewStats } from "../services/stats.js";

export function registerStatsRoutes(router) {
  router.get("/api/stats/overview", async (ctx) => {
    ctx.json(200, overviewStats(ctx.db, ctx.query, ctx.config));
  }, { auth: true, roles: ["teacher", "admin"] });
}
