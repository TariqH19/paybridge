import { closeDatabase, createDatabaseIndexes } from "./db.js";

try {
  await createDatabaseIndexes();
  console.info("PayBridge database indexes ensured.");
} catch (error) {
  console.error(
    JSON.stringify({
      level: "error",
      event: "database_index_setup_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
