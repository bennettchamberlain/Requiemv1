import { FilePreviewGenerationListener } from '../FilePreviewGenerationListener';

/**
 * Preview generation must tolerate warning-level JPEG quirks. Real phone
 * JPEGs — Samsung above all — routinely carry defects like stray padding
 * before restart markers ("Corrupt JPEG data: N extraneous bytes before
 * marker 0xdN") that every mainstream viewer decodes fine, but sharp's
 * default failOn: 'warning' turned into failed preview jobs (~8% of a sampled
 * Google Takeout batch). The listener now decodes with failOn: 'error':
 * warning-level quirks produce a normal preview, genuinely undecodable bytes
 * still fail the job.
 *
 * The fixture below is a real reproduction, not a mock: a tiny JPEG encoded
 * with restart markers and stray bytes stuffed before them, which makes the
 * default-strictness sharp throw exactly the production error
 * ("Corrupt JPEG data: 6 extraneous bytes before marker 0xd1").
 */
const QUIRKY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQ' +
    'ERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
    'FBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
    'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6' +
    'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
    'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5' +
    'OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE' +
    'xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/90ABAAB/9oADAMBAAIRAxEAPwD8z7LSOny1vWWkdPlrZstI6fLW' +
    '9ZaR0+WiEwy7MdtTACoR/9D4MstH6fLW9ZaR0+Wtmy0jp8tb1lo/T5a7oTP07Lsx21MAKhH/0fkmy0jp8tb1lpHT5a2LLSOn' +
    'y1v2WkdPlr3ITP6dy7MdtT8AKhH/0vBbLR+ny1v2WkdPlrYstI6fLW/ZaP0+WvqoTP7ry7MdtT8AKhH/0/j2y0fp8tb1lpHT' +
    '5a2bLSOny1vWWj9PlrhhM/McuzHbUwAqEf/U+erLSOny1vWWkdPlrZstI6fLW9ZaR0+WiEwy7MdtTwAqEf/V82stH6fLW/Za' +
    'R0+Wtiy0jp8tb9lo/T5a7oTP07Lsx21PACoR/9anZaR0+Wt+y0jp8tbFlpHT5a37LSOny17kJn9O5dmO2p8AKhH/1/K7LSOn' +
    'y1vWWkdPlrZstI6fLW9ZaR0+WvDhM/mLLsx21AAqEf/QyLLR+ny1vWWkdPlrZstI6fLW9ZaP0+WuGEz8xy7MdtQAKhH/0els' +
    'tI6fLW/ZaR0+Wtiy0jp8tb9lpHT5aITDLsx21AAqEf/S9istH6fLW9ZaR0+Wtmy0jp8tb1lo/T5a7oTP07Lsx21PACoR/9Pa' +
    'stH6fLW9ZaR0+Wtmy0jp8tb1lo/T5a+VhM/hTLsx21MAKhH/1PVrLSOny1v2WkdPlrYstI6fLW/ZaR0+WvDhM/mLLsx21AAq' +
    'Ef/V+k7LR+ny1v2WkdPlrYstI6fLW/ZaP0+WuGEz8xy7MdtTACoR/9b7QstI6fLW9ZaR0+Wtmy0jp8tb1lpHT5aITDLsx21P' +
    'ACoR/9k=',
  'base64',
);

function makeLogger() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeListener(fileBytes: Buffer) {
  const created: unknown[] = [];
  const fileService = {
    findVariantByParentId: jest.fn(async () => null),
    findById: jest.fn(async () => ({
      id: 'file-1',
      bucket: 'files',
      key: 'user/file-1',
      contentType: 'image/jpeg',
    })),
    getFileContent: jest.fn(async () => fileBytes),
    setDimensions: jest.fn(async () => {}),
    create: jest.fn(async (_ctx: unknown, input: unknown) => {
      created.push(input);

      return { id: 'preview-1' };
    }),
  };
  const mediaDimensionsService = {
    fromImageBuffer: jest.fn(async () => ({ width: 64, height: 64 })),
  };
  const eventService = { send: jest.fn(async () => {}) };

  const listener = new FilePreviewGenerationListener(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fileService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mediaDimensionsService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeLogger() as any,
  );

  return { listener, fileService, eventService, created };
}

describe('FilePreviewGenerationListener', () => {
  it('generates a preview for a JPEG with warning-level defects (stray bytes before restart markers)', async () => {
    const { listener, fileService, eventService, created } = makeListener(QUIRKY_JPEG);

    await listener.generatePreview({ userId: 'u1', fileId: 'file-1', inventoryCapture: false });

    expect(fileService.create).toHaveBeenCalledTimes(1);
    const preview = created[0] as { contentType: string; width: number; height: number; buffer: Buffer };
    expect(preview.contentType).toBe('image/jpeg');
    expect(preview.width).toBeGreaterThan(0);
    expect(preview.width).toBeLessThanOrEqual(300);
    expect(preview.height).toBeGreaterThan(0);
    expect(preview.height).toBeLessThanOrEqual(300);
    expect(preview.buffer.length).toBeGreaterThan(0);
    expect(eventService.send).toHaveBeenCalledTimes(1);
  });

  it('still fails the job on genuinely undecodable bytes (failOn is error, not none)', async () => {
    const { listener, fileService } = makeListener(Buffer.from('this is not an image at all'));

    await expect(
      listener.generatePreview({ userId: 'u1', fileId: 'file-1', inventoryCapture: false }),
    ).rejects.toThrow();
    expect(fileService.create).not.toHaveBeenCalled();
  });
});
