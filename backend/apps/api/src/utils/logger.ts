import { pino } from 'pino';

const logger = pino();

export class Logger {
  static create(name?: string | null, config?: object) {
    const nameConfig = name != null ? { name } : {};
    const optionConfig = config || {};

    const props = { ...nameConfig, ...optionConfig };

    return logger.child(props);
  }
}
