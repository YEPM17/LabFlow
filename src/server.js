import http from "node:http";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { closeDatabase, createDatabase, seedDatabase } from "./db.js";
import { startReminderScheduler } from "./scheduler.js";

async function main() {
  const db = createDatabase(config.dbPath);
  await seedDatabase(db);
  const handler = createApp({ db, config });
  const server = http.createServer(handler);
  server.keepAliveTimeout = 15_000;
  server.headersTimeout = 20_000;

  const stopScheduler = startReminderScheduler(db, config);

  server.listen(config.port, config.host, () => {
    console.log("");
    console.log("  LabFlow backend is running");
    console.log(`  Local:   http://${config.host}:${config.port}/`);
    console.log(`  Health:  http://${config.host}:${config.port}/api/health`);
    console.log(`  Database: ${config.dbPath}`);
    console.log("");
    console.log("  Demo accounts");
    console.log(`  Student: ${config.demoAccounts.student.username} / ${config.demoAccounts.student.password}`);
    console.log(`  Teacher: ${config.demoAccounts.teacher.username} / ${config.demoAccounts.teacher.password}`);
    console.log(`  Admin:   ${config.demoAccounts.admin.username} / ${config.demoAccounts.admin.password}`);
    console.log("");
  });

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\nReceived ${signal}, shutting down...`);
    stopScheduler();
    server.close(() => {
      closeDatabase(db);
      process.exit(0);
    });
    setTimeout(() => {
      closeDatabase(db);
      process.exit(1);
    }, 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
