export const maxImages = 4;
export const maxImageBytes = 5 * 1024 * 1024;
export const imageMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type ImageUpload = {
  name: string;
  mime: (typeof imageMimeTypes)[number];
  base64: string;
};
export type MessageImage = {
  id: string;
  name: string;
  mime: ImageUpload["mime"];
  size: number;
  width: number;
  height: number;
};
export const messageImageUrl = (messageId: string, imageId: string) =>
  `/api/messages/${encodeURIComponent(messageId)}/images/${encodeURIComponent(imageId)}`;
