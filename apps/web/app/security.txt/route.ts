import { securityTxtResponse } from "../security-txt";

export const dynamic = "force-static";

export function GET(): Response {
  return securityTxtResponse();
}
