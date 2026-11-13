import { composeImages } from "@/util/imageUtil";
import sharp from "sharp";

async function createJpeg(width: number, height: number, color: string) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .jpeg()
    .toBuffer();
}

describe("composeImages", () => {
  test("空の画像リストを渡すと空のバッファを返す", async () => {
    const result = await composeImages([]);
    expect(result).toEqual(Buffer.alloc(0));
  });

  test("1つの画像バッファをそのまま返す", async () => {
    const buffer = await createJpeg(140, 140, "red");
    const result = await composeImages([buffer]);
    expect(result).toBe(buffer);
  });

  test("複数の画像を横に結合してJPEGを返す", async () => {
    const buffers = [
      await createJpeg(140, 140, "red"),
      await createJpeg(140, 140, "blue"),
      await createJpeg(140, 140, "green"),
    ];

    const result = await composeImages(buffers);
    const metadata = await sharp(result).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(420);
    expect(metadata.height).toBe(140);
  });

  test("異なる高さの画像は上揃えで最大高さに合わせる", async () => {
    const result = await composeImages([
      await createJpeg(100, 80, "red"),
      await createJpeg(140, 120, "blue"),
    ]);
    const metadata = await sharp(result).metadata();

    expect(metadata.width).toBe(240);
    expect(metadata.height).toBe(120);
  });

  test("不正な画像バッファはエラーになる", async () => {
    await expect(
      composeImages([Buffer.from("invalid-1"), Buffer.from("invalid-2")]),
    ).rejects.toThrow();
  });
});
