import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import type { FileUploadDto } from '../types';

@Controller('files')
export class FilesController {
  constructor() {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  // Note that the literal 'file' is referencing the input with name `file` in a hypothetical form.
  // All other fields would show up in the `body` here.
  async upload(@Body() body: FileUploadDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return {
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
