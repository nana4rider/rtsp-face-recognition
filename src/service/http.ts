import env from "@/env";
import logger from "@/logger";
import { startFaceRecognition } from "@/service/rtsp";
import type { FastifyInstance } from "fastify";
import fastify from "fastify";

export default async function initializeHttpServer() {
  const server = fastify();

  route(server);

  await server.listen({ host: "0.0.0.0", port: env.PORT });
  logger.info(`[HTTP] listen port: ${env.PORT}`);

  return server;
}

export function route(server: FastifyInstance) {
  server.get("/health", () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  server.post(
    "/trigger",
    {
      schema: {
        tags: ["default"],
        summary: "顔認識を開始する",
        description: "RTSPストリームの顔認識を非同期で開始します。",
        response: {
          202: {
            description: "顔認識処理を受け付けました。",
            type: "object",
            properties: {
              status: { type: "string", const: "accepted" },
            },
            required: ["status"],
          },
        },
      },
    },
    (_request, reply) => {
      void startFaceRecognition().catch((err: unknown) => {
        logger.error("[RTSP] Face recognition failed:", err);
      });
      return reply.code(202).send({ status: "accepted" });
    },
  );
}
