import assert from "node:assert/strict";
import { boundedImageSize, encodedImageSize } from "../utils/imageDimensions";

const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47]);
new DataView(png.buffer).setUint32(16, 4_000);
new DataView(png.buffer).setUint32(20, 3_000);

const jpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  0x0b, 0xb8,
  0x0f, 0xa0,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
]);

const webp = new Uint8Array(30);
webp.set(new TextEncoder().encode("RIFF"), 0);
webp.set(new TextEncoder().encode("WEBP"), 8);
webp.set(new TextEncoder().encode("VP8X"), 12);
webp.set([0x9f, 0x0f, 0x00, 0xb7, 0x0b, 0x00], 24);

assert.deepEqual(await encodedImageSize(new File([png], "large.png", { type: "image/png" })), { width: 4_000, height: 3_000 });
assert.deepEqual(await encodedImageSize(new File([jpeg], "large.jpg", { type: "image/jpeg" })), { width: 4_000, height: 3_000 });
assert.deepEqual(await encodedImageSize(new File([webp], "large.webp", { type: "image/webp" })), { width: 4_000, height: 3_000 });
const bounded = boundedImageSize(4_000, 3_000, 1_024, 1_000_000);
assert.equal(bounded.width * bounded.height <= 1_000_000, true);
assert.equal(Math.max(bounded.width, bounded.height) <= 1_024, true);
console.log("image dimension contracts passed");
