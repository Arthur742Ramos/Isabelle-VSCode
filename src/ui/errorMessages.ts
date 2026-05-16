const DEFAULT_NOTIFICATION_LIMIT = 240;

export interface UserVisibleError {
  logMessage: string;
  notificationMessage: string;
}

export function formatUserVisibleError(
  prefix: string,
  error: unknown,
  notificationLimit = DEFAULT_NOTIFICATION_LIMIT
): UserVisibleError {
  const message = errorToMessage(error);
  return {
    logMessage: `${prefix}: ${message}`,
    notificationMessage: `${prefix}: ${truncateForNotification(message, notificationLimit)}`
  };
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function truncateForNotification(message: string, limit = DEFAULT_NOTIFICATION_LIMIT): string {
  if (message.length <= limit) {
    return message;
  }

  if (limit <= 3) {
    return ".".repeat(Math.max(limit, 0));
  }

  return `${message.slice(0, limit - 3)}...`;
}
