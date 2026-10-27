import { z } from "zod";

/**
 * The offset date-time rule the v1 contracts were published with: what
 * `z.string().datetime({ offset: true })` generated before zod 4.6, seconds
 * optional. zod 4.6 makes seconds mandatory (RFC 3339 does), which would both
 * reject timestamps v1 clients are allowed to send and change the bytes of
 * documents already published at immutable schema.spctre.dev URLs. Requiring
 * seconds is a contract revision, so it belongs to a new version segment.
 */
const V1_OFFSET_DATE_TIME =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$/;

export const offsetDateTimeV1 = () =>
  z.stringFormat("date-time", V1_OFFSET_DATE_TIME, { error: "Invalid ISO datetime" });
