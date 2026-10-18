export interface SearchSelectOption {
  value: string;
  label: string;
  count?: number;
}

// Case-insensitive "contains" match anywhere in the label. A blank query keeps every option.
export function filterSearchSelectOptions(
  options: readonly SearchSelectOption[],
  query: string,
): SearchSelectOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}
