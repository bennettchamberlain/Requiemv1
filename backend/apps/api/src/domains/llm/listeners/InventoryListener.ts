import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { toServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OnEvent } from '@ci/domains/events';
import { FileService, FileUploadedEvent, type FileUploadedPayload } from '@ci/domains/files';
import {
  ItemService,
  type InventoryCondition,
  type PhysicalItemPropertiesDto,
  normalizePhysicalProperties,
} from '@ci/domains/memory';

import { OllamaService } from '../services/OllamaService';

const ItemAnalysisSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  condition: z.string().nullable(),
  estimated_value: z.number(),
  // Physical properties, as a model actually reports them: unit-bearing
  // strings. They are NOT converted here — ItemService resolves every unit
  // through the one normalizer, so this listener never learns what an inch is.
  colors: z.array(z.string()).nullable().optional(),
  materials: z.array(z.string()).nullable().optional(),
  dimensions: z.string().nullable().optional(),
  mass: z.string().nullable().optional(),
});

const AnalysisResponseSchema = z.object({
  items: z.array(ItemAnalysisSchema),
});

type ItemAnalysis = z.infer<typeof ItemAnalysisSchema>;

const PROMPT = `
  Analyze this image and identify all distinct objects visible.
  You are a JSON generator. Output ONLY valid JSON.
  Do not include any conversational text, markdown formatting, or explanations.

  If the image is too dark, blurry, or contains no distinct objects, return an empty array for "items".

  Return a JSON object with the following schema:
  {
    "items": [
      {
        "name": "Short name of the item",
        "description": "Brief description",
        "category": "General category (e.g., Electronics, Furniture, Tools)",
        "brand": "Brand name if visible, or null",
        "model": "Model if visible, or null",
        "condition": "Estimated condition (new, good, fair, poor)",
        "estimated_value": 0,
        "colors": ["Dominant colour first, plain names like navy or off-white"],
        "materials": ["What it appears to be made of, e.g. leather, oak, steel"],
        "dimensions": "Rough size as LxWxH WITH A UNIT, e.g. 30 x 20 x 5 cm — or null",
        "mass": "Rough weight WITH A UNIT, e.g. 1.2 kg — or null"
      }
    ]
  }

  For estimated_value, provide a rough number in USD based on visual condition. If unknown, use 0.

  Sizes and weights MUST carry their unit ("30 cm", not "30"). Omit any field you
  cannot see rather than guessing — a wrong measurement is worse than none.
`;

const DEFAULT_MODEL = 'llama3.2-vision:11b';

/** Matches the 'vision-guessed' tier documented on ci.inventory.identity_confidence. */
const VISION_IDENTITY_CONFIDENCE = 0.4;

@Injectable()
export class InventoryListener {
  constructor(
    private readonly fileService: FileService,
    private readonly ollamaService: OllamaService,
    private readonly itemService: ItemService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(InventoryListener.name);
  }

