package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kbball/meshcore-fleet-setup/internal/adapters/memory"
)

func sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func manifest(entries ...string) string {
	out := `{"entries":[`
	for i, e := range entries {
		if i > 0 {
			out += ","
		}
		out += e
	}
	return out + `]}`
}

func entry(file, content string) string {
	return `{"board":"b","env":"e","kind":"companion","version":"1","file":"` + file + `","sha256":"` + sum(content) + `"}`
}

func TestCheckReportsEachEntry(t *testing.T) {
	files := memory.NewFiles(map[string]string{
		"manifest.json": manifest(entry("good.zip", "good"), entry("gone.zip", "gone"), entry("bad.zip", "expected")),
		"good.zip":      "good",
		"bad.zip":       "tampered",
	})
	rep, err := NewCatalog(files).Check()
	require.NoError(t, err)
	require.Len(t, rep.Entries, 3)
	assert.Equal(t, StatusOK, rep.Entries[0].Status)
	assert.Equal(t, StatusMissing, rep.Entries[1].Status)
	assert.Equal(t, StatusMismatch, rep.Entries[2].Status)
	assert.False(t, rep.Healthy())
}

func TestCheckHealthy(t *testing.T) {
	files := memory.NewFiles(map[string]string{"manifest.json": manifest(entry("a.zip", "a")), "a.zip": "a"})
	rep, err := NewCatalog(files).Check()
	require.NoError(t, err)
	assert.True(t, rep.Healthy())
}

func TestCheckManifestProblems(t *testing.T) {
	_, err := NewCatalog(memory.NewFiles(nil)).Check()
	assert.ErrorContains(t, err, "open manifest.json")
	_, err = NewCatalog(memory.NewFiles(map[string]string{"manifest.json": "{"})).Check()
	assert.ErrorContains(t, err, "valid JSON")
}

type brokenFiles struct{}

type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, errors.New("disk on fire") }
func (errReader) Close() error             { return nil }

func (brokenFiles) Open(name string) (io.ReadCloser, error) {
	if name == "manifest.json" {
		return io.NopCloser(stringsReader(manifest(entry("x.zip", "x") + "," + entry("y.zip", "y")))), nil
	}
	if name == "x.zip" {
		return nil, errors.New("permission denied")
	}
	return errReader{}, nil
}

func stringsReader(s string) io.Reader { return &sr{s: s} }

type sr struct {
	s string
	i int
}

func (r *sr) Read(p []byte) (int, error) {
	if r.i >= len(r.s) {
		return 0, io.EOF
	}
	n := copy(p, r.s[r.i:])
	r.i += n
	return n, nil
}

func TestCheckUnreadableFiles(t *testing.T) {
	rep, err := NewCatalog(brokenFiles{}).Check()
	require.NoError(t, err)
	require.Len(t, rep.Entries, 2)
	assert.Equal(t, StatusError, rep.Entries[0].Status)
	assert.EqualError(t, rep.Entries[0].Err, "permission denied")
	assert.Equal(t, StatusError, rep.Entries[1].Status)
	assert.False(t, rep.Healthy())
}
