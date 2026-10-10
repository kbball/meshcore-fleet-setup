package app

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"

	"github.com/kbball/meshcore-fleet-setup/internal/domain"
)

// Status of one manifest entry after checking its file.
type Status string

// Possible entry statuses.
const (
	StatusOK       Status = "ok"
	StatusMissing  Status = "missing"
	StatusMismatch Status = "checksum mismatch"
	StatusError    Status = "unreadable"
)

// EntryReport is the result of checking one entry.
type EntryReport struct {
	Entry  domain.Entry
	Status Status
	Err    error
}

// Report is the result of checking the whole catalogue.
type Report struct {
	Entries []EntryReport
}

// Healthy reports whether every entry checked out.
func (r Report) Healthy() bool {
	for _, e := range r.Entries {
		if e.Status != StatusOK {
			return false
		}
	}
	return true
}

// Catalog checks that the firmware on disk matches its manifest, so a bad copy is noticed at startup
// rather than at the moment someone is about to flash a board. (The browser verifies again before flashing.)
type Catalog struct {
	files FirmwareFiles
}

// NewCatalog builds a Catalog over the given firmware files.
func NewCatalog(files FirmwareFiles) *Catalog { return &Catalog{files: files} }

// Check reads manifest.json and verifies every listed file. A missing or invalid manifest is an error.
func (c *Catalog) Check() (Report, error) {
	f, err := c.files.Open("manifest.json")
	if err != nil {
		return Report{}, fmt.Errorf("open manifest.json: %w", err)
	}
	data, err := io.ReadAll(f)
	_ = f.Close()
	if err != nil {
		return Report{}, fmt.Errorf("read manifest.json: %w", err)
	}
	m, err := domain.ParseManifest(data)
	if err != nil {
		return Report{}, err
	}
	var rep Report
	for _, e := range m.Entries {
		rep.Entries = append(rep.Entries, c.checkEntry(e))
	}
	return rep, nil
}

func (c *Catalog) checkEntry(e domain.Entry) EntryReport {
	f, err := c.files.Open(e.File)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return EntryReport{Entry: e, Status: StatusMissing}
		}
		return EntryReport{Entry: e, Status: StatusError, Err: err}
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return EntryReport{Entry: e, Status: StatusError, Err: err}
	}
	var sum [sha256.Size]byte
	copy(sum[:], h.Sum(nil))
	if !e.Matches(sum) {
		return EntryReport{Entry: e, Status: StatusMismatch}
	}
	return EntryReport{Entry: e, Status: StatusOK}
}