  @OnEvent(FileUploadedEvent, { queue: 'inventory' })
  async handleFileUploaded(payload: FileUploadedPayload) {
    if (!payload.inventoryCapture) {
      this.logger.log('File uploaded without inventory capture enabled, skipping processing', {
        fileId: payload.fileId,
      });

      return;
    }

    const serviceContext = toServiceContext({
      userId: payload.userId,
    });

    const file = await this.fileService.findById(serviceContext, payload.fileId);

    if (file == null) {
      this.logger.warn('File not found, skipping processing', {
        fileId: payload.fileId,
      });

      return;
    }

    if (file.contentType == null || !file.contentType.startsWith('image/')) {
      this.logger.log('File is not an image, skipping processing', {
        fileId: payload.fileId,
        contentType: file.contentType,
      });

      return;
    }

    if (file.key == null) {
      this.logger.warn('File has no storage key, cannot retrieve content', {
        fileId: payload.fileId,
      });

      return;
    }

    const fileContent = await this.fileService.getFileContent(serviceContext, file.key);
    const base64Image = Buffer.from(fileContent).toString('base64');
    const model = payload.model ?? DEFAULT_MODEL;

    this.logger.log('Starting LLM chat', {
      model,
    });

    const response = await this.ollamaService.chat(
      serviceContext,
      [
        {
          role: 'user',
          content: PROMPT,
          images: [base64Image],
        },
      ],
      {
        model,
        enableTools: false,
        format: 'json',
      },
    );

    const content = response.message.content;

    this.logger.log('Raw LLM content received', {
      content,
    });

    const items = this.parseAndValidateAnalysis(content);

    if (items.length > 0) {
      this.logger.log('Identified items', {
        count: items.length,
      });
    }

    for (const itemData of items) {
      const condition = itemData.condition?.toLowerCase() ?? 'good';

      const item = await this.itemService.create(serviceContext, {
        name: itemData.name || 'Unknown Item',
        description: itemData.description ?? undefined,
        category: itemData.category ?? undefined,
        brand: itemData.brand ?? undefined,
        model: itemData.model ?? undefined,
        condition: ['new', 'like_new', 'good', 'fair', 'poor', 'broken', 'n/a'].includes(condition)
          ? (condition as InventoryCondition)
          : 'good',
        currentValue: itemData.estimated_value,
        // A photo is not a tape measure. Saying so is the difference between a
        // guess a later barcode scan can overwrite and one that reads as fact —
        // the schema's 1.0 default would claim the latter.
        identityMethod: 'vision',
        identityConfidence: VISION_IDENTITY_CONFIDENCE,
        ...this.physicalPropertiesOf(itemData),
        metadata: {
          original_analysis: itemData,
          captured_at: new Date(),
          source_file_id: payload.fileId,
          // Measurement provenance, stamped at the write.
          // `identity_method` is the only other tell that these numbers were
          // eyeballed, and it is independently mutable: a later barcode scan
          // flips the row to 'barcode'/1.0 and the guessed millimetres would
          // read as ground truth ever after. This key survives that flip.
          measurements: {
            source: 'vision',
            model,
            at: new Date(),
          },
        },
      });

      this.logger.log('Inventory item created', {
        itemId: item.id,
        name: item.name,
      });
    }

    this.logger.log('Inventory processing completed');
  }

  /**
   * The physical half of a vision result, or nothing.
   *
   * Two rules, both because the writer is a model rather than a client:
   *
   * 1. `requireUnit`. The prompt asks for "30 x 20 x 5 cm"; a model that
   *    answers "30 x 20 x 5" is not saying millimetres, but that is how a bare
   *    number reads, and the CHECK constraints only guard the high side — a
   *    30 mm desk passes every one of them. A missing unit must lose the
   *    measurement, not silently shrink the object by 10x.
   * 2. The CANONICALIZED values are returned, not the model's strings, so the
   *    service's own (lenient, by design) normalization cannot re-admit what
   *    this stricter pass just rejected.
   *
   * An uninterpretable "medium-sized" therefore costs the measurement rather
   * than the whole item — the API rightly rejects the request instead, because
   * a client can fix a request and a model cannot.
   */
  private physicalPropertiesOf(analysis: ItemAnalysis): PhysicalItemPropertiesDto {
    const claimed = {
      colors: analysis.colors ?? undefined,
      materials: analysis.materials ?? undefined,
      dimensions: analysis.dimensions ?? undefined,
      massG: analysis.mass ?? undefined,
    };

    try {
      return normalizePhysicalProperties(claimed, { requireUnit: true });
    } catch (error) {
      this.logger.warn('Discarding unreadable physical properties from image analysis', {
        error: error instanceof Error ? error.message : String(error),
        colors: analysis.colors,
        materials: analysis.materials,
        dimensions: analysis.dimensions,
        mass: analysis.mass,
      });

      return {};
    }
  }

  private parseAndValidateAnalysis(content: string): ItemAnalysis[] {
    let jsonStr = content.replace(/```json\n?|\n?```/g, '').trim();

    const firstOpen = jsonStr.indexOf('{');
    const lastClose = jsonStr.lastIndexOf('}');

    if (firstOpen !== -1 && lastClose !== -1) {
      jsonStr = jsonStr.substring(firstOpen, lastClose + 1);
    }

    try {
      const validationResult = AnalysisResponseSchema.safeParse(JSON.parse(jsonStr));

      if (!validationResult.success) {
        this.logger.error(validationResult.error, 'LLM response failed schema validation');

        return [];
      }

      return validationResult.data.items;
    } catch (error) {
      this.logger.error(error as Error, 'Failed to parse JSON from LLM response');

      return [];
    }
  }
}
