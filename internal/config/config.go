// Package config reads runtime configuration from environment variables.
package config

import (
	"fmt"
	"log/slog"
	"strings"
)

// Config is the server's runtime configuration.
type Config struct {
	// Addr is the listen address, e.g. ":8080".
	Addr string
	// FirmwareDir holds manifest.json and the firmware zips served under /firmware/. Empty disables the route.
	FirmwareDir string
	// LogLevel is the slog level.
	LogLevel slog.Level
}

// Load builds a Config from env (a lookup function, so tests need not touch the process environment).
func Load(env func(string) string) (Config, error) {
	c := Config{Addr: ":8080", FirmwareDir: env("FLEET_FIRMWARE_DIR")}
	if v := env("FLEET_ADDR"); v != "" {
		c.Addr = v
	}
	if v := strings.TrimSpace(env("LOG_LEVEL")); v != "" {
		if err := c.LogLevel.UnmarshalText([]byte(v)); err != nil {
			return Config{}, fmt.Errorf("LOG_LEVEL %q: %w", v, err)
		}
	}
	return c, nil
}
