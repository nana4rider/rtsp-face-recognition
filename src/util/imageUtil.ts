import sharp from "sharp";

const JPEG_START_MARKER = Buffer.from([0xff, 0xd8]);
const JPEG_END_MARKER = Buffer.from([0xff, 0xd9]);

export function createJpegFrameParser() {
  let pending = Buffer.alloc(0);

  return {
    push(chunk: Uint8Array): Buffer[] {
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      const frames: Buffer[] = [];

      while (true) {
        const start = pending.indexOf(JPEG_START_MARKER);
        if (start < 0) {
          pending = pending.subarray(Math.max(0, pending.length - 1));
          break;
        }

        const end = pending.indexOf(
          JPEG_END_MARKER,
          start + JPEG_START_MARKER.length,
        );
        if (end < 0) {
          pending = pending.subarray(start);
          break;
        }

        frames.push(pending.subarray(start, end + JPEG_END_MARKER.length));
        pending = pending.subarray(end + JPEG_END_MARKER.length);
      }

      return frames;
    },
  };
}

export async function composeImages(imageBuffers: Buffer[]): Promise<Buffer> {
  if (imageBuffers.length === 0) {
    return Buffer.alloc(0);
  } else if (imageBuffers.length === 1) {
    return imageBuffers[0];
  }

  const metadata = await Promise.all(
    imageBuffers.map((input) => sharp(input).metadata()),
  );
  const width = metadata.reduce((sum, { width }) => sum + width, 0);
  const height = Math.max(...metadata.map(({ height }) => height));

  let left = 0;
  const images = imageBuffers.map((input, index) => {
    const image = { input, left, top: 0 };
    left += metadata[index].width;
    return image;
  });

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(images)
    .jpeg()
    .toBuffer();
}
