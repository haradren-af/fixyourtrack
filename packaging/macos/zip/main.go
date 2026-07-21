package main

import (
	"archive/zip"
	"flag"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	source := flag.String("source", "", "directory to place at the root of the ZIP")
	output := flag.String("output", "", "output ZIP file")
	flag.Parse()

	if *source == "" || *output == "" {
		log.Fatal("source and output are required")
	}

	sourcePath, err := filepath.Abs(*source)
	if err != nil {
		log.Fatal(err)
	}

	var paths []string
	err = filepath.WalkDir(sourcePath, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		paths = append(paths, path)
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	sort.Strings(paths)

	file, err := os.Create(*output)
	if err != nil {
		log.Fatal(err)
	}
	writer := zip.NewWriter(file)

	parent := filepath.Dir(sourcePath)
	for _, path := range paths {
		relative, err := filepath.Rel(parent, path)
		if err != nil {
			log.Fatal(err)
		}
		name := filepath.ToSlash(relative)

		info, err := os.Stat(path)
		if err != nil {
			log.Fatal(err)
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			log.Fatal(err)
		}
		configureArchiveHeader(header, name, info.IsDir())

		entryWriter, err := writer.CreateHeader(header)
		if err != nil {
			log.Fatal(err)
		}
		if info.IsDir() {
			continue
		}

		input, err := os.Open(path)
		if err != nil {
			log.Fatal(err)
		}
		_, copyErr := io.Copy(entryWriter, input)
		closeErr := input.Close()
		if copyErr != nil {
			log.Fatal(copyErr)
		}
		if closeErr != nil {
			log.Fatal(closeErr)
		}
	}

	if err := writer.Close(); err != nil {
		_ = file.Close()
		log.Fatal(err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		log.Fatal(err)
	}
	if err := file.Close(); err != nil {
		log.Fatal(err)
	}

	archive, err := zip.OpenReader(*output)
	if err != nil {
		log.Fatal(err)
	}
	if len(archive.File) != len(paths) {
		_ = archive.Close()
		log.Fatalf("ZIP verification found %d entries, expected %d", len(archive.File), len(paths))
	}
	if err := archive.Close(); err != nil {
		log.Fatal(err)
	}
}

func isExecutable(name string) bool {
	base := filepath.Base(name)
	return strings.HasSuffix(base, ".command") || strings.HasPrefix(base, "fixyourtrack-server-")
}

func configureArchiveHeader(header *zip.FileHeader, name string, isDirectory bool) {
	header.Name = name
	if isDirectory {
		header.Name += "/"
		header.SetMode(os.ModeDir | 0o755)
		return
	}

	header.Method = zip.Deflate
	if isExecutable(name) {
		header.SetMode(0o755)
		return
	}
	header.SetMode(0o644)
}
