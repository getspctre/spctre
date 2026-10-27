import { z } from "zod";
import { offsetDateTimeV1 } from "./timestamp";

/**
 * Schema for token refresh (POST /api/token/refresh).
 */
export const TokenRefreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required."),
});

export type TokenRefreshInput = z.infer<typeof TokenRefreshSchema>;

/**
 * Shape of a successful token-pair response.
 */
export const TokenPairResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: offsetDateTimeV1(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: offsetDateTimeV1(),
});

export type TokenPairResponse = z.infer<typeof TokenPairResponseSchema>;
