import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { toServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OnEvent } from '@ci/domains/events';
import { FileService, FileUploadedEvent, type FileUploadedPayload } from '@ci/domains/files';
import {
  ItemService,
  ObjectObservationService,
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

/**
 * `source_kind` for a photo the user deliberately shot to catalogue their
 * things. Distinguishes it from a passive frame in the observation timeline.
 */
const INVENTORY_SOURCE_KIND = 'photo';

/** See the note on the identical helper in `CvDetectionsListener`. */
function parseExternalDate(value: Date | string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }

  // Typed `Date | null` on FileEntity and genuinely a Date at runtime — the
  // column is `timestamptz` (`20260212130000_rebuild_files_table`) and the pg
  // driver parses it off the wire OID, whatever the entity's stale
  // `type: 'text'` decorator says. The string branch is kept because that
  // decorator means a raw query or a future writer could hand back text, and
  // the failure mode is `Invalid Date` in a NOT NULL column.
  const parsed = value instanceof Date ? value : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Records what the vision pass SAW as well as what it MINTED.
 *
 * ── Why this listener changed, twice ───────────────────────────────────────
 *
 * `ci.object_observations`' migration header names this class as the thing it
 * was written to fix: it "writes speculative ci.inventory rows straight from a
 * vision guess", conflating "a coffee mug is visible in this photo" with "I own
 * this specific coffee mug".
 *
 * What is NOT true is that every write here is speculative. This listener only
 * runs when the upload carried `inventoryCapture: true` — an explicit,
 * per-upload assertion by the user that they are cataloguing their own
 * belongings (`FilesController` / `BulkFilesController` read it off the form).
 * The user's intent to own is real; it is the model's item-by-item reading of
 * the photo that is a guess.
 *
 * Two changes now answer that guess from opposite ends, and they are
 * complementary rather than redundant:
 *
 *  1. The MINTED ROW SAYS IT WAS GUESSED. `identity_method: 'vision'` and
 *     `identity_confidence` at {@link VISION_IDENTITY_CONFIDENCE}, so a later
 *     barcode scan outranks it instead of tying with it. That marks the claim.
 *  2. The GUESS ITSELF IS ON THE RECORD. Every item the model reads becomes a
 *     `ci.object_observations` sighting FIRST, and the minted row is attached
 *     to it as a resolution (`method: 'label'`). That leaves an auditable trail
 *     from pixels to owned unit where previously there was none: an inventory
 *     row simply appeared, with `metadata.original_analysis` as the only
 *     evidence and nothing queryable linking it to the frame it came from.
 *
 * One grades the conclusion; the other keeps the premise. Neither is the whole
 * fix. FULLY severing this path — minting only above a configured auto-mint
 * confidence and queueing the rest for review — is what the migration header
 * describes as `ObjectResolutionService`'s job. That service does not exist
 * yet, and the threshold it needs is a product decision, not a refactor.
 */

@Injectable()
export class InventoryListener {
  constructor(
    private readonly fileService: FileService,
    private readonly ollamaService: OllamaService,
    private readonly itemService: ItemService,
    private readonly observationService: ObjectObservationService,
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

    // The capture time of the pixels. `external_created_at` is TEXT and may be
    // anything an importer wrote, so it is parsed defensively and falls back to
    // the upload time.
    const observedAt = parseExternalDate(file.externalCreatedAt) ?? file.createdAt;

    for (const itemData of items) {
      const condition = itemData.condition?.toLowerCase() ?? 'good';
      const label = itemData.name?.trim() || 'Unknown Item';

      // THE SIGHTING, recorded before anything is minted.
      //
      // This pass returns a list of items with NO bounding boxes, which is
      // precisely the case `detectionKeyFor` picks its `label` scheme for: keyed
      // on (file, detector, label), so re-running the model over the same photo
      // updates each item in place, and two different objects in one frame stay
      // two rows instead of collapsing into one.
      const observation = await this.observationService.create(serviceContext, {
        observedAt,
        sourceKind: INVENTORY_SOURCE_KIND,
        fileId: payload.fileId,
        label,
        labelSource: 'ollama_vision',
        detector: model,
        // No per-item score is available — the prompt does not ask for one, and
        // a number invented here would outrank a genuinely measured one later.
        detectionConfidence: null,
        // OBSERVED STATE, which is what this column is for — the migration's
        // own example is `{color: 'red', condition: 'scratched', count: 2}`.
        //
        // Recorded VERBATIM, exactly as `label` is, and deliberately NOT put
        // through `normalizePhysicalProperties`: that normalizer turns
        // unit-bearing strings into millimetres and grams for `ci.inventory`,
        // and a sighting is the record of what the detector SAID, not of what
        // its words resolve to. Dimensions and mass are left off entirely for
        // the same reason — they need that normalizer to mean anything, and a
        // second raw copy here is a second thing to parse and disagree about.
        attributes: {
          ...(itemData.condition != null && { condition: itemData.condition }),
          ...(itemData.category != null && { category: itemData.category }),
          ...(itemData.colors != null && itemData.colors.length > 0 && { colors: itemData.colors }),
          ...(itemData.materials != null &&
            itemData.materials.length > 0 && { materials: itemData.materials }),
        },
        metadata: {
          inventory_capture: true,
          original_analysis: itemData,
        },
      });

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

      // Attach the minted unit to the sighting it came from. `label` is the
      // honest method: nothing matched an identifier or an embedding, the model
      // read a name off a photo. Confidence is left unset rather than guessed.
      //
      // `create` returns null when the sighting matched a row a human has
      // already confirmed; that row's resolution is theirs, so there is nothing
      // to attach and nothing to log as a failure.
      if (observation != null) {
        await this.observationService.resolve(serviceContext, observation.id, {
          resolvedObjectId: item.id,
          resolutionMethod: 'label',
          resolutionConfidence: null,
        });
      }
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
