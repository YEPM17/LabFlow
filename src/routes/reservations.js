import {
  cancelReservation,
  createReservation,
  getReservation,
  listReservations,
  reviewReservation
} from "../services/reservations.js";

export function registerReservationRoutes(router) {
  router.get("/api/reservations", async (ctx) => {
    ctx.json(200, listReservations(ctx.db, ctx.user, ctx.query, ctx.config));
  }, { auth: true });

  router.get("/api/reservations/:id", async (ctx) => {
    ctx.json(200, { reservation: getReservation(ctx.db, ctx.user, ctx.params.id, ctx.config) });
  }, { auth: true });

  router.post("/api/reservations", async (ctx) => {
    ctx.json(201, { reservation: createReservation(ctx.db, ctx.user, ctx.body || {}, ctx.config) });
  }, { auth: true, roles: ["student"] });

  router.post("/api/reservations/:id/cancel", async (ctx) => {
    ctx.json(200, { reservation: cancelReservation(ctx.db, ctx.user, ctx.params.id, ctx.config) });
  }, { auth: true, roles: ["student"] });

  router.post("/api/reservations/:id/review", async (ctx) => {
    ctx.json(200, { reservation: reviewReservation(ctx.db, ctx.user, ctx.params.id, ctx.body || {}, ctx.config) });
  }, { auth: true, roles: ["teacher", "admin"] });
}
