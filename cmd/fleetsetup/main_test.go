package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func writeFirmware(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	zip := []byte("PK-fake")
	sum := sha256.Sum256(zip)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "e.zip"), zip, 0o600))
	m := `{"entries":[{"board":"b","env":"e","kind":"tracker","version":"1","file":"e.zip","sha256":"` + hex.EncodeToString(sum[:]) + `"},` +
		`{"board":"b","env":"f","kind":"tracker","version":"1","file":"gone.zip","sha256":"` + hex.EncodeToString(sum[:]) + `"}]}`
	require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(m), 0o600))
	return dir
}

func start(t *testing.T, e map[string]string) (base string, stop func() error) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx, []string{"serve"}, env(e), io.Discard, ln) }()
	base = "http://" + ln.Addr().String()
	require.Eventually(t, func() bool {
		r, err := http.Get(base + "/healthz")
		if err != nil {
			return false
		}
		_ = r.Body.Close()
		return r.StatusCode == 200
	}, 3*time.Second, 20*time.Millisecond)
	return base, func() error { cancel(); return <-done }
}

func TestServeWithFirmware(t *testing.T) {
	base, stop := start(t, map[string]string{"FLEET_FIRMWARE_DIR": writeFirmware(t)})
	resp, err := http.Get(base + "/firmware/e.zip")
	require.NoError(t, err)
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	assert.Equal(t, "PK-fake", string(body))
	assert.NoError(t, stop())
}

func TestServeWithoutFirmware(t *testing.T) {
	base, stop := start(t, nil)
	resp, err := http.Get(base + "/firmware/manifest.json")
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, 404, resp.StatusCode)
	assert.NoError(t, stop())
}

func TestServeSurvivesABadManifest(t *testing.T) {
	dir := t.TempDir() // no manifest.json
	base, stop := start(t, map[string]string{"FLEET_FIRMWARE_DIR": dir})
	resp, err := http.Get(base + "/healthz")
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, 200, resp.StatusCode)
	assert.NoError(t, stop())
}

func TestServeConfigErrors(t *testing.T) {
	err := run(context.Background(), []string{"serve"}, env(map[string]string{"LOG_LEVEL": "loud"}), io.Discard, nil)
	assert.ErrorContains(t, err, "LOG_LEVEL")
	err = run(context.Background(), []string{"serve"}, env(map[string]string{"FLEET_FIRMWARE_DIR": "/definitely/not/here"}), io.Discard, nil)
	assert.ErrorContains(t, err, "firmware dir")
	err = run(context.Background(), []string{"serve"}, env(map[string]string{"FLEET_ADDR": "256.0.0.1:99999"}), io.Discard, nil)
	assert.ErrorContains(t, err, "listen")
}

func TestVersionAndUnknownCommand(t *testing.T) {
	var out bytes.Buffer
	require.NoError(t, run(context.Background(), []string{"version"}, env(nil), &out, nil))
	assert.Equal(t, version+"\n", out.String())
	assert.ErrorContains(t, run(context.Background(), []string{"bogus"}, env(nil), &out, nil), "unknown command")
}

func TestHealthcheck(t *testing.T) {
	base, stop := start(t, nil)
	addr := base[len("http://"):]
	assert.NoError(t, run(context.Background(), []string{"healthcheck"}, env(map[string]string{"FLEET_ADDR": addr}), io.Discard, nil))
	require.NoError(t, stop())
	assert.Error(t, run(context.Background(), []string{"healthcheck"}, env(map[string]string{"FLEET_ADDR": addr}), io.Discard, nil))
}

func TestHealthcheckBadInput(t *testing.T) {
	assert.ErrorContains(t, healthcheck(context.Background(), env(map[string]string{"FLEET_ADDR": "nope"})), "FLEET_ADDR")
	assert.Error(t, healthcheck(context.Background(), env(map[string]string{"LOG_LEVEL": "loud"})))
}

func TestHealthcheckNon200(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	srv := &http.Server{Handler: http.NotFoundHandler(), ReadHeaderTimeout: time.Second}
	go func() { _ = srv.Serve(ln) }()
	defer func() { _ = srv.Close() }()
	err = healthcheck(context.Background(), env(map[string]string{"FLEET_ADDR": ln.Addr().String()}))
	assert.ErrorContains(t, err, "status 404")
}
