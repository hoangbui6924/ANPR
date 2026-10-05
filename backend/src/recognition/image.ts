// Image -> tensor helpers for the YOLO plate detector (docs 6.2)
import sharp from "sharp";
import ort from "onnxruntime-node";

export interface Decoded {
  data: Buffer; // RGB, HWC uint8
  width: number;
  height: number;
}

/** Read any input, apply EXIF orientation, return raw RGB */
export async function decode(input: Buffer | string): Promise<Decoded> {
  const { data, info } = await sharp(input).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Maps model-space coordinates back to the original image */
export interface Mapping {
  sx: number;
  sy: number;
  padX: number;
  padY: number;
}

/**
 * "stretch": resize straight to size×size (how the Roboflow training images were made)
 * "letterbox": keep aspect ratio, pad with gray 114 (docs 6.2)
 */
export type ResizeMode = "stretch" | "letterbox";

export async function toTensor(img: Decoded, size: number, mode: ResizeMode): Promise<{ tensor: ort.Tensor; map: Mapping }> {
  const src = sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });
  let data: Buffer;
  let map: Mapping;
  if (mode === "stretch") {
    data = await src.resize(size, size, { fit: "fill" }).raw().toBuffer();
    map = { sx: size / img.width, sy: size / img.height, padX: 0, padY: 0 };
  } else {
    const scale = Math.min(size / img.width, size / img.height);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const padX = Math.floor((size - w) / 2), padY = Math.floor((size - h) / 2);
    data = await src
      .resize(w, h, { fit: "fill" })
      .extend({ top: padY, bottom: size - h - padY, left: padX, right: size - w - padX, background: { r: 114, g: 114, b: 114 } })
      .raw()
      .toBuffer();
    map = { sx: scale, sy: scale, padX, padY };
  }
  // HWC uint8 -> CHW float32 / 255
  const area = size * size, f = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    f[i] = data[i * 3] / 255;
    f[i + area] = data[i * 3 + 1] / 255;
    f[i + 2 * area] = data[i * 3 + 2] / 255;
  }
  return { tensor: new ort.Tensor("float32", f, [1, 3, size, size]), map };
}
