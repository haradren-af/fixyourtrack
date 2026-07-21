package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const healthResponsePrefix = "FixYourTrack"
const appAddress = "127.0.0.1:4173"
const contentSecurityPolicy = "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com; connect-src 'self' https://tile.openstreetmap.org https://server.arcgisonline.com https://router.project-osrm.org https://brouter.de https://routing.openstreetmap.de https://api.open-elevation.com; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 3 {
		return fmt.Errorf("usage: fixyourtrack-server APP_DIRECTORY RUNTIME_DIRECTORY")
	}

	appRoot, err := filepath.Abs(os.Args[1])
	if err != nil {
		return err
	}
	runtimeRoot, err := filepath.Abs(os.Args[2])
	if err != nil {
		return err
	}

	if _, err := os.Stat(filepath.Join(appRoot, "index.html")); err != nil {
		return fmt.Errorf("app/index.html was not found: %w", err)
	}
	healthResponse, err := readPackageHealthResponse(filepath.Dir(appRoot))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(runtimeRoot, 0o755); err != nil {
		return err
	}

	listener, url, err := listen()
	if err != nil {
		return err
	}
	defer listener.Close()

	pidPath := filepath.Join(runtimeRoot, "server.pid")
	urlPath := filepath.Join(runtimeRoot, "server.url")
	if err := os.WriteFile(pidPath, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(urlPath, []byte(url+"\n"), 0o644); err != nil {
		return err
	}
	defer removeOwnedRuntimeFiles(pidPath, urlPath)

	server := &http.Server{
		Handler:           appHandler(appRoot, healthResponse),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}

	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
		<-signals

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	log.Printf("FixYourTrack server started at %s", url)
	err = server.Serve(listener)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	select {
	case <-stopped:
	default:
	}
	return nil
}

func listen() (net.Listener, string, error) {
	listener, err := net.Listen("tcp4", appAddress)
	if err != nil {
		return nil, "", fmt.Errorf("local port 4173 is unavailable; close the program using it, then start FixYourTrack again: %w", err)
	}
	return listener, "http://" + appAddress + "/", nil
}

func appHandler(appRoot string, healthResponse string) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		response.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		response.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		response.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		response.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("X-Frame-Options", "DENY")

		if request.Host != appAddress {
			http.Error(response, "misdirected request", http.StatusMisdirectedRequest)
			return
		}

		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			response.Header().Set("Allow", "GET, HEAD")
			http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if request.URL.Path == "/__health" {
			response.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = response.Write([]byte(healthResponse))
			return
		}

		requestPath := request.URL.Path
		if requestPath == "" || requestPath == "/" {
			requestPath = "/index.html"
		}

		target := filepath.Join(appRoot, filepath.FromSlash(strings.TrimPrefix(requestPath, "/")))
		relative, err := filepath.Rel(appRoot, target)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			http.Error(response, "forbidden", http.StatusForbidden)
			return
		}

		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			if filepath.Ext(requestPath) != "" {
				http.NotFound(response, request)
				return
			}
			target = filepath.Join(appRoot, "index.html")
		}

		http.ServeFile(response, request, target)
	})
}

func readPackageHealthResponse(packageRoot string) (string, error) {
	content, err := os.ReadFile(filepath.Join(packageRoot, "VERSION.txt"))
	if err != nil {
		return "", fmt.Errorf("VERSION.txt could not be read: %w", err)
	}
	var version string
	var revision string
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Version: ") {
			version = strings.TrimSpace(strings.TrimPrefix(line, "Version: "))
		}
		if strings.HasPrefix(line, "Revision: ") {
			revision = strings.TrimSpace(strings.TrimPrefix(line, "Revision: "))
		}
	}
	if version == "" || revision == "" {
		return "", fmt.Errorf("VERSION.txt does not contain a version and revision")
	}
	return healthResponsePrefix + "/" + version + "/" + revision, nil
}

func removeOwnedRuntimeFiles(pidPath, urlPath string) {
	pidBytes, err := os.ReadFile(pidPath)
	if err == nil && strings.TrimSpace(string(pidBytes)) == fmt.Sprintf("%d", os.Getpid()) {
		_ = os.Remove(pidPath)
		_ = os.Remove(urlPath)
	}
}
