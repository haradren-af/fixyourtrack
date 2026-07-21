package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppHandlerSecurityAndRouting(t *testing.T) {
	appRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(appRoot, "index.html"), []byte("app shell"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appRoot, "app.js"), []byte("export {}"), 0o600); err != nil {
		t.Fatal(err)
	}

	handler := appHandler(appRoot, "FixYourTrack/0.0.0-test/server-test")

	t.Run("serves app with security headers", func(t *testing.T) {
		response := performRequest(t, handler, http.MethodGet, "/")
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
		}
		if response.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing X-Content-Type-Options header")
		}
		if response.Header().Get("Cross-Origin-Opener-Policy") != "same-origin" {
			t.Fatal("missing Cross-Origin-Opener-Policy header")
		}
		if response.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatal("missing X-Frame-Options header")
		}
		if response.Header().Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
			t.Fatal("tile-compatible Referrer-Policy header is missing")
		}
		if !strings.Contains(response.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
			t.Fatal("content security policy does not prevent framing")
		}
	})

	t.Run("rejects an unexpected host", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "http://unexpected.local/", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusMisdirectedRequest {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusMisdirectedRequest)
		}
	})

	t.Run("rejects traversal", func(t *testing.T) {
		response := performRequest(t, handler, http.MethodGet, "/../secret.txt")
		if response.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
		}
	})

	t.Run("rejects unsupported methods", func(t *testing.T) {
		response := performRequest(t, handler, http.MethodPost, "/")
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
		}
		if response.Header().Get("Allow") != "GET, HEAD" {
			t.Fatalf("Allow = %q, want GET, HEAD", response.Header().Get("Allow"))
		}
	})

	t.Run("returns 404 for missing assets", func(t *testing.T) {
		response := performRequest(t, handler, http.MethodGet, "/missing.js")
		if response.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
		}
	})

	t.Run("serves app shell for client route", func(t *testing.T) {
		response := performRequest(t, handler, http.MethodGet, "/repair")
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
		}
		body, err := io.ReadAll(response.Result().Body)
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != "app shell" {
			t.Fatalf("body = %q, want app shell", body)
		}
	})
}

func TestReadPackageHealthResponse(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(root, "VERSION.txt"),
		[]byte("Version: 1.2.3\nRevision: abc123\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	response, err := readPackageHealthResponse(root)
	if err != nil {
		t.Fatal(err)
	}
	if response != "FixYourTrack/1.2.3/abc123" {
		t.Fatalf("health response = %q", response)
	}
}

func performRequest(t *testing.T, handler http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "http://"+appAddress+path, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
