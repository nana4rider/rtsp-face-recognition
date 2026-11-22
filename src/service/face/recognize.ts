import env from "@/env";
import logger from "@/logger";
import {
  RekognitionClient,
  SearchUsersByImageCommand,
} from "@aws-sdk/client-rekognition";

const rekognition = new RekognitionClient();

export type RecognizeResult =
  | { status: "matched"; userId: string; similarity: number }
  | { status: "below_threshold"; userId: string; similarity: number }
  | { status: "not_found" };

export default async function recognizeFace(
  imageBuffer: Buffer,
): Promise<RecognizeResult> {
  logger.info("[Rekognition] 開始");

  const command = new SearchUsersByImageCommand({
    CollectionId: env.AWS_REKOGNITION_COLLECTION_ID,
    Image: { Bytes: imageBuffer },
    MaxUsers: 1,
  });

  const result = await rekognition.send(command);

  const { UserMatches: matches } = result;

  const user = matches ? matches.shift() : undefined;
  if (!user?.User?.UserId) {
    logger.info("[Rekognition] 登録されていない");
    return { status: "not_found" };
  }

  const similarity = user.Similarity;

  if (
    similarity === undefined ||
    (env.FACE_MATCH_THRESHOLD && env.FACE_MATCH_THRESHOLD > similarity)
  ) {
    if (similarity === undefined) return { status: "not_found" };
    logger.info("[Rekognition] 検出されているが閾値を下回っている");
    return { status: "below_threshold", userId: user.User.UserId, similarity };
  }

  return {
    status: "matched",
    userId: user.User.UserId,
    similarity,
  };
}
