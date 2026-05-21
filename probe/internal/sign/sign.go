// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package sign provides HMAC-SHA256 payload signing for probe telemetry.
//
// The probe signs the canonical JSON of each payload using the token's
// hmac_key (a 32-byte secret included in the token.json download).
// The signature is sent in the X-OpenWatch-Signature header as:
//
//	hmac-sha256=<base64-encoded-digest>
//
// The platform verifies the signature using the same key stored in Redis,
// ensuring the payload has not been tampered with in transit.
package sign

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// Sign computes HMAC-SHA256 of payload bytes using the base64-encoded hmac_key.
// Returns the signature header value: "hmac-sha256=<base64>".
func Sign(payloadBytes []byte, hmacKeyB64 string) (string, error) {
	if hmacKeyB64 == "" {
		return "", fmt.Errorf("hmac_key is empty — token may be missing this field")
	}

	key, err := base64.StdEncoding.DecodeString(hmacKeyB64)
	if err != nil {
		// Try URL-safe base64
		key, err = base64.URLEncoding.DecodeString(hmacKeyB64)
		if err != nil {
			return "", fmt.Errorf("invalid hmac_key encoding: %w", err)
		}
	}

	mac := hmac.New(sha256.New, key)
	mac.Write(payloadBytes)
	digest := mac.Sum(nil)

	return "hmac-sha256=" + base64.StdEncoding.EncodeToString(digest), nil
}
