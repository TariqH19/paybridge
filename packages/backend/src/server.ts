import { app } from "./app.js";
import { config } from "./config.js";
import { closeDatabase, connectToDatabase } from "./db.js";

async function startServer(): Promise<void> {
  await connectToDatabase();

  const server = app.listen(config.PORT, () => {
    console.log(`PayBridge API listening on http://localhost:${config.PORT}`);
  });

  const shutdown = async () => {
    server.close(async (error) => {
      if (error) {
        console.error("Failed to close the HTTP server", error);
        process.exitCode = 1;
      }

      await closeDatabase();
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

startServer().catch((error: unknown) => {
  console.error("Failed to start PayBridge API", error);
  process.exitCode = 1;
});
