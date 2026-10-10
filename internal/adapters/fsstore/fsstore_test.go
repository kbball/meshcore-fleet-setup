package fsstore

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStore(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("{}"), 0o600))
	s, err := New(dir)
	require.NoError(t, err)
	f, err := s.Open("manifest.json")
	require.NoError(t, err)
	b, _ := io.ReadAll(f)
	_ = f.Close()
	assert.Equal(t, "{}", string(b))
	_, err = s.FS().Open("nope")
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestNewRejectsBadDirs(t *testing.T) {
	_, err := New(filepath.Join(t.TempDir(), "missing"))
	assert.Error(t, err)
	file := filepath.Join(t.TempDir(), "f")
	require.NoError(t, os.WriteFile(file, nil, 0o600))
	_, err = New(file)
	assert.ErrorContains(t, err, "not a directory")
}
