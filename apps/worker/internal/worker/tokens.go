package worker

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	accessTokenPrefix  = "spctre_dev"
	refreshTokenPrefix = "spctre_ref"
	accessTokenTTL     = time.Hour
	refreshTokenTTL    = 90 * 24 * time.Hour
)

type tokenRefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type tokenPairResponse struct {
	AccessToken           string  `json:"accessToken"`
	AccessTokenExpiresAt  string  `json:"accessTokenExpiresAt"`
	RefreshToken          string  `json:"refreshToken"`
	RefreshTokenExpiresAt string  `json:"refreshTokenExpiresAt"`
	Meta                  APIMeta `json:"meta"`
}

type refreshTokenRow struct {
	ID            string
	TenantID      string
	WorkspaceID   string
	PrincipalID   string
	AccessTokenID string
	ExpiresAt     time.Time
	RevokedAt     *time.Time
	RotatedAt     *time.Time
}

type accessTokenContext struct {
	Label  string
	Scopes []string
}

func (s *Server) handleTokenRefresh(w http.ResponseWriter, r *http.Request) {
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}

	var payload tokenRefreshRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, bodyLimits.Control)).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "Request body must be JSON.", traceID, nil)
		return
	}
	if payload.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "refreshToken is required.", traceID, []validationIssue{{Path: "refreshToken", Message: "refreshToken is required."}})
		return
	}

	pair, status, err := s.rotateRefreshToken(r.Context(), payload.RefreshToken)
	if err != nil {
		if status == http.StatusUnauthorized {
			s.logger.Warn("token refresh rejected", "error", err.Error())
		} else {
			s.logger.Error("token refresh failed", "error", err)
		}
		writeError(w, status, err.Error(), traceID, nil)
		return
	}
	pair.Meta = makeMeta(traceID)
	writeJSON(w, http.StatusOK, pair)
}

