import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';

import { FileService } from '../services/FileService';

@Controller('files')
export class FilesController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', undefined, { limits: { fileSize: 10 * 1024 * 1024 * 1024 } }))
  async upload(@Context() context: RequestContext, @UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const serviceContext = toServiceContext(context);

    return await Promise.all(files.map((file) => this.fileService.upload(serviceContext, file)));
  }
}
