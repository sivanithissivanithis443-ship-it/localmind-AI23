import { createWorker } from 'tesseract.js';
import { ImageAttachment } from '../types';

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export class VisionService {
  static validateImageFile(file: File): void {
    const type = (file.type || '').toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.includes(type)) {
      const ext = file.name.split('.').pop()?.toUpperCase() || 'unknown';
      throw new Error(
        `Unsupported image format (${type || ext}). Please upload a PNG, JPG/JPEG, or WEBP photograph.`
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `Image file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum supported size is 15 MB.`
      );
    }
  }

  static async processFileToAttachment(file: File): Promise<ImageAttachment> {
    this.validateImageFile(file);

    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Failed to read the selected image file.'));
      reader.readAsDataURL(file);
    });

    return this.resizeDataUrlToAttachment(rawDataUrl, file.name, file.type);
  }

  static async captureVideoFrame(video: HTMLVideoElement): Promise<ImageAttachment> {
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('Camera stream is not ready yet. Please wait a moment before capturing.');
    }

    const canvas = document.createElement('canvas');
    const maxDim = 1280;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to initialize local canvas for camera capture.');
    }
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const approxBytes = Math.round((dataUrl.length * 3) / 4);

    return {
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      dataUrl,
      mimeType: 'image/jpeg',
      fileName: `camera_capture_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.jpg`,
      width,
      height,
      sizeBytes: approxBytes,
    };
  }

  private static async resizeDataUrlToAttachment(
    dataUrl: string,
    fileName: string,
    mimeType: string
  ): Promise<ImageAttachment> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error('Could not decode this image. The file may be corrupted or unsupported.'));
      image.src = dataUrl;
    });

    const maxDim = 1280;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas rendering context is unavailable.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const outputMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    const resizedUrl = canvas.toDataURL(outputMime, 0.9);
    const approxBytes = Math.round((resizedUrl.length * 3) / 4);

    return {
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      dataUrl: resizedUrl,
      mimeType: outputMime,
      fileName,
      width,
      height,
      sizeBytes: approxBytes,
    };
  }

  // Runs genuine local browser OCR using Tesseract.js (WASM)
  static async runLocalOCR(
    imageDataUrl: string,
    onProgress?: (statusText: string, progress: number) => void
  ): Promise<{ text: string; confidence: number }> {
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      onProgress?.('Initializing local OCR engine...', 0.1);
      worker = await createWorker('eng', 1, {
        logger: (m) => {
          if (m.status && typeof m.progress === 'number') {
            onProgress?.(`OCR: ${m.status}`, m.progress);
          }
        },
      });

      const result = await worker.recognize(imageDataUrl);
      const cleanedText = (result.data.text || '').trim();
      const confidence = Number(result.data.confidence || 0);

      return {
        text: cleanedText,
        confidence,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error(
          'Local OCR language data is not cached yet and your browser is currently offline. Connect briefly once to run OCR, or type the question text directly.'
        );
      }
      throw new Error(`Local OCR image extraction failed: ${message}`);
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          // ignore
        }
      }
    }
  }
}
