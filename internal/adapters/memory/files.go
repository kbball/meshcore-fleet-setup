// Package memory has in-memory implementations of the ports, for tests.
package memory

import (
	"io"
	"testing/fstest"
)

// Files is an in-memory app.FirmwareFiles.
type Files struct{ FS fstest.MapFS }

// NewFiles builds Files from name -> contents.
func NewFiles(contents map[string]string) *Files {
	m := fstest.MapFS{}
	for k, v := range contents {
		m[k] = &fstest.MapFile{Data: []byte(v)}
	}
	return &Files{FS: m}
}

// Open implements app.FirmwareFiles.
func (f *Files) Open(name string) (io.ReadCloser, error) { return f.FS.Open(name) }
