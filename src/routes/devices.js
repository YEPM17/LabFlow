import {
  createDevice,
  deleteDevice,
  deviceAvailability,
  getDevice,
  listDevices,
  listPublicDevices,
  updateDevice
} from "../services/devices.js";

export function registerDeviceRoutes(router) {
  router.get("/api/public/devices", async (ctx) => {
    ctx.json(200, { devices: listPublicDevices(ctx.db) });
  });

  router.get("/api/devices", async (ctx) => {
    ctx.json(200, listDevices(ctx.db, ctx.query, ctx.config));
  }, { auth: true });

  router.get("/api/devices/:id", async (ctx) => {
    ctx.json(200, { device: getDevice(ctx.db, ctx.params.id) });
  }, { auth: true });

  router.get("/api/devices/:id/availability", async (ctx) => {
    ctx.json(200, deviceAvailability(ctx.db, ctx.params.id, ctx.query, ctx.config));
  }, { auth: true });

  router.post("/api/devices", async (ctx) => {
    ctx.json(201, { device: createDevice(ctx.db, ctx.body || {}) });
  }, { auth: true, roles: ["teacher", "admin"] });

  router.patch("/api/devices/:id", async (ctx) => {
    ctx.json(200, { device: updateDevice(ctx.db, ctx.params.id, ctx.body || {}) });
  }, { auth: true, roles: ["teacher", "admin"] });

  router.delete("/api/devices/:id", async (ctx) => {
    const device = deleteDevice(ctx.db, ctx.params.id);
    ctx.json(200, { deleted: true, device });
  }, { auth: true, roles: ["teacher", "admin"] });
}
