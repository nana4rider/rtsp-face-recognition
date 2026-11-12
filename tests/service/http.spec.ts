import logger from "@/logger";
import initializeHttpServer, { route } from "@/service/http";
import { startFaceRecognition } from "@/service/rtsp";
import type { FastifyInstance } from "fastify";
import fastify from "fastify";

vi.mock("@/service/rtsp", () => ({
  startFaceRecognition: vi.fn(),
}));

vi.mock("@/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("initializeHttpServer", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await initializeHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  test("route()が正常終了すること", () => {
    const server = fastify();
    const actual = () => route(server);

    expect(actual).not.toThrow();
  });

  test("/health エンドポイントでヘルスステータスが返されること", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      uptime: expect.any(Number) as number,
      timestamp: expect.any(Number) as number,
    });
  });

  test("POST /trigger エンドポイントで顔認識を開始して202を返す", async () => {
    vi.mocked(startFaceRecognition).mockResolvedValueOnce(undefined);
    const response = await server.inject({
      method: "POST",
      url: "/trigger",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "accepted" });
    expect(startFaceRecognition).toHaveBeenCalledExactlyOnceWith();
  });

  test("POST /trigger エンドポイントでエラーが発生しても202を返す", async () => {
    vi.mocked(startFaceRecognition).mockRejectedValueOnce(
      new Error("Test error"),
    );
    const response = await server.inject({
      method: "POST",
      url: "/trigger",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "accepted" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("[RTSP] Face recognition failed:"),
      expect.any(Error),
    );
  });
});
