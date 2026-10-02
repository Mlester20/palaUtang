import { Alert } from 'react-native';

/** Best-effort readable message from anything that was thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

/**
 * Shows a failure alert that includes the actual error, and logs it to the Metro terminal,
 * so problems are never silent.
 */
export function showError(title: string, error: unknown) {
  console.error(`[${title}]`, error);
  Alert.alert(title, `Please try again.\n\nDetails: ${errorMessage(error)}`);
}
