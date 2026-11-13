import { cleanEnv, makeValidator, num, port, str, url } from "envalid";

/* v8 ignore next */
const rtspUrl = makeValidator<string>((value) => {
  const parsed = new URL(value);
  if (!["rtsp:", "rtsps:"].includes(parsed.protocol)) {
    throw new Error("RTSP_URL must use rtsp or rtsps");
  }
  return value;
});

const env = cleanEnv(process.env, {
  AWS_REKOGNITION_COLLECTION_ID: str({
    desc: "RekognitionのコレクションID",
    testDefault: "test-collection-id",
  }),
  FACE_MATCH_THRESHOLD: num({
    desc: "https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/rekognition/command/SearchFacesByImageCommand/",
    default: undefined,
    testDefault: 95,
  }),
  LOG_LEVEL: str({
    desc: "ログレベル",
    default: "info",
    testDefault: "debug",
  }),
  PORT: port({
    desc: "HTTPサーバーのポート",
    default: 3000,
    testDefault: 0,
  }),
  RTSP_URL: rtspUrl({
    desc: "画像取得元のRTSPストリームURL",
    example: "rtsp://camera.local/stream",
    testDefault: "rtsp://camera.local/stream",
  }),
  FACE_DETECTOR_API: url({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect",
    example: "http://face-detector.local",
    testDefault: "http://face-detector.local",
  }),
  DETECT_MIN_SIZE: num({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect minSize + padding * 2 >= 80px でないとRekognitionが受け付けない",
    default: 40,
  }),
  DETECT_MAX_SIZE: num({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect",
    default: undefined,
  }),
  DETECT_PADDING: num({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect",
    default: 20,
  }),
  DETECT_START_X: num({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect",
    default: undefined,
  }),
  DETECT_START_Y: num({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect",
    default: undefined,
  }),
  DETECT_END_X: num({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect",
    default: undefined,
  }),
  DETECT_END_Y: num({
    desc: "https://nana4rider.github.io/openapi-ui/?face-detector#/default/post_detect",
    default: undefined,
  }),
  WEBHOOK: url({
    desc: "顔検出・認識結果を通知するWebhook URL",
    example: "http://webhool.local",
    testDefault: "http://webhool.local",
  }),
  DETECT_TIMEOUT: num({
    desc: "RTSPストリームの取得を開始してから自動終了するまでの時間",
    default: 15000,
    testDefault: 500,
  }),
  RECOGNITION_FACE_COUNT: num({
    desc: "顔認識APIに渡す顔の数",
    default: 3,
  }),
  RECOGNITION_MAX_RETRIES: num({
    desc: "初回の認識に加えて許可するリトライ回数",
    default: 3,
  }),
});

export default env;
