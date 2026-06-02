import { md5 } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import { getStorageService } from '@/shared/services/storage';

const IMAGE_UPLOAD_MAX_FILES = 16;
const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
]);

const extFromMime = (mimeType: string) => {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[mimeType] || '';
};

export async function POST(req: Request) {
  try {
    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    console.info('[storage.upload-image] request', {
      userId: user.id,
      fileCount: files.length,
    });
    files.forEach((file, i) => {
      console.info(`[storage.upload-image] file ${i}`, {
        userId: user.id,
        name: file.name,
        type: file.type,
        size: file.size,
      });
    });

    if (!files || files.length === 0) {
      return respErr('No files provided');
    }

    if (files.length > IMAGE_UPLOAD_MAX_FILES) {
      return respErr(`Maximum ${IMAGE_UPLOAD_MAX_FILES} images allowed`);
    }

    const storageService = await getStorageService();
    const uploadResults = [];

    for (const file of files) {
      const mimeType = file.type.trim().toLowerCase();

      if (!IMAGE_UPLOAD_MIME_TYPES.has(mimeType)) {
        return respErr(`File ${file.name} has an unsupported image type`);
      }

      if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
        return respErr('Image file is too large. Max size is 10MB');
      }

      // Convert file to buffer
      const arrayBuffer = await file.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);

      const digest = md5(body);
      const ext = extFromMime(mimeType) || file.name.split('.').pop() || 'bin';
      const key = `${digest}.${ext}`;

      // If the same image already exists, reuse its URL to save storage space.
      // (Still depends on provider supporting signed HEAD + public url generation.)
      const exists = await storageService.exists({ key });
      if (exists) {
        const publicUrl = storageService.getPublicUrl({ key });
        if (publicUrl) {
          uploadResults.push({
            url: publicUrl,
            key,
            filename: file.name,
            deduped: true,
          });
          continue;
        }
      }

      // Upload to storage
      const result = await storageService.uploadFile({
        body,
        key: key,
        contentType: mimeType,
        disposition: 'inline',
      });

      if (!result.success) {
        console.error('[storage.upload-image] upload failed:', result.error);
        return respErr(result.error || 'Upload failed');
      }

      console.info('[storage.upload-image] upload success', {
        userId: user.id,
        key: result.key,
        url: result.url,
      });

      uploadResults.push({
        url: result.url,
        key: result.key,
        filename: file.name,
        deduped: false,
      });
    }

    console.info('[storage.upload-image] complete', {
      userId: user.id,
      count: uploadResults.length,
    });

    return respData({
      urls: uploadResults.map((r) => r.url),
      results: uploadResults,
    });
  } catch (e) {
    console.error('upload image failed:', e);
    return respErr('upload image failed');
  }
}
