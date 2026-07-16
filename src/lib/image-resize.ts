/**
 * Client-side (browser) image downscale + center-crop to a square JPEG.
 * Used by the avatar upload so we never ship a server-side image library:
 * the browser crops/resizes on a <canvas> and we upload the small result.
 */
export async function resizeImageToSquareJpeg(
  file: File,
  size = 256,
  quality = 0.85,
): Promise<Blob> {
  const bitmap = await loadBitmap(file)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas not supported")

    // Cover-crop: scale the shorter side to `size`, center the overflow.
    const scale = Math.max(size / bitmap.width, size / bitmap.height)
    const drawW = bitmap.width * scale
    const drawH = bitmap.height * scale
    const dx = (size - drawW) / 2
    const dy = (size - drawH) / 2
    ctx.drawImage(bitmap, dx, dy, drawW, drawH)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image encode failed"))),
        "image/jpeg",
        quality,
      )
    })
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close()
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file)
  }
  // Safari fallback: decode via an <img> + object URL.
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("Couldn't decode image"))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
