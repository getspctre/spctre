export function formatAdminDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}
