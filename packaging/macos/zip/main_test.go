package main

import (
	"archive/zip"
	"io/fs"
	"testing"
)

func TestConfigureArchiveHeaderPreservesPortableModes(t *testing.T) {
	tests := []struct {
		name        string
		isDirectory bool
		wantMode    fs.FileMode
	}{
		{name: "FixYourTrack-macOS/Start FixYourTrack.command", wantMode: 0o755},
		{name: "FixYourTrack-macOS/Stop FixYourTrack.command", wantMode: 0o755},
		{name: "FixYourTrack-macOS/runtime/fixyourtrack-server-arm64", wantMode: 0o755},
		{name: "FixYourTrack-macOS/runtime/fixyourtrack-server-x64", wantMode: 0o755},
		{name: "FixYourTrack-macOS/README.txt", wantMode: 0o644},
		{name: "FixYourTrack-macOS/runtime", isDirectory: true, wantMode: fs.ModeDir | 0o755},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			header := &zip.FileHeader{}
			configureArchiveHeader(header, test.name, test.isDirectory)

			if got := header.Mode(); got != test.wantMode {
				t.Fatalf("archive mode = %v, want %v", got, test.wantMode)
			}
			if !test.isDirectory && header.Method != zip.Deflate {
				t.Fatalf("archive method = %d, want deflate", header.Method)
			}
			if test.isDirectory && header.Name[len(header.Name)-1] != '/' {
				t.Fatalf("directory name %q does not end with a slash", header.Name)
			}
		})
	}
}
