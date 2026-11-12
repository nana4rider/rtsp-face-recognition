# RTSP Face Recognition

[![License: ISC](https://img.shields.io/github/license/nana4rider/rtsp-face-recognition)](LICENSE)
![GitHub Actions Test](https://github.com/nana4rider/rtsp-face-recognition/actions/workflows/test.yml/badge.svg)
![GitHub Actions Release](https://github.com/nana4rider/rtsp-face-recognition/actions/workflows/release.yml/badge.svg)

## 概要

RTSPストリームから画像を取得して顔認識し、Webhookで結果を通知するアプリケーションです。

## フローチャート

```mermaid
graph TD
    start(Webhook受信) --> startStream[RTSPストリーム接続]
    startStream --> detectFace[画像を解析し顔を検出]

    %% 必要な顔画像数に達するまでのループ
    detectFace --> faceCount{顔画像数が必要数以上か?}
    faceCount -->|No| waitAndRetry[再試行: 画像を取得]
    waitAndRetry --> detectFace
    faceCount -->|Yes| composeImages[画像を合成]

    %% Recognition
    composeImages --> sendToRecognition[Amazon Recognitionで顔認識]
    matched -->|Yes| notifyWebhook[Webhookで一致したIDを通知]
    notifyWebhook --> stopStream[ストリーミング終了]

    %% Recognition失敗時の処理
    sendToRecognition --> matched{顔一致あり?}
    matched -->|No| retry{リトライ可能?}
    retry -->|Yes| clearFace[顔画像を全てクリア]
    clearFace --> detectFace
    retry -->|No| stopStream

    %% タイムアウト処理
    startStream --> timeout[タイムアウト]
    timeout --> stopStream
```

- AWSのコストを抑えるためにFace Detectorを使ってローカルでざっくり検出させています
- 閾値未満と顔見検出はストリーミング開始直後の荒い画像が原因の可能性が高いのでリトライしています

## 使い方

### 設定

`.env` に `RTSP_URL`（RTSP/RTSPS URL）と `WEBHOOK` を設定します。RTSP映像はFFmpegでJPEGフレームへ変換します（Dockerイメージには同梱済みです）。外部から起動する受信用エンドポイントは `POST /trigger` です。リクエストを受け付けるとすぐ `202 Accepted` を返し、指定したストリームから画像を取得して認識処理を開始します。

### Native

```sh
npm install
npm run build
node --env-file=.env dist/index
```

### Docker

```sh
# --net=hostの方が安定する
docker run -d \
  --net=host \
  --name rtsp-face-recognition \
  -p 3000:3000 \
  --env-file .env \
  --restart always \
  ghcr.io/nana4rider/rtsp-face-recognition:latest
```

必要な環境変数については[こちら](src/env.ts)をご確認ください。

## リンク

- [Face Detector](https://github.com/nana4rider/face-detector)
- [Amazon Rekognition API SearchFacesByImageCommand](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/rekognition/command/SearchFacesByImageCommand/)

## ドキュメント

- [API Document](https://nana4rider.github.io/openapi-ui/?rtsp-face-recognition)
