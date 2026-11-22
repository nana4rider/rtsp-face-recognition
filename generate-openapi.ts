import logger from "@/logger";
import { route } from "@/service/http";
import swagger from "@fastify/swagger";
import fastify from "fastify";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { description, version } from "package.json";

const TITLE = "RTSP Face Recognition";

assert(typeof version === "string");
assert(typeof description === "string");

const server = fastify();

await server.register(swagger, {
  openapi: {
    info: {
      title: TITLE,
      description,
      version,
    },
    servers: [
      {
        url: "http://localhost:{port}",
        description: "Local server",
        variables: {
          port: {
            default: "3000",
          },
        },
      },
    ],
  },
});

route(server);

try {
  await server.ready();

  const swaggerJson = server.swagger();

  const fileName = path.join("docs", "openapi.json");
  await fs.writeFile(fileName, JSON.stringify(swaggerJson, null, 2) + "\n");

  logger.info(`Swagger JSON has been saved to ${fileName}`);
} catch (err) {
  logger.error("Error generating Swagger JSON:", err);
} finally {
  await server.close();
}
