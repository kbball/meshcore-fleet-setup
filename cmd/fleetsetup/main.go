// Command fleetsetup serves the MeshCore fleet setup web app and its firmware directory.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kbball/meshcore-fleet-setup/internal/adapters/fsstore"
	"github.com/kbball/meshcore-fleet-setup/internal/adapters/httpapi"
	"github.com/kbball/meshcore-fleet-setup/internal/app"
	"github.com/kbball/meshcore-fleet-setup/internal/config"
	"github.com/kbball/meshcore-fleet-setup/web"
)

// version is set at build time: -ldflags "-X main.version=1.2.3".
var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout, nil); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// run dispatches subcommands. ln, if non-nil, is used instead of listening on the configured address (tests).
func run(ctx context.Context, args []string, env func(string) string, out io.Writer, ln net.Listener) error {
	cmd := "serve"
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "serve":
		return serve(ctx, env, ln)
	case "healthcheck":
		return healthcheck(ctx, env)
	case "version":
		_, err := fmt.Fprintln(out, version)
		return err
	}
	return fmt.Errorf("unknown command %q (serve | healthcheck | version)", cmd)
}

func newLogger(cfg config.Config) *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel}))
}

func serve(ctx context.Context, env func(string) string, ln net.Listener) error {
	cfg, err := config.Load(env)
	if err != nil {
		return err
	}
	log := newLogger(cfg)
	webFS, err := web.Dist()
	if err != nil {
		return fmt.Errorf("embedded web app: %w", err)
	}
	deps := httpapi.Deps{Web: webFS, Version: version, Log: log}

	if cfg.FirmwareDir != "" {
		store, err := fsstore.New(cfg.FirmwareDir)
		if err != nil {
			return err
		}
		deps.Firmware = store.FS()
		checkFirmware(log, app.NewCatalog(store))
	} else {
		log.Warn("FLEET_FIRMWARE_DIR is not set: the app will load but has no firmware to flash")
	}

	if ln == nil {
		if ln, err = net.Listen("tcp", cfg.Addr); err != nil {
			return fmt.Errorf("listen on %s: %w", cfg.Addr, err)
		}
	}
	srv := &http.Server{
		Handler:           httpapi.New(deps),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	log.Info("listening", "addr", ln.Addr().String(), "version", version)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-errc; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("stopped")
	return nil
}

// checkFirmware logs how the firmware directory looks. It never stops the server: a bad copy is reported
// loudly here and again by the browser before it flashes anything.
func checkFirmware(log *slog.Logger, c *app.Catalog) {
	rep, err := c.Check()
	if err != nil {
		log.Error("firmware manifest", "err", err)
		return
	}
	for _, e := range rep.Entries {
		if e.Status == app.StatusOK {
			log.Info("firmware", "env", e.Entry.Env, "version", e.Entry.Version, "status", string(e.Status))
			continue
		}
		log.Error("firmware", "env", e.Entry.Env, "version", e.Entry.Version, "status", string(e.Status), "err", e.Err)
	}
}

// healthcheck asks the running server whether it is up, for Docker's HEALTHCHECK (the image has no shell
// or curl). It fails unless /healthz answers 200.
func healthcheck(ctx context.Context, env func(string) string) error {
	cfg, err := config.Load(env)
	if err != nil {
		return err
	}
	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		return fmt.Errorf("FLEET_ADDR %q: %w", cfg.Addr, err)
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(host, port)+"/healthz", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: status %d", resp.StatusCode)
	}
	return nil
}
