// Package app holds the server's use cases and the ports they depend on.
package app

import "io"

// FirmwareFiles gives read access to the firmware directory (manifest.json and the zips).
type FirmwareFiles interface {
	Open(name string) (io.ReadCloser, error)
}
