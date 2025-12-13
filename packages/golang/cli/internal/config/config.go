// Package config handles token parsing and configuration.
//
// Tokens are base64url-encoded JSON with format: csc_<payload>
package config

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ServiceToken represents the decoded token payload.
type ServiceToken struct {
	ServiceID   string `json:"serviceId"`
	SplitConfig string `json:"splitConfig"`
	SplitVault  string `json:"splitVault"`
	Price       int64  `json:"price,string"`
	CreatedAt   int64  `json:"createdAt"`
	Signature   string `json:"signature"`
}

// ParsedToken contains the raw token and parsed metadata.
type ParsedToken struct {
	Raw         string
	Payload     ServiceToken
	ServiceName string
	TunnelURL   string
}

// ParseToken decodes and validates a service token.
// Returns an error if the token format is invalid.
func ParseToken(token string) (*ParsedToken, error) {
	if !strings.HasPrefix(token, "csc_") {
		return nil, errors.New("token must start with 'csc_'")
	}

	// Decode base64url
	encoded := token[4:]
	// Convert base64url to standard base64
	encoded = strings.ReplaceAll(encoded, "-", "+")
	encoded = strings.ReplaceAll(encoded, "_", "/")

	// Add padding if needed
	switch len(encoded) % 4 {
	case 2:
		encoded += "=="
	case 3:
		encoded += "="
	}

	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 encoding: %w", err)
	}

	var payload ServiceToken
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return nil, fmt.Errorf("invalid JSON payload: %w", err)
	}

	// Validate required fields
	if payload.ServiceID == "" {
		return nil, errors.New("missing serviceId")
	}
	if payload.SplitConfig == "" {
		return nil, errors.New("missing splitConfig")
	}
	if payload.SplitVault == "" {
		return nil, errors.New("missing splitVault")
	}
	if payload.Signature == "" {
		return nil, errors.New("missing signature")
	}

	// Extract service name from serviceId
	serviceName := fmt.Sprintf("service-%s", payload.ServiceID[:8])
	if len(payload.ServiceID) < 8 {
		serviceName = fmt.Sprintf("service-%s", payload.ServiceID)
	}

	return &ParsedToken{
		Raw:         token,
		Payload:     payload,
		ServiceName: serviceName,
		TunnelURL:   "wss://market.cascade.fyi/tunnel/connect",
	}, nil
}
