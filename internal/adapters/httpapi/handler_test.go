package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestHandler(t *testing.T, withFirmware bool) (http.Handler, *strings.Builder) {
	t.Helper()
	logs := &strings.Builder{}
	d := Deps{
		Web: fstest.MapFS{
			"index.html":   {Data: []byte("<html>app</html>")},
			"assets/a.js":  {Data: []byte("console")},
			"assets/a.css": {Data: []byte("body{}")},
			"secret/dir/x": {Data: []byte("x")},
		},
		Version: "9.9.9",
		Log:     slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	}
	if withFirmware {
		d.Firmware = fstest.MapFS{
			"manifest.json": {Data: []byte(`{"entries":[]}`)},
			"v1/e.zip":      {Data: []byte("PKzip")},
		}
	}
	return New(d), logs
}

func get(h http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestServesTheApp(t *testing.T) {
	h, _ := newTestHandler(t, false)
	rec := get(h, "/")
	assert.Equal(t, 200, rec.Code)
	assert.Contains(t, rec.Body.String(), "app")
	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))

	asset := get(h, "/assets/a.js")
	assert.Equal(t, 200, asset.Code)
	assert.Contains(t, asset.Header().Get("Cache-Control"), "immutable")
	assert.Equal(t, 404, get(h, "/nope").Code)
}

func TestSecurityHeadersEverywhere(t *testing.T) {
	h, _ := newTestHandler(t, true)
	for _, p := range []string{"/", "/healthz", "/firmware/manifest.json", "/nope"} {
		rec := get(h, p)
		assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"), p)
		assert.Contains(t, rec.Header().Get("Content-Security-Policy"), "default-src 'self'", p)
		assert.Contains(t, rec.Header().Get("Permissions-Policy"), "serial=(self)", p)
		assert.Equal(t, "no-referrer", rec.Header().Get("Referrer-Policy"), p)
	}
}

func TestHealthz(t *testing.T) {
	h, logs := newTestHandler(t, false)
	rec := get(h, "/healthz")
	assert.Equal(t, 200, rec.Code)
	assert.JSONEq(t, `{"status":"ok","version":"9.9.9"}`, rec.Body.String())
	assert.Contains(t, logs.String(), "level=DEBUG") // health checks are logged at debug only
}

func TestFirmwareServed(t *testing.T) {
	h, logs := newTestHandler(t, true)
	rec := get(h, "/firmware/v1/e.zip")
	assert.Equal(t, 200, rec.Code)
	assert.Equal(t, "PKzip", rec.Body.String())
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	assert.Contains(t, logs.String(), "level=INFO")
	assert.Contains(t, logs.String(), "path=/firmware/v1/e.zip")

	assert.Equal(t, 200, get(h, "/firmware/manifest.json").Code)
}

func TestFirmwareDirectoriesAreNotListed(t *testing.T) {
	h, _ := newTestHandler(t, true)
	assert.Equal(t, 404, get(h, "/firmware/v1/").Code)
	assert.Equal(t, 404, get(h, "/firmware/v1").Code)
	assert.Equal(t, 404, get(h, "/firmware/missing.zip").Code)
}

func TestFirmwareCannotEscapeItsDirectory(t *testing.T) {
	h, _ := newTestHandler(t, true)
	rec := get(h, "/firmware/../index.html")
	assert.NotContains(t, rec.Body.String(), "app")
	assert.NotEqual(t, 200, get(h, "/firmware/%2e%2e/index.html").Code)
}

func TestNoFirmwareConfigured(t *testing.T) {
	h, _ := newTestHandler(t, false)
	rec := get(h, "/firmware/manifest.json")
	assert.Equal(t, 404, rec.Code)
	body, _ := io.ReadAll(rec.Body)
	assert.Contains(t, string(body), "FLEET_FIRMWARE_DIR")
}

func TestOnlyGetIsAllowed(t *testing.T) {
	h, _ := newTestHandler(t, true)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/firmware/manifest.json", strings.NewReader("x")))
	require.Equal(t, 405, rec.Code)
}
