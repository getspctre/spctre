import { z } from "zod";

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
  accessTokenExpiresAt: z.string().datetime({ offset: true }),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string().datetime({ offset: true }),
});

export type TokenPairResponse = z.infer<typeof TokenPairResponseSchema>;
