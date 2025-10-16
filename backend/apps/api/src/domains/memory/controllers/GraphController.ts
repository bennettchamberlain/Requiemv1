import { Controller } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { OnEvent, Events, type EventPayloads } from '@ci/domains/events';
import { UserService } from '@ci/domains/user';

import { GraphUtilityService } from '../services/GraphUtilityService';

@Controller()
export class GraphController {
  private logger = new LoggerService(GraphController.name);

  constructor(
    private readonly graphUtilityService: GraphUtilityService,
    private readonly userService: UserService,
  ) {}

  @OnEvent(Events.USER_CREATED)
  async addUserToGraph(payload: EventPayloads[Events.USER_CREATED]) {
    const user = await this.userService.findOne(payload.userId);

    if (user == null) {
      this.logger.error('User not found when attempting to add to graph');

      return;
    }

    const entityId = uuidv7();
    const nameForEntity = user.name ?? user.email;
    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
    const [firstName, ...restName] = nameParts;

    const properties: Record<string, unknown> = {
      email: user.email,
    };

    if (firstName) {
      properties.first_name = firstName;
    }

    if (restName.length > 0) {
      properties.last_name = restName.join(' ');
    }

    await this.graphUtilityService.createGraphNode({
      entityId,
      entityType: 'Person',
      name: nameForEntity,
      description: nameForEntity,
      properties,
      searchContent: nameForEntity,
      linkedTable: 'users',
      linkedId: user.id,
    });

    await this.userService.update(payload.userId, {
      entityId,
    });
  }
}
