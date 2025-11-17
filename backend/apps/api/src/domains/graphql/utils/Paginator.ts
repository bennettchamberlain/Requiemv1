import type { PageInfo } from '../types/PageInfo';

interface Args<T> {
  getId: (item: T) => string;
  first?: number;
  after?: string;
}

interface Result<T> {
  slice: T[];
  pageInfo: PageInfo;
  totalCount: number;
}

export class Paginator {
  static paginate<T>(items: T[], args: Args<T>): Result<T> {
    const { getId, first, after } = args;

    let startIndex = 0;

    if (after) {
      const i = items.findIndex((item) => getId(item) === after);

      if (i >= 0) {
        startIndex = i + 1;
      }
    }

    const slice = first != null ? items.slice(startIndex, startIndex + first) : items.slice(startIndex);
    const endIndex = startIndex + slice.length;

    return {
      slice,
      pageInfo: {
        hasNextPage: first != null ? endIndex < items.length : false,
        hasPreviousPage: startIndex > 0,
        startCursor: slice.length > 0 ? getId(slice[0]) : null,
        endCursor: slice.length > 0 ? getId(slice[slice.length - 1]) : null,
      },
      totalCount: items.length,
    };
  }
}
