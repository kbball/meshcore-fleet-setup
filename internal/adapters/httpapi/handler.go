// Package httpapi serves the embedded web app, the firmware directory and a health endpoint.
package httpapi

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Deps are what the handler needs.
type Deps struct {
	// Web is the built frontend, rooted at index.html.
	Web fs.FS
	// Firmware is the firmware directory; nil disables /firmware/.
	Firmware fs.FS
	Version  string
	Log      *slog.Logger
}

// securityHeaders are set on every response. Web Serial is allowed for our own origin only; nothing else
// powerful is. The CSP keeps the page from loading or talking to anything but this server.
var securityHeaders = map[string]string{
	"Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
		"connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy":        "no-referrer",
	"Permissions-Policy":     "serial=(self), usb=(), camera=(), microphone=(), geolocation=()",
}

// New returns the server's http.Handler.
func New(d Deps) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "version": d.Version})
	})
	if d.Firmware != nil {
		fw := http.StripPrefix("/firmware/", http.FileServerFS(noDirs{d.Firmware}))
		mux.Handle("GET /firmware/", noStore(fw))
	} else {
		mux.HandleFunc("GET /firmware/", func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "no firmware directory configured (set FLEET_FIRMWARE_DIR)", http.StatusNotFound)
		})
	}
	mux.Handle("GET /", caching(http.FileServerFS(d.Web)))
	return logRequests(d.Log, withHeaders(mux))
}

func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for k, v := range securityHeaders {
			w.Header().Set(k, v)
		}
		next.ServeHTTP(w, r)
	})
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// caching: Vite fingerprints everything under /assets/, so it can be cached for good; the page itself must not be.
func caching(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

// noDirs hides directory listings: opening a directory is reported as not found.
type noDirs struct{ fs.FS }

func (n noDirs) Open(name string) (fs.File, error) {
	f, err := n.FS.Open(name)
	if err != nil {
		return nil, err
	}
	if st, err := f.Stat(); err != nil || st.IsDir() {
		_ = f.Close()
		return nil, fs.ErrNotExist
	}
	return f, nil
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func logRequests(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		level := slog.LevelInfo
		if r.URL.Path == "/healthz" {
			level = slog.LevelDebug // the container healthcheck fires every few seconds
		}
		log.Log(r.Context(), level, "request", "method", r.Method, "path", r.URL.Path, "status", rec.status, "ms", time.Since(start).Milliseconds())
	})
}
