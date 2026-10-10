// Package domain holds the pure types of the fleet setup server. It imports nothing from other internal packages.
package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
)

// Entry is one firmware image listed in manifest.json.
type Entry struct {
	Board   string `json:"board"`
	Env     string `json:"env"`
	Kind    string `json:"kind"`
	Version string `json:"version"`
	File    string `json:"file"`
	SHA256  string `json:"sha256"`
}

// Manifest is the firmware index the browser app reads.
type Manifest struct {
	Entries []Entry `json:"entries"`
}

// ParseManifest decodes and validates a manifest. File paths must stay inside the firmware directory.
func ParseManifest(data []byte) (Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Manifest{}, fmt.Errorf("manifest is not valid JSON: %w", err)
	}
	if m.Entries == nil {
		return Manifest{}, errors.New("manifest has no entries list")
	}
	for i, e := range m.Entries {
		if err := e.validate(); err != nil {
			return Manifest{}, fmt.Errorf("manifest entry %d: %w", i, err)
		}
	}
	return m, nil
}

func (e Entry) validate() error {
	for name, v := range map[string]string{"board": e.Board, "env": e.Env, "version": e.Version, "file": e.File} {
		if v == "" {
			return fmt.Errorf("missing %q", name)
		}
	}
	if e.Kind != "companion" && e.Kind != "tracker" {
		return fmt.Errorf("kind must be companion or tracker, got %q", e.Kind)
	}
	if b, err := hex.DecodeString(e.SHA256); err != nil || len(b) != sha256.Size {
		return errors.New("sha256 must be 64 hex characters")
	}
	if clean := path.Clean(e.File); path.IsAbs(e.File) || clean == ".." || strings.HasPrefix(clean, "../") || clean != e.File {
		return fmt.Errorf("file %q must be a clean relative path inside the firmware directory", e.File)
	}
	return nil
}

// Matches reports whether sum is this entry's checksum.
func (e Entry) Matches(sum [sha256.Size]byte) bool {
	return strings.EqualFold(hex.EncodeToString(sum[:]), e.SHA256)
}
