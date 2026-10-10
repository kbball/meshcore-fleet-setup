// Package fsstore implements app.FirmwareFiles on a directory.
package fsstore

import (
	"fmt"
	"io"
	"io/fs"
	"os"
)

// Store reads firmware files from a directory.
type Store struct {
	fsys fs.FS
}

// New opens dir. It fails if dir is not a directory.
func New(dir string) (*Store, error) {
	st, err := os.Stat(dir)
	if err != nil {
		return nil, fmt.Errorf("firmware dir: %w", err)
	}
	if !st.IsDir() {
		return nil, fmt.Errorf("firmware dir %q is not a directory", dir)
	}
	return &Store{fsys: os.DirFS(dir)}, nil
}

// Open implements app.FirmwareFiles.
func (s *Store) Open(name string) (io.ReadCloser, error) { return s.fsys.Open(name) }

// FS exposes the directory for the HTTP adapter.
func (s *Store) FS() fs.FS { return s.fsys }
