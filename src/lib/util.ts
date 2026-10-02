export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Distinct non-empty values in order of appearance. */
export const unique = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];
