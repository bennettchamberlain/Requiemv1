import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';

import { Context } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';

import { FileService } from '../services/FileService';
import type { FileUploadDto } from '../types';

@Controller('files')
export class FilesController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(@Context() context: RequestContext) {
    return this.fileService.findAll(context);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.fileService.findOne(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/presign')
  async getPresignedLink(@Context() context: RequestContext, @Param('id') id: string) {
    const url = await this.fileService.generatePresignedLink(context, id);

    return {
      url,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 * 1024} }))
  // Note that the literal 'file' is referencing the input with name `file` in a hypothetical form.
  // All other fields would show up in the `body` here.
  async upload(
    @Context() context: RequestContext,
    @Body() body: FileUploadDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.fileService.upload(context, file);
  }
}
