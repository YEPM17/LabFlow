import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { notFound } from "../errors.js";
import {
  completeRepair,
  createRepair,
  getRepair,
  getRepairPhoto,
  listRepairs,
  startRepair
} from "../services/repairs.js";

export function registerRepairRoutes(router) {
  router.get("/api/repairs", async (ctx) => {
    ctx.json(200, listRepairs(ctx.db, ctx.user, ctx.query));
  }, { auth: true });

  router.get("/api/repairs/:id", async (ctx) => {
    ctx.json(200, { repair: getRepair(ctx.db, ctx.user, ctx.params.id) });
  }, { auth: true });

  router.post("/api/repairs", async (ctx) => {
    const repair = await createRepair(ctx.db, ctx.user, ctx.body || {}, ctx.config);
    ctx.json(201, { repair });
  }, { auth: true, roles: ["student"] });

  router.post("/api/repairs/:id/start", async (ctx) => {
    ctx.json(200, { repair: startRepair(ctx.db, ctx.user, ctx.params.id) });
  }, { auth: true, roles: ["teacher", "admin"] });

  router.post("/api/repairs/:id/complete", async (ctx) => {
    ctx.json(200, { repair: completeRepair(ctx.db, ctx.user, ctx.params.id) });
  }, { auth: true, roles: ["teacher", "admin"] });

  router.get("/api/repairs/:id/photos/:photoId", async (ctx) => {
    const photo = getRepairPhoto(ctx.db, ctx.user, ctx.params.id, ctx.params.photoId);
    const uploadRoot = path.resolve(ctx.config.uploadDir);
    const filePath = path.resolve(uploadRoot, photo.stored_name);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) throw notFound("未找到该照片");
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      throw notFound("照片文件不存在");
    }
    const encodedName = encodeURIComponent(photo.original_name || "photo");
    ctx.res.writeHead(200, {
      "Content-Type": photo.mime_type,
      "Content-Length": stat.size,
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`
    });
    ctx.handled = true;
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => ctx.res.destroy());
    stream.pipe(ctx.res);
  }, { auth: true });
}
