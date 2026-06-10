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

const healthResponse = "FixYourTrack"

func main() {
	if len(os.Args) != 3 {
		log.Fatal("usage: fixyourtrack-server APP_DIRECTORY RUNTIME_DIRECTORY")
	}

	appRoot, err := filepath.Abs(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	runtimeRoot, err := filepath.Abs(os.Args[2])
	if err != nil {
		log.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(appRoot, "index.html")); err != nil {
		log.Fatalf("app/index.html was not found: %v", err)
	}
	if err := os.MkdirAll(runtimeRoot, 0o755); err != nil {
		log.Fatal(err)
	}

	listener, url, err := listen()
	if err != nil {
		log.Fatal(err)
	}

	pidPath := filepath.Join(runtimeRoot, "server.pid")
	urlPath := filepath.Join(runtimeRoot, "server.url")
	if err := os.WriteFile(pidPath, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0o644); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(urlPath, []byte(url+"\n"), 0o644); err != nil {
		log.Fatal(err)
	}
	defer removeOwnedRuntimeFiles(pidPath, urlPath)

	server := &http.Server{
		Handler:           appHandler(appRoot),
		ReadHeaderTimeout: 5 * time.Second,
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
		log.Fatal(err)
	}
	select {
	case <-stopped:
	default:
	}
}

func listen() (net.Listener, string, error) {
	for port := 4173; port <= 4183; port++ {
		address := fmt.Sprintf("127.0.0.1:%d", port)
		listener, err := net.Listen("tcp4", address)
		if err == nil {
			return listener, "http://" + address + "/", nil
		}
	}
	return nil, "", errors.New("no free local port was found between 4173 and 4183")
}

func appHandler(appRoot string) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")

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
			target = filepath.Join(appRoot, "index.html")
		}

		http.ServeFile(response, request, target)
	})
}

func removeOwnedRuntimeFiles(pidPath, urlPath string) {
	pidBytes, err := os.ReadFile(pidPath)
	if err == nil && strings.TrimSpace(string(pidBytes)) == fmt.Sprintf("%d", os.Getpid()) {
		_ = os.Remove(pidPath)
		_ = os.Remove(urlPath)
	}
}
