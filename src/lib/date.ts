const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Friday, October 2". Built by hand so it reads the same on every device (no Intl). */
export function formatLongDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Day of week with Monday = 0 … Sunday = 6, matching a Mon–Sun week chart. */
export function mondayFirstDayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** "October 2, 2026". */
export function formatFullDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
