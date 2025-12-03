import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import type {RequestContext, ServiceContext, UserServiceContext} from '@ci/common/types';

import { FileService } from '../services/FileService';

@Controller('files')
export class FilesController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: ServiceContext) {
    return this.fileService.findAll(context);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Context() context: ServiceContext, @Param('id') id: string) {
    return this.fileService.findById(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/presign')
  @HttpCode(200)
  async getPresignedLink(@Context() context: ServiceContext, @Param('id') id: string) {
    const url = await this.fileService.generatePresignedLink(context, id);

    return {
      url,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', undefined, { limits: { fileSize: 10 * 1024 * 1024 * 1024 } }))
  async upload(@Context() context: UserServiceContext, @UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const results = await Promise.all(files.map((file) => this.fileService.upload(context, file)));

    return results;
  }
}
