import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import type { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';

import { FileService } from '../services/FileService';

@Controller('files')
export class FilesController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    return this.fileService.findAll(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Context() context: RequestContext, @Param('id') id: string) {
    const serviceContext = toServiceContext(context);

    return this.fileService.findById(serviceContext, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/presign')
  @HttpCode(200)
  async getPresignedLink(@Context() context: RequestContext, @Param('id') id: string) {
    const serviceContext = toServiceContext(context);

    const url = await this.fileService.generatePresignedLink(serviceContext, id);

    return {
      url,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', undefined, { limits: { fileSize: 10 * 1024 * 1024 * 1024 } }))
  async upload(
    @Context() context: RequestContext,
    @UploadedFiles() files: Express.Multer.File[],
    @Query('inventory') isInventory?: string,
    @Query('model') model?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const serviceContext = toServiceContext(context);
    const isInventoryBool = isInventory === 'true';

    console.log('FilesController.upload called', { isInventory, isInventoryBool, model });

    return await Promise.all(
      files.map((file) => this.fileService.upload(serviceContext, file, isInventoryBool, model)),
    );
  }
}
