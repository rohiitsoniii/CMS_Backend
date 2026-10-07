/**
 * Image Processing Utility
 * Handles image transformations, optimization, and metadata extraction
 * Uses Sharp library for high-performance image processing
 */

import { AppError } from '../middleware/errorHandler.js';

function getSharp(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('sharp');
  } catch {
    throw new AppError(
      'Image processing is unavailable: optional dependency "sharp" is not installed.',
      503,
      'SHARP_NOT_INSTALLED'
    );
  }
}

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;
  background?: string;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  colorSpace?: string;
  hasAlpha: boolean;
  orientation?: number;
  density?: number;
}

export interface TransformationResult {
  buffer: Buffer;
  metadata: ImageMetadata;
  size: number;
}

/**
 * Get image metadata
 */
export const getImageMetadata = async (input: Buffer | string): Promise<ImageMetadata> => {
  const image = getSharp()(input);
  const metadata = await image.metadata();

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || 'unknown',
    size: metadata.size || 0,
    colorSpace: metadata.space,
    hasAlpha: metadata.hasAlpha || false,
    orientation: metadata.orientation,
    density: metadata.density
  };
};

/**
 * Transform image (resize, convert format, optimize)
 */
export const transformImage = async (
  input: Buffer | string,
  options: ImageTransformOptions
): Promise<TransformationResult> => {
  let image = getSharp()(input);

  // Resize if dimensions provided
  if (options.width || options.height) {
    image = image.resize({
      width: options.width,
      height: options.height,
      fit: options.fit || 'cover',
      background: options.background || { r: 255, g: 255, b: 255, alpha: 0 }
    });
  }

  // Convert format and optimize
  const format = options.format || 'jpeg';
  const quality = options.quality || 80;

  switch (format) {
    case 'jpeg':
      image = image.jpeg({ quality, progressive: true, mozjpeg: true });
      break;
    case 'png':
      image = image.png({ quality, compressionLevel: 9, progressive: true });
      break;
    case 'webp':
      image = image.webp({ quality, effort: 6 });
      break;
    case 'avif':
      image = image.avif({ quality, effort: 6 });
      break;
  }

  // Get transformed buffer and metadata
  const buffer = await image.toBuffer();
  const metadata = await getSharp()(buffer).metadata();

  return {
    buffer,
    metadata: {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || format,
      size: buffer.length,
      colorSpace: metadata.space,
      hasAlpha: metadata.hasAlpha || false,
      orientation: metadata.orientation,
      density: metadata.density
    },
    size: buffer.length
  };
};

/**
 * Generate multiple transformations
 */
export const generateTransformations = async (
  input: Buffer | string,
  transformations: Array<{ name: string; options: ImageTransformOptions }>
): Promise<Array<{ name: string; result: TransformationResult }>> => {
  const results = await Promise.all(
    transformations.map(async ({ name, options }) => ({
      name,
      result: await transformImage(input, options)
    }))
  );

  return results;
};

/**
 * Generate standard transformations (thumbnail, medium, large)
 */
export const generateStandardTransformations = async (
  input: Buffer | string
): Promise<Array<{ name: string; result: TransformationResult }>> => {
  const transformations = [
    {
      name: 'thumbnail',
      options: {
        width: 150,
        height: 150,
        fit: 'cover' as const,
        format: 'webp' as const,
        quality: 80
      }
    },
    {
      name: 'small',
      options: {
        width: 400,
        height: 300,
        fit: 'inside' as const,
        format: 'webp' as const,
        quality: 85
      }
    },
    {
      name: 'medium',
      options: {
        width: 800,
        height: 600,
        fit: 'inside' as const,
        format: 'webp' as const,
        quality: 85
      }
    },
    {
      name: 'large',
      options: {
        width: 1920,
        height: 1080,
        fit: 'inside' as const,
        format: 'webp' as const,
        quality: 90
      }
    }
  ];

  return await generateTransformations(input, transformations);
};

/**
 * Optimize image (reduce file size without significant quality loss)
 */
export const optimizeImage = async (
  input: Buffer | string,
  targetFormat?: 'jpeg' | 'png' | 'webp' | 'avif'
): Promise<TransformationResult> => {
  const metadata = await getImageMetadata(input);
  const format = targetFormat || (metadata.format as any) || 'jpeg';

  return await transformImage(input, {
    format,
    quality: 85
  });
};

/**
 * Create thumbnail
 */
export const createThumbnail = async (
  input: Buffer | string,
  size: number = 150
): Promise<TransformationResult> => {
  return await transformImage(input, {
    width: size,
    height: size,
    fit: 'cover',
    format: 'webp',
    quality: 80
  });
};

/**
 * Crop image
 */
export const cropImage = async (
  input: Buffer | string,
  left: number,
  top: number,
  width: number,
  height: number
): Promise<TransformationResult> => {
  const buffer = await getSharp()(input)
    .extract({ left, top, width, height })
    .toBuffer();

  const metadata = await getSharp()(buffer).metadata();

  return {
    buffer,
    metadata: {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: buffer.length,
      colorSpace: metadata.space,
      hasAlpha: metadata.hasAlpha || false,
      orientation: metadata.orientation,
      density: metadata.density
    },
    size: buffer.length
  };
};

/**
 * Add watermark to image
 */
