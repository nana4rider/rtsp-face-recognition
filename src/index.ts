import logger from "@/logger";
import initializeHttpServer from "@/service/http";

async function main() {
  const http = await initializeHttpServer();

  const handleShutdown = async () => {
    logger.info("shutdown");
    await http.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());
}

try {
  await main();
} catch (err) {
  logger.error("main() error:", err);
  process.exit(1);
}
