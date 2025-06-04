import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { FileService } from '../services/FileService';
import type { FilePresignedLinkDto, FileUploadDto } from '../types';

@Controller('files')
export class FilesController {
  constructor(private readonly fileService: FileService) {}

  @Post()
  async getPresignedLink(@Body() body: FilePresignedLinkDto) {
    const link = await this.fileService.generatePresignedLink(body.id, body.contentType);

    return {
      link,
    };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  // Note that the literal 'file' is referencing the input with name `file` in a hypothetical form.
  // All other fields would show up in the `body` here.
  async upload(@Body() body: FileUploadDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const { key } = await this.fileService.upload(file.buffer, file.mimetype);

    return {
      key,
      body,
      file: {
        field: file.fieldname,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        contents: file.buffer.toString('base64'),
      },
    };
  }
}
