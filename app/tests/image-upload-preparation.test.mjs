import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const manipulationCalls = [];
let renderResult;
let shouldFail = false;

mock.module('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: (uri, options) => {
      manipulationCalls.push({ uri, options });
      return {
        renderAsync: async () => {
          if (shouldFail) throw new Error('native image processing failed');
          return {
            saveAsync: async (saveOptions) => {
              manipulationCalls.push({ saveOptions });
              return renderResult;
            },
          };
        },
      };
    },
  },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

const {
  IMAGE_UPLOAD_COMPRESSION,
  IMAGE_UPLOAD_PREPARE_BYTES,
  MAX_UPLOAD_IMAGE_DIMENSION,
  prepareImageForUpload,
} = await import('../lib/image-upload-preparation.ts');

beforeEach(() => {
  manipulationCalls.length = 0;
  shouldFail = false;
  renderResult = {
    uri: 'file:///cache/prepared-image.jpg',
    width: 2048,
    height: 1365,
  };
});

afterEach(() => {
  shouldFail = false;
});

test('resizes and recompresses oversized JPEGs without changing aspect ratio metadata', async () => {
  const prepared = await prepareImageForUpload({
    uri: 'content://photos/original.jpg',
    name: 'original.jpg',
    mimeType: 'image/jpeg',
    size: IMAGE_UPLOAD_PREPARE_BYTES + 1,
    width: 4032,
    height: 2688,
  });

  expect(manipulationCalls[0]).toEqual({
    uri: 'content://photos/original.jpg',
    options: {
      maxWidth: MAX_UPLOAD_IMAGE_DIMENSION,
      maxHeight: MAX_UPLOAD_IMAGE_DIMENSION,
    },
  });
  expect(manipulationCalls[1].saveOptions).toEqual({
    format: 'jpeg',
    compress: IMAGE_UPLOAD_COMPRESSION,
  });
  expect(prepared).toEqual({
    uri: 'file:///cache/prepared-image.jpg',
    name: 'original.jpg',
    mimeType: 'image/jpeg',
    size: null,
    width: 2048,
    height: 1365,
  });
});

test('keeps PNG as PNG so transparent pixels are not flattened onto JPEG', async () => {
  renderResult = {
    uri: 'file:///cache/prepared-logo.png',
    width: 2048,
    height: 2048,
  };
  const prepared = await prepareImageForUpload({
    uri: 'content://photos/logo.png',
    name: 'logo.png',
    mimeType: 'image/png',
    size: IMAGE_UPLOAD_PREPARE_BYTES + 100,
    width: 3000,
    height: 3000,
  });

  expect(manipulationCalls[1].saveOptions).toEqual({ format: 'png' });
  expect(prepared.name).toBe('logo.png');
  expect(prepared.mimeType).toBe('image/png');
});

test('converts HEIC photos to JPEG with a matching filename and MIME type', async () => {
  const prepared = await prepareImageForUpload({
    uri: 'content://photos/live-photo.heic',
    name: 'live-photo.heic',
    mimeType: 'image/heic',
    size: IMAGE_UPLOAD_PREPARE_BYTES + 1,
    width: 3024,
    height: 4032,
  });

  expect(prepared.name).toBe('live-photo.jpg');
  expect(prepared.mimeType).toBe('image/jpeg');
});

test('leaves small images and unsupported or animated formats untouched', async () => {
  const small = {
    uri: 'content://photos/small.jpg',
    name: 'small.jpg',
    mimeType: 'image/jpeg',
    size: 200_000,
    width: 1600,
    height: 1200,
  };
  const gif = {
    uri: 'content://photos/animation.gif',
    name: 'animation.gif',
    mimeType: 'image/gif',
    size: IMAGE_UPLOAD_PREPARE_BYTES + 1,
    width: 4096,
    height: 4096,
  };
  const webp = {
    uri: 'content://photos/graphic.webp',
    name: 'graphic.webp',
    mimeType: 'image/webp',
    size: IMAGE_UPLOAD_PREPARE_BYTES + 1,
    width: 4096,
    height: 4096,
  };

  expect(await prepareImageForUpload(small)).toBe(small);
  expect(await prepareImageForUpload(gif)).toBe(gif);
  expect(await prepareImageForUpload(webp)).toBe(webp);
  expect(manipulationCalls).toHaveLength(0);
});

test('does not manipulate video files', async () => {
  const video = {
    uri: 'content://photos/clip.mp4',
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    size: IMAGE_UPLOAD_PREPARE_BYTES + 1,
    width: 4096,
    height: 2160,
  };

  expect(await prepareImageForUpload(video)).toBe(video);
  expect(manipulationCalls).toHaveLength(0);
});

test('falls back to the untouched original if native preparation fails', async () => {
  shouldFail = true;
  const original = {
    uri: 'content://photos/original.jpg',
    name: 'original.jpg',
    mimeType: 'image/jpeg',
    size: IMAGE_UPLOAD_PREPARE_BYTES + 1,
    width: 4032,
    height: 2688,
  };

  expect(await prepareImageForUpload(original)).toBe(original);
});
