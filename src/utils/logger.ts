import pino from 'pino'

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'yyyy-mm-dd HH:MM:ss',
    ignore: 'pid,hostname',
  },
})

export const logger = pino(
  {
    level: 'info',
    base: undefined,
  },
  transport
)

// Add success method for compatibility with consola
export const loggerWithSuccess = Object.assign(logger, {
  success: (msg: string, ...args: any[]) => logger.info(msg, ...args),
})

export default loggerWithSuccess