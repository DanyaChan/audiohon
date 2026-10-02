export const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