export const addWatermark = async (
  input: Buffer | string,
  watermarkPath: string,
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' = 'bottom-right',
  _opacity: number = 0.5
): Promise<TransformationResult> => {
  const watermark = await getSharp()(watermarkPath)
    .resize(200) // Resize watermark
    .toBuffer();

  const metadata = await getSharp()(input).metadata();
  const watermarkMeta = await getSharp()(watermark).metadata();

  let left = 0;
  let top = 0;

  // Calculate position
  switch (position) {
    case 'top-left':
      left = 10;
      top = 10;
      break;
    case 'top-right':
      left = (metadata.width || 0) - (watermarkMeta.width || 0) - 10;
      top = 10;
      break;
    case 'bottom-left':
      left = 10;
      top = (metadata.height || 0) - (watermarkMeta.height || 0) - 10;
      break;
    case 'bottom-right':
      left = (metadata.width || 0) - (watermarkMeta.width || 0) - 10;
      top = (metadata.height || 0) - (watermarkMeta.height || 0) - 10;
      break;
    case 'center':
      left = ((metadata.width || 0) - (watermarkMeta.width || 0)) / 2;
      top = ((metadata.height || 0) - (watermarkMeta.height || 0)) / 2;
      break;
  }

  const buffer = await getSharp()(input)
    .composite([
      {
        input: watermark,
        left: Math.round(left),
        top: Math.round(top),
        blend: 'over'
      }
    ])
    .toBuffer();

  const resultMetadata = await getSharp()(buffer).metadata();

  return {
    buffer,
    metadata: {
      width: resultMetadata.width || 0,
      height: resultMetadata.height || 0,
      format: resultMetadata.format || 'unknown',
      size: buffer.length,
      colorSpace: resultMetadata.space,
      hasAlpha: resultMetadata.hasAlpha || false,
      orientation: resultMetadata.orientation,
      density: resultMetadata.density
    },
    size: buffer.length
  };
};

/**
 * Convert image to grayscale
 */
export const convertToGrayscale = async (
  input: Buffer | string
): Promise<TransformationResult> => {
  const buffer = await getSharp()(input)
    .grayscale()
    .toBuffer();

  const metadata = await getSharp()(buffer).metadata();

  return {
    buffer,
    metadata: {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: buffer.length,
      colorSpace: metadata.space,
      hasAlpha: metadata.hasAlpha || false,
      orientation: metadata.orientation,
      density: metadata.density
    },
    size: buffer.length
  };
};

/**
 * Blur image
 */
export const blurImage = async (
  input: Buffer | string,
  sigma: number = 10
): Promise<TransformationResult> => {
  const buffer = await getSharp()(input)
    .blur(sigma)
    .toBuffer();

  const metadata = await getSharp()(buffer).metadata();

  return {
    buffer,
    metadata: {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: buffer.length,
      colorSpace: metadata.space,
      hasAlpha: metadata.hasAlpha || false,
      orientation: metadata.orientation,
      density: metadata.density
    },
    size: buffer.length
  };
};

/**
 * Validate image file
 */
export const validateImage = async (input: Buffer | string): Promise<boolean> => {
  try {
    await getSharp()(input).metadata();
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Get dominant color from image
 */
export const getDominantColor = async (input: Buffer | string): Promise<string> => {
  const { dominant } = await getSharp()(input)
    .resize(1, 1)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const r = dominant.data[0];
  const g = dominant.data[1];
  const b = dominant.data[2];

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

/**
 * Calculate image file size reduction percentage
 */
export const calculateSizeReduction = (originalSize: number, newSize: number): number => {
  return Math.round(((originalSize - newSize) / originalSize) * 100);
};

// ---------------------------------------------------------------------------
// Named responsive variants served on demand via GET /api/v1/media/:id
// e.g. /api/v1/media/<id>?variant=thumb  or  ?w=480&h=320&fit=cover
// ---------------------------------------------------------------------------

export const IMAGE_VARIANTS = {
  thumb: { width: 150, height: 150, fit: 'cover' as const },
  small: { width: 480, fit: 'inside' as const },
  medium: { width: 1024, fit: 'inside' as const },
  large: { width: 1920, fit: 'inside' as const },
};

export type ImageVariantName = keyof typeof IMAGE_VARIANTS;

const MAX_VARIANT_DIMENSION = 2048;
const VALID_FITS: ImageTransformOptions['fit'][] = ['cover', 'contain', 'fill', 'inside', 'outside'];

/**
 * Resolve ?variant= / ?w=&h=&fit= query params to transform options.
 * Returns null when no transformation was requested. Throws AppError(400)
 * for invalid values so callers get a clean client error.
 */
export const resolveImageVariant = (query: Record<string, unknown>): ImageTransformOptions | null => {
  const { variant, w, h, fit } = query as { variant?: string; w?: string; h?: string; fit?: string };

  if (variant) {
    if (!(variant in IMAGE_VARIANTS)) {
      throw new AppError(
        `Unknown image variant '${variant}'. Valid: ${Object.keys(IMAGE_VARIANTS).join(', ')}`,
        400,
        'INVALID_VARIANT'
      );
    }
    return { ...IMAGE_VARIANTS[variant as ImageVariantName] };
  }

  if (w === undefined && h === undefined) return null;

  const width = w !== undefined ? parseInt(String(w), 10) : undefined;
  const height = h !== undefined ? parseInt(String(h), 10) : undefined;

  if ((width !== undefined && (!Number.isFinite(width) || width < 1)) ||
      (height !== undefined && (!Number.isFinite(height) || height < 1))) {
    throw new AppError('Invalid w/h dimensions — positive integers required', 400, 'INVALID_VARIANT');
  }

  const requestedFit = typeof fit === 'string' && (VALID_FITS as string[]).includes(fit) ? (fit as ImageTransformOptions['fit']) : 'inside';

  return {
    width: width === undefined ? undefined : Math.min(width, MAX_VARIANT_DIMENSION),
    height: height === undefined ? undefined : Math.min(height, MAX_VARIANT_DIMENSION),
    fit: requestedFit,
  };
};
