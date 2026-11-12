import env from "@/env";
import logger from "@/logger";
import detectFace from "@/service/face/detect";
import type { RecognizeResult } from "@/service/face/recognize";
import recognizeFace from "@/service/face/recognize";
import triggerWebhook from "@/service/webhook";
import { composeImages } from "@/util/imageUtil";
import { spawn, type ChildProcess } from "node:child_process";
import dayjs from "dayjs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

let activeRecognition: Promise<void> | undefined;

export function startFaceRecognition(): Promise<void> {
  if (activeRecognition) return activeRecognition;
  logger.info("[RTSP] Recognition started");
  activeRecognition = recognizeFromStream().finally(() => {
    activeRecognition = undefined;
  });
  return activeRecognition;
}

async function recognizeFromStream() {
  const streamUrl = env.RTSP_URL;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, env.DETECT_TIMEOUT);
  const faceImageBuffers: Buffer[] = [];
  const debugDir = logger.isDebugEnabled()
    ? dayjs().format("YYYY-MM-DD-HH-mm-ss")
    : undefined;
  try {
    if (debugDir) {
      await mkdir(path.join("snapshot", debugDir), { recursive: true });
    }
    logger.info("[RTSP] Connecting");
    const frames = new LatestFrameQueue();
    const child: ChildProcess = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        streamUrl,
        "-an",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stderr?.resume();
    void readJpegFrames(child.stdout!, controller.signal, frames);
    const stopProcess = () => child.kill("SIGTERM");
    controller.signal.addEventListener("abort", stopProcess, { once: true });
    child.on("error", (err) =>
      frames.finish(
        new Error(`FFmpeg failed: ${describeError(err)}`, { cause: err }),
      ),
    );
    child.on("close", (code) => {
      frames.finish(
        code === 0 || controller.signal.aborted
          ? undefined
          : new Error(`FFmpeg exited with code ${code}`),
      );
    });
    try {
      await processFrames(
        frames,
        faceImageBuffers,
        debugDir,
        controller.signal,
      );
    } finally {
      controller.signal.removeEventListener("abort", stopProcess);
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  } catch (err) {
    if (!controller.signal.aborted) throw err;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (timedOut) logger.info("[RTSP] Recognition timed out");
  }
}

async function processFrames(
  frames: LatestFrameQueue,
  faceImageBuffers: Buffer[],
  debugDir: string | undefined,
  signal: AbortSignal,
) {
  let retryCount = 0;
  for await (const imageBuffer of frames) {
    if (signal.aborted) break;
    if (faceImageBuffers.length >= env.RECOGNITION_FACE_COUNT) continue;

    logger.info(`receive buffer length: ${imageBuffer.length}`);
    const faceBuffer = await detectFace(imageBuffer);
    void writeDebugFile(imageBuffer, debugDir, faceBuffer ? "ok" : "ng");
    if (!faceBuffer) continue;
    faceImageBuffers.push(faceBuffer);
    logger.info(`[RTSP] ${faceImageBuffers.length} faces detected.`);

    if (faceImageBuffers.length !== env.RECOGNITION_FACE_COUNT) continue;
    if (retryCount === 0) {
      void triggerWebhook({
        type: "detect",
        image: imageBuffer.toString("base64"),
      });
    }

    const composite = await composeImages(faceImageBuffers);
    void writeDebugFile(composite, debugDir, "comp");
    let result: RecognizeResult | undefined;
    try {
      result = await recognizeFace(composite);
    } catch (err) {
      logger.warn("[Recognition] Failed:", err);
    }
    if (result) {
      logger.info(`[Recognition] recognize: ${JSON.stringify(result)}`);
      await triggerWebhook({ type: "recognition", result });
      return;
    }

    retryCount++;
    if (retryCount > env.RECOGNITION_MAX_RETRIES) return;
    faceImageBuffers.length = 0;
  }
}

async function readJpegFrames(
  stream: NodeJS.ReadableStream,
  signal: AbortSignal,
  frames: LatestFrameQueue,
) {
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      if (signal.aborted) break;
      pending = Buffer.concat([pending, Buffer.from(chunk as Uint8Array)]);
      while (true) {
        const start = pending.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) {
          pending = pending.subarray(Math.max(0, pending.length - 1));
          break;
        }
        const end = pending.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (end < 0) {
          pending = pending.subarray(start);
          break;
        }
        const jpeg = pending.subarray(start, end + 2);
        frames.push(jpeg);
        pending = pending.subarray(end + 2);
      }
    }
    frames.finish();
  } catch (err) {
    frames.finish(err);
  }
}

class LatestFrameQueue implements AsyncIterableIterator<Buffer> {
  private latestFrame: Buffer | undefined;
  private wakeReader: (() => void) | undefined;
  private ended = false;
  private failure: Error | undefined;

  push(frame: Buffer) {
    this.latestFrame = frame;
    this.wakeReader?.();
    this.wakeReader = undefined;
  }

  finish(err?: unknown) {
    this.ended = true;
    if (err !== undefined) {
      this.failure =
        err instanceof Error
          ? err
          : new Error("RTSP stream reading failed", { cause: err });
    }
    this.wakeReader?.();
    this.wakeReader = undefined;
  }

  next(): Promise<IteratorResult<Buffer>> {
    if (this.latestFrame) {
      const frame = this.latestFrame;
      this.latestFrame = undefined;
      return Promise.resolve({ value: frame, done: false });
    }
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ value: undefined, done: true });

    return new Promise((resolve, reject) => {
      this.wakeReader = () => {
        void this.next().then(resolve, reject);
      };
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Buffer> {
    return this;
  }
}

function describeError(err: unknown): string {
  const messages: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    const code =
      "code" in current && typeof current.code === "string"
        ? ` (${current.code})`
        : "";
    messages.push(`${current.name}: ${current.message}${code}`);
    current = current.cause;
  }
  return messages.join(" <- ") || "Unknown error";
}

async function writeDebugFile(
  imageBuffer: Buffer,
  targetDir: string | undefined,
  suffix: string,
) {
  if (targetDir === undefined) return;
  const timestamp = dayjs().format("YYYY-MM-DD-HH-mm-ss-SSS");
  await writeFile(
    path.join("snapshot", targetDir, `${timestamp}_${suffix}.jpg`),
    imageBuffer,
  );
}
