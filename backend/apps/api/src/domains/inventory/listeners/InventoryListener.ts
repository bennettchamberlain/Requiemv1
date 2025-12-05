import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';
import { OnEvent } from '@ci/domains/events';
import { FileService, FileUploadedEvent, type FileUploadedPayload } from '@ci/domains/files';
import { OllamaService } from '@ci/domains/llm';
import { ItemEntity } from '@ci/domains/memory';
import { PositionService } from '@ci/domains/position';

@Injectable()
export class InventoryListener {
  private readonly logger = new LoggerService(InventoryListener.name);

  constructor(
    private readonly fileService: FileService,
    private readonly ollamaService: OllamaService,
    private readonly positionService: PositionService,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
  ) {}

  @OnEvent(FileUploadedEvent, { queue: 'inventory' })
  async handleFileUploaded(payload: FileUploadedPayload) {
    this.logger.log('InventoryListener received payload', payload);
    if (!payload.isInventory) {
      this.logger.log('Skipping non-inventory upload', { fileId: payload.fileId });

      return;
    }

    this.logger.log('Processing inventory upload', { fileId: payload.fileId, userId: payload.userId });

    const context = { userId: payload.userId } as unknown as RequestContext;
    const serviceContext = toServiceContext(context);

    try {
      // 1. Get File Content
      this.logger.log('Getting file content', { fileId: payload.fileId });
      const file = await this.fileService.findById(serviceContext, payload.fileId);
      const fileContent = await this.fileService.getFileContent(context, file.key!);
      const base64Image = Buffer.from(fileContent).toString('base64');
      this.logger.log('Got file content', { size: base64Image.length });

      // 2. Get User Location
      // For now, we just get the last known position to simulate "current location"
      // In a real scenario, we might want the location *at the time of capture* which might be in metadata.
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours
      const positions = await this.positionService.findByDateRange(serviceContext, startDate, endDate);
      const currentPosition = positions[0]; // Most recent

      // Hardcoded "Home" location for demo purposes (approximate)
      const HOME_LAT = 37.7749;
      const HOME_LON = -122.4194;

      let isNearHome = false;
      if (currentPosition && currentPosition.location) {
        const latDiff = Math.abs(currentPosition.location.coordinates[1] - HOME_LAT);
        const lonDiff = Math.abs(currentPosition.location.coordinates[0] - HOME_LON);
        if (latDiff < 0.001 && lonDiff < 0.001) {
          isNearHome = true;
        }
      }

      // Override for testing if no position found
      isNearHome = true;

      // 3. Prompt LLM
      const prompt = `
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
              "estimated_value": 0
            }
          ]
        }

        For estimated_value, provide a rough number in USD based on visual condition. If unknown, use 0.
      `;

      const model = payload.model || 'llama3.2-vision';
      this.logger.log('Starting LLM chat', { model });

      const response = await this.ollamaService.chat(
        context,
        [
          {
            role: 'user',
            content: prompt,
            images: [base64Image],
          },
        ],
        { model, enableTools: false, format: 'json' },
      ); // Using vision model

      this.logger.log('LLM response received');

      const content = response.message.content;
      this.logger.log('Raw LLM content', { content });

      // Clean up markdown code blocks if present and extract JSON
      let jsonStr = content.replace(/```json\n?|\n?```/g, '').trim();
      const firstOpen = jsonStr.indexOf('{');
      const lastClose = jsonStr.lastIndexOf('}');

      if (firstOpen !== -1 && lastClose !== -1) {
        jsonStr = jsonStr.substring(firstOpen, lastClose + 1);
      }

      const data = JSON.parse(jsonStr);
      const items = Array.isArray(data.items) ? data.items : [];

      this.logger.log('Parsed items', { count: items.length });

      // 4. Save to Inventory
      for (const itemData of items) {
        const item = this.itemRepository.create({
          id: uuidv7(),
          userId: payload.userId,
          name: itemData.name || 'Unknown Item',
          description: itemData.description,
          category: itemData.category,
          brand: itemData.brand,
          model: itemData.model,
          condition: ['new', 'like_new', 'good', 'fair', 'poor', 'broken', 'n/a'].includes(itemData.condition)
            ? itemData.condition
            : 'good',
          currentValue: itemData.estimated_value,
          images: [`/${file.key}`], // Use the file key as path
          metadata: {
            original_analysis: itemData,
            is_near_home: isNearHome,
            captured_at: new Date(),
            source_file_id: payload.fileId,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await this.itemRepository.save(item);
        this.logger.log('Inventory item created', { itemId: item.id, name: item.name });
      }
    } catch (error) {
      this.logger.error('Failed to process inventory upload', {
        error: error instanceof Error ? error.message : String(error),
        fileId: payload.fileId,
      });
    }
  }
}
