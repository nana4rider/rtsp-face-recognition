import sharp from "sharp";

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
