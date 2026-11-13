import env from "@/env";
import logger from "@/logger";
import detectFace from "@/service/face/detect";
import recognizeFace from "@/service/face/recognize";
import { startFaceRecognition } from "@/service/rtsp";
import triggerWebhook from "@/service/webhook";
import { composeImages } from "@/util/imageUtil";
import { spawn } from "node:child_process";
import { PassThrough } from "stream";
import { mkdir, writeFile } from "fs/promises";
import type { Writable } from "type-fest";

const writableEnv: Writable<typeof env> = env;
const spawnMock = vi.mocked(spawn);

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("@/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    isDebugEnabled: vi.fn(),
  },
}));
vi.mock("@/service/face/detect", () => ({ default: vi.fn() }));
vi.mock("@/service/face/recognize", () => ({ default: vi.fn() }));
vi.mock("@/service/webhook", () => ({ default: vi.fn() }));
vi.mock("@/util/imageUtil", () => ({ composeImages: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

class FakeChild {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  kill = vi.fn(() => {
    if (this.exitCode === null) this.close(0);
    return true;
  });
  private listeners = new Map<string, Array<(...args: never[]) => void>>();

  on(event: string, listener: (...args: never[]) => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, ...args: never[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
    return true;
  }

  close(code: number) {
    this.exitCode = code;
    this.stdout.end();
    queueMicrotask(() => this.emit("close", code as never));
  }
}

let child: FakeChild;

function jpeg(value: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from(value),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function sendFrame(value: string) {
  child.stdout.write(jpeg(value));
}

async function settleRecognition() {
  const recognition = startFaceRecognition();
  for (
    let attempt = 0;
    attempt < 20 && spawnMock.mock.calls.length === 0;
    attempt++
  ) {
    await Promise.resolve();
  }
  return { recognition };
}

describe("startFaceRecognition (RTSP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    writableEnv.RTSP_URL = "rtsp://camera.local/stream";
    writableEnv.DETECT_TIMEOUT = 10_000;
    writableEnv.RECOGNITION_FACE_COUNT = 1;
    writableEnv.RECOGNITION_MAX_RETRIES = 2;
    child = new FakeChild();
    spawnMock.mockReturnValue(child as never);
    vi.mocked(logger.isDebugEnabled).mockReturnValue(false);
    vi.mocked(detectFace).mockImplementation((image) =>
      Promise.resolve(Buffer.from(`face:${image.toString()}`)),
    );
    vi.mocked(recognizeFace).mockResolvedValue({ status: "not_found" });
    vi.mocked(composeImages).mockImplementation((images) =>
      Promise.resolve(Buffer.concat(images)),
    );
    vi.mocked(triggerWebhook).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  test("FFmpegを起動し、RTSP URLをログに出さず認識結果を通知する", async () => {
    const result = {
      status: "matched" as const,
      userId: "person-1",
      similarity: 98,
    };
    vi.mocked(recognizeFace).mockResolvedValue(result);

    const { recognition } = await settleRecognition();
    sendFrame("image-1");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledOnce());
    await recognition;

    expect(spawnMock).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-i", env.RTSP_URL]),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(logger.info).toHaveBeenCalledWith("[RTSP] Connecting");
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining(env.RTSP_URL),
    );
    expect(detectFace).toHaveBeenCalledWith(jpeg("image-1"));
    expect(triggerWebhook).toHaveBeenCalledWith({
      type: "recognition",
      result,
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("認識中に再度実行された場合、実行中のPromiseを返す", async () => {
    const recognition = startFaceRecognition();
    expect(startFaceRecognition()).toBe(recognition);
    await Promise.resolve();
    child.close(0);
    await recognition;
  });

  test("顔検出中に届いたフレームは最新の1枚だけ処理する", async () => {
    const detection = deferred<Buffer | undefined>();
    vi.mocked(detectFace)
      .mockImplementationOnce(() => detection.promise)
      .mockImplementation((image) => Promise.resolve(Buffer.from(image)));
    vi.mocked(recognizeFace).mockResolvedValueOnce({ status: "not_found" });

    const { recognition } = await settleRecognition();
    sendFrame("first");
    await vi.waitFor(() => expect(detectFace).toHaveBeenCalledOnce());
    sendFrame("stale");
    sendFrame("latest");
    await new Promise((resolve) => setTimeout(resolve, 10));
    detection.resolve(undefined);
    await vi.waitFor(() => expect(detectFace).toHaveBeenCalledTimes(2));
    child.close(0);
    await recognition;

    expect(
      vi.mocked(detectFace).mock.calls.map(([frame]) => frame.toString()),
    ).toEqual([jpeg("first").toString(), jpeg("latest").toString()]);
  });

  test("JPEGマーカーがチャンクをまたぐ場合もフレームを読み取る", async () => {
    const { recognition } = await settleRecognition();
    child.stdout.write(Buffer.from([0x10, 0xff]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    child.stdout.write(Buffer.from([0xd8, 0x41, 0xff]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    child.stdout.write(Buffer.from([0xd9]));
    await vi.waitFor(() => expect(detectFace).toHaveBeenCalledOnce());
    child.close(0);
    await recognition;
    expect(detectFace).toHaveBeenCalledWith(jpeg("A"));
  });

  test("FFmpegがフレームを出力せず終了した場合、正常に完了する", async () => {
    const { recognition } = await settleRecognition();
    child.close(0);
    await recognition;
    expect(detectFace).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  test("FFmpegが異常終了した場合、例外を投げる", async () => {
    const { recognition } = await settleRecognition();
    child.close(2);
    await expect(recognition).rejects.toThrow("FFmpeg exited with code 2");
  });

  test("FFmpegの起動エラーに原因とエラーコードを含める", async () => {
    const { recognition } = await settleRecognition();
    const cause = Object.assign(new Error("socket refused"), {
      code: "ECONNREFUSED",
    });
    child.emit("error", new Error("spawn failed", { cause }) as never);
    await expect(recognition).rejects.toThrow(
      /FFmpeg failed: Error: spawn failed <- Error: socket refused \(ECONNREFUSED\)/,
    );
  });

  test("FFmpegのエラーが不明な場合、代替メッセージを使う", async () => {
    const { recognition } = await settleRecognition();
    child.emit("error", undefined as never);
    await expect(recognition).rejects.toThrow("FFmpeg failed: Unknown error");
  });

  test("認識に失敗した場合、再試行後の一致結果を通知する", async () => {
    writableEnv.RECOGNITION_MAX_RETRIES = 1;
    const result = {
      status: "matched" as const,
      userId: "retry-person",
      similarity: 92,
    };
    vi.mocked(recognizeFace)
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce(result);

    const { recognition } = await settleRecognition();
    sendFrame("first-attempt");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledOnce());
    sendFrame("retry-attempt");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledTimes(2));
    await recognition;

    expect(logger.warn).toHaveBeenCalledWith(
      "[Recognition] Failed:",
      expect.any(Error),
    );
    expect(triggerWebhook).toHaveBeenCalledTimes(2);
    expect(triggerWebhook).toHaveBeenNthCalledWith(1, {
      type: "detect",
      image: jpeg("first-attempt").toString("base64"),
    });
    expect(triggerWebhook).toHaveBeenLastCalledWith({
      type: "recognition",
      result,
    });
  });

  test("閾値未満の場合、リトライ回数を増やさず次の画像で再認識する", async () => {
    writableEnv.RECOGNITION_MAX_RETRIES = 1;
    vi.mocked(recognizeFace)
      .mockResolvedValueOnce({
        status: "below_threshold",
        userId: "low-similarity-person",
        similarity: 80,
      })
      .mockResolvedValueOnce({ status: "not_found" })
      .mockResolvedValueOnce({ status: "not_found" });

    const { recognition } = await settleRecognition();
    sendFrame("below-threshold");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledOnce());
    sendFrame("not-found-retry");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledTimes(2));
    sendFrame("retry-limit");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledTimes(3));
    sendFrame("must-not-run");
    child.close(0);
    await recognition;

    expect(recognizeFace).toHaveBeenCalledTimes(3);
    expect(triggerWebhook).toHaveBeenCalledTimes(1);
    expect(triggerWebhook).toHaveBeenCalledWith({
      type: "detect",
      image: jpeg("below-threshold").toString("base64"),
    });
  });

  test("初回認識後、設定した回数だけ再試行する", async () => {
    writableEnv.RECOGNITION_MAX_RETRIES = 1;
    const { recognition } = await settleRecognition();
    sendFrame("attempt-1");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledTimes(1));
    sendFrame("attempt-2");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledTimes(2));
    sendFrame("must-not-run");
    child.close(0);
    await recognition;

    expect(recognizeFace).toHaveBeenCalledTimes(2);
  });

  test("設定した枚数の顔画像を集めてから認識する", async () => {
    writableEnv.RECOGNITION_FACE_COUNT = 2;
    vi.mocked(detectFace)
      .mockResolvedValueOnce(Buffer.from("face-one"))
      .mockResolvedValueOnce(Buffer.from("face-two"));
    vi.mocked(recognizeFace).mockResolvedValue({
      status: "matched",
      userId: "two-face-person",
      similarity: 95,
    });

    const { recognition } = await settleRecognition();
    sendFrame("one");
    await vi.waitFor(() => expect(detectFace).toHaveBeenCalledOnce());
    sendFrame("two");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledOnce());
    await recognition;

    expect(composeImages).toHaveBeenCalledWith([
      Buffer.from("face-one"),
      Buffer.from("face-two"),
    ]);
  });

  test("顔認識に必要な枚数が0の場合、フレームを処理しない", async () => {
    writableEnv.RECOGNITION_FACE_COUNT = 0;
    const { recognition } = await settleRecognition();
    sendFrame("ignored");
    await new Promise((resolve) => setImmediate(resolve));
    child.close(0);
    await recognition;
    expect(detectFace).not.toHaveBeenCalled();
  });

  test("顔が検出されない場合、認識処理を実行しない", async () => {
    writableEnv.RECOGNITION_MAX_RETRIES = 0;
    vi.mocked(detectFace).mockResolvedValue(undefined);
    const { recognition } = await settleRecognition();
    sendFrame("no-face");
    await vi.waitFor(() => expect(detectFace).toHaveBeenCalledOnce());
    child.close(0);
    await recognition;
    expect(recognizeFace).not.toHaveBeenCalled();
    expect(triggerWebhook).not.toHaveBeenCalled();
  });

  test("認識がタイムアウトした場合、キュー内のフレームを処理しない", async () => {
    writableEnv.DETECT_TIMEOUT = 50;
    const detection = deferred<Buffer | undefined>();
    vi.mocked(detectFace).mockReturnValueOnce(detection.promise);
    child.kill.mockImplementation(() => {
      child.exitCode = 0;
      child.stdout.write(jpeg("arrived-after-abort"));
      child.close(0);
      return true;
    });
    const { recognition } = await settleRecognition();
    child.stdout.write(Buffer.concat([jpeg("processing"), jpeg("queued")]));
    await vi.waitFor(() => expect(detectFace).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 60));
    detection.resolve(undefined);
    await recognition;
    expect(detectFace).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("[RTSP] Recognition timed out");
  });

  test("タイムアウト後に発生したストリームエラーを無視する", async () => {
    vi.useFakeTimers();
    writableEnv.DETECT_TIMEOUT = 100;
    child.kill.mockImplementation(() => {
      child.exitCode = 0;
      child.emit("error", new Error("closed by abort") as never);
      child.emit("close", 0 as never);
      return true;
    });
    const { recognition } = await settleRecognition();
    await vi.advanceTimersByTimeAsync(100);
    await recognition;
    expect(logger.info).toHaveBeenCalledWith("[RTSP] Recognition timed out");
  });

  test("ストリームエラーを伝播し、Error以外はErrorに変換する", async () => {
    const { recognition } = await settleRecognition();
    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.on("error", () => undefined);
    child.stdout.destroy(new Error("broken stdout"));
    await expect(recognition).rejects.toThrow("broken stdout");

    child = new FakeChild();
    spawnMock.mockReturnValueOnce(child as never);
    child.stdout.destroy("broken stdout" as never);
    await expect(startFaceRecognition()).rejects.toThrow(
      "RTSP stream reading failed",
    );
  });

  test("スナップショットディレクトリの作成に失敗した場合、例外を投げる", async () => {
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("snapshot unavailable"));
    vi.mocked(logger.isDebugEnabled).mockReturnValue(true);
    await expect(startFaceRecognition()).rejects.toThrow(
      "snapshot unavailable",
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test("デバッグモードの場合、フレーム画像と合成画像を保存する", async () => {
    vi.mocked(logger.isDebugEnabled).mockReturnValue(true);
    vi.mocked(recognizeFace).mockResolvedValue({
      status: "matched",
      userId: "debug-person",
      similarity: 99,
    });
    const { recognition } = await settleRecognition();
    sendFrame("debug-image");
    await vi.waitFor(() => expect(recognizeFace).toHaveBeenCalledOnce());
    await recognition;
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining("snapshot"), {
      recursive: true,
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
