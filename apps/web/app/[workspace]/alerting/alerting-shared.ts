export interface SharedHandlerContext {
  workspaceId: string;
  workspaceSlug: string;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export function getBadgeClass(type: string) {
  switch (type) {
    case "SLACK":
      return "badge badgeSlack";
    case "TEAMS":
      return "badge badgeTeams";
    case "PAGERDUTY":
      return "badge badgePagerduty";
    case "EMAIL":
      return "badge badgeWebhook";
    case "SPLUNK_HEC":
      return "badge badgeSiem";
    case "SENTINEL":
      return "badge badgeSiem";
    default:
      return "badge badgeWebhook";
  }
}