func (s *Server) handleTokenRevoke(w http.ResponseWriter, r *http.Request) {
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}

	auth, err := s.authenticateServiceTokenScope(r.Context(), r, "bundle:read")
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error(), traceID, nil)
		return
	}

	if err := s.revokeServiceTokenAndRefresh(r.Context(), auth); err != nil {
		s.logger.Error("token revoke failed", "error", err, "token_id", auth.TokenID)
		writeError(w, http.StatusInternalServerError, "Token could not be revoked.", traceID, nil)
		return
	}

	w.Header().Set("x-request-id", traceID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authenticateServiceTokenScope(ctx context.Context, r *http.Request, requiredScope string) (authResult, error) {
	bearer := bearerToken(r)
	if bearer == "" {
		return authResult{}, errors.New("Missing bearer token.")
	}
	tokenHash := hashToken(bearer)

	var auth authResult
	var scopes []string
	err := s.db.QueryRow(ctx, `
		SELECT id, tenant_id::text, workspace_id::text, principal_id::text, scopes
		FROM service_token
		WHERE token_hash = $1
			AND revoked_at IS NULL
			AND (expires_at IS NULL OR expires_at > now())
		LIMIT 1
	`, tokenHash).Scan(&auth.TokenID, &auth.TenantID, &auth.WorkspaceID, &auth.PrincipalID, &scopes)
	if errors.Is(err, pgx.ErrNoRows) {
		return authResult{}, errors.New("Missing or invalid bearer token.")
	}
	if err != nil {
		return authResult{}, err
	}
	auth.Scopes = scopes
	if !contains(scopes, requiredScope) {
		return authResult{}, errors.New("Token is missing " + requiredScope + " scope.")
	}
	if _, err := s.db.Exec(ctx, `UPDATE service_token SET last_used_at = now() WHERE id = $1`, auth.TokenID); err != nil {
		s.logger.Warn("service token last-used update failed", "error", err, "token_id", auth.TokenID)
	}
	return auth, nil
}

func (s *Server) rotateRefreshToken(ctx context.Context, rawRefreshToken string) (tokenPairResponse, int, error) {
	tokenHash := hashRawToken(rawRefreshToken)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}
	defer s.rollbackAfterFailure(ctx, tx, "rotate_refresh_token")

	var row refreshTokenRow
	err = tx.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, workspace_id::text, principal_id::text,
		       access_token_id::text, expires_at, revoked_at, rotated_at
		FROM service_refresh_token
		WHERE token_hash = $1
		LIMIT 1
		FOR UPDATE
	`, tokenHash).Scan(&row.ID, &row.TenantID, &row.WorkspaceID, &row.PrincipalID, &row.AccessTokenID, &row.ExpiresAt, &row.RevokedAt, &row.RotatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return tokenPairResponse{}, http.StatusUnauthorized, errors.New("Refresh token not found.")
	}
	if err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}

	if row.RevokedAt != nil {
		s.logger.Warn("revoked refresh token reuse", "event", "token.revoked_reuse_attempt", "token_id", row.ID, "tenant_id", row.TenantID, "revoked_at", row.RevokedAt.Format(time.RFC3339))
		return tokenPairResponse{}, http.StatusUnauthorized, errors.New("Refresh token has been revoked.")
	}
	if row.RotatedAt != nil {
		s.logger.Warn("rotated refresh token reuse", "event", "token.rotated_reuse_attempt", "token_id", row.ID, "tenant_id", row.TenantID, "rotated_at", row.RotatedAt.Format(time.RFC3339))
		return tokenPairResponse{}, http.StatusUnauthorized, errors.New("Refresh token has already been rotated.")
	}
	if !row.ExpiresAt.After(time.Now()) {
		s.logger.Warn("expired refresh token attempt", "event", "token.expired_refresh_attempt", "token_id", row.ID, "tenant_id", row.TenantID, "expired_at", row.ExpiresAt.Format(time.RFC3339))
		return tokenPairResponse{}, http.StatusUnauthorized, errors.New("Refresh token expired. Run spctre init to reconnect.")
	}

	tokenCtx, err := lookupAccessTokenContext(ctx, tx, row.AccessTokenID)
	if err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}

	rawAccess, err := createRawToken(accessTokenPrefix)
	if err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}
	rawRefresh, err := createRawToken(refreshTokenPrefix)
	if err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}
	accessExpiresAt := time.Now().UTC().Add(accessTokenTTL)
	refreshExpiresAt := time.Now().UTC().Add(refreshTokenTTL)

	var accessTokenID string
	err = tx.QueryRow(ctx, `
		INSERT INTO service_token (
			tenant_id, workspace_id, principal_id, label,
			token_hash, token_prefix, scopes, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id::text
	`, row.TenantID, row.WorkspaceID, row.PrincipalID, tokenCtx.Label,
		hashRawToken(rawAccess), tokenPrefix(rawAccess), tokenCtx.Scopes, accessExpiresAt).Scan(&accessTokenID)
	if err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}

	var refreshTokenID string
	err = tx.QueryRow(ctx, `
		INSERT INTO service_refresh_token (
			tenant_id, workspace_id, principal_id, access_token_id,
			token_hash, token_prefix, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id::text
	`, row.TenantID, row.WorkspaceID, row.PrincipalID, accessTokenID,
		hashRawToken(rawRefresh), tokenPrefix(rawRefresh), refreshExpiresAt).Scan(&refreshTokenID)
	if err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}

	if _, err := tx.Exec(ctx, `UPDATE service_token SET revoked_at = now() WHERE id = $1`, row.AccessTokenID); err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}
	if _, err := tx.Exec(ctx, `UPDATE service_refresh_token SET rotated_at = now(), rotated_into = $2 WHERE id = $1`, row.ID, refreshTokenID); err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}

	if err := appendGenericOperationsLogTx(ctx, tx, row.TenantID, row.WorkspaceID, "TOKEN_REFRESHED", accessTokenID, "service_token", row.PrincipalID, map[string]any{
		"previousAccessTokenId":  row.AccessTokenID,
		"previousRefreshTokenId": row.ID,
		"accessTokenId":          accessTokenID,
		"refreshTokenId":         refreshTokenID,
		"accessTokenExpiresAt":   accessExpiresAt.Format(time.RFC3339),
		"refreshTokenExpiresAt":  refreshExpiresAt.Format(time.RFC3339),
	}); err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}

	if err := tx.Commit(ctx); err != nil {
		return tokenPairResponse{}, http.StatusInternalServerError, err
	}

	return tokenPairResponse{
		AccessToken: rawAccess, AccessTokenExpiresAt: accessExpiresAt.Format(time.RFC3339),
		RefreshToken: rawRefresh, RefreshTokenExpiresAt: refreshExpiresAt.Format(time.RFC3339),
	}, http.StatusOK, nil
}

func (s *Server) revokeServiceTokenAndRefresh(ctx context.Context, auth authResult) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer s.rollbackAfterFailure(ctx, tx, "revoke_service_token")

	if _, err := tx.Exec(ctx, `
		UPDATE service_token
		SET revoked_at = now()
		WHERE id = $1 AND revoked_at IS NULL
	`, auth.TokenID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE service_refresh_token
		SET revoked_at = now()
		WHERE access_token_id = $1
			AND revoked_at IS NULL
			AND rotated_at IS NULL
	`, auth.TokenID); err != nil {
		return err
	}

	if err := appendGenericOperationsLogTx(ctx, tx, auth.TenantID, auth.WorkspaceID, "TOKEN_REVOKED", auth.TokenID, "service_token", auth.PrincipalID, map[string]any{
		"tokenId":   auth.TokenID,
		"revokedAt": time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func lookupAccessTokenContext(ctx context.Context, tx pgx.Tx, accessTokenID string) (accessTokenContext, error) {
	var out accessTokenContext
	err := tx.QueryRow(ctx, `
		SELECT label, scopes
		FROM service_token
		WHERE id = $1
		LIMIT 1
	`, accessTokenID).Scan(&out.Label, &out.Scopes)
	if errors.Is(err, pgx.ErrNoRows) {
		return accessTokenContext{Label: "Rotated token", Scopes: []string{}}, nil
	}
	return out, err
}

func createRawToken(prefix string) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashRawToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func tokenPrefix(token string) string {
	if len(token) <= 16 {
		return token
	}
	return token[:16]
}
