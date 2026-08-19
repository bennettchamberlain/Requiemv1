import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CronRunStore } from '@ci/common/schedule';

/** Wires {@link CronRunStore} to the app DataSource on module boot. */
@Injectable()
export class CronRunTracker implements OnModuleInit {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    CronRunStore.configure(this.dataSource);
  }
}
