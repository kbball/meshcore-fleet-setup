package config

import (
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func envOf(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadDefaults(t *testing.T) {
	c, err := Load(envOf(nil))
	require.NoError(t, err)
	assert.Equal(t, ":8080", c.Addr)
	assert.Empty(t, c.FirmwareDir)
	assert.Equal(t, slog.LevelInfo, c.LogLevel)
}

func TestLoadOverrides(t *testing.T) {
	c, err := Load(envOf(map[string]string{"FLEET_ADDR": "127.0.0.1:9000", "FLEET_FIRMWARE_DIR": "/firmware", "LOG_LEVEL": " debug "}))
	require.NoError(t, err)
	assert.Equal(t, "127.0.0.1:9000", c.Addr)
	assert.Equal(t, "/firmware", c.FirmwareDir)
	assert.Equal(t, slog.LevelDebug, c.LogLevel)
}

func TestLoadRejectsBadLogLevel(t *testing.T) {
	_, err := Load(envOf(map[string]string{"LOG_LEVEL": "loud"}))
	assert.ErrorContains(t, err, "LOG_LEVEL")
}
