package domain

import (
	"crypto/sha256"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var goodSum = strings.Repeat("ab", 32)

func entryJSON(file, kind, sum string) string {
	return `{"entries":[{"board":"b","env":"e","kind":"` + kind + `","version":"1","file":"` + file + `","sha256":"` + sum + `"}]}`
}

func TestParseManifestAccepts(t *testing.T) {
	m, err := ParseManifest([]byte(entryJSON("v1/e.zip", "companion", goodSum)))
	require.NoError(t, err)
	require.Len(t, m.Entries, 1)
	assert.Equal(t, "v1/e.zip", m.Entries[0].File)
	_, err = ParseManifest([]byte(`{"entries":[]}`))
	assert.NoError(t, err)
}

func TestParseManifestRejects(t *testing.T) {
	cases := map[string]string{
		"not json":      `{`,
		"no entries":    `{}`,
		"bad kind":      entryJSON("a.zip", "other", goodSum),
		"bad sha":       entryJSON("a.zip", "tracker", "zz"),
		"short sha":     entryJSON("a.zip", "tracker", "abcd"),
		"parent dir":    entryJSON("../a.zip", "tracker", goodSum),
		"absolute":      entryJSON("/etc/passwd", "tracker", goodSum),
		"unclean":       entryJSON("a/../b.zip", "tracker", goodSum),
		"missing field": `{"entries":[{"board":"b","env":"e","kind":"tracker","version":"","file":"a","sha256":"` + goodSum + `"}]}`,
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := ParseManifest([]byte(in))
			assert.Error(t, err)
		})
	}
}

func TestEntryMatches(t *testing.T) {
	sum := sha256.Sum256([]byte("hello"))
	e := Entry{SHA256: "2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824"}
	assert.True(t, e.Matches(sum))
	assert.False(t, Entry{SHA256: goodSum}.Matches(sum))
}
