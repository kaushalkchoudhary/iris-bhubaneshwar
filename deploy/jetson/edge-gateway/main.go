package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type edgeState struct {
	WorkerID  string `json:"worker_id"`
	AuthToken string `json:"auth_token"`
}

type stateCache struct {
	mu    sync.RWMutex
	state edgeState
}

func (s *stateCache) set(st edgeState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = st
}

func (s *stateCache) get() edgeState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func env(key, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func shouldAttachWorkerHeaders(path string) bool {
	if strings.HasPrefix(path, "/api/events/") {
		return true
	}
	if strings.HasPrefix(path, "/api/vehicles/") {
		return true
	}
	if strings.HasPrefix(path, "/api/violations/") {
		return true
	}
	if strings.HasPrefix(path, "/api/workers/") {
		return true
	}
	return false
}

func loadState(path string) edgeState {
	raw, err := os.ReadFile(path)
	if err != nil {
		return edgeState{}
	}
	var st edgeState
	if err := json.Unmarshal(raw, &st); err != nil {
		return edgeState{}
	}
	st.WorkerID = strings.TrimSpace(st.WorkerID)
	st.AuthToken = strings.TrimSpace(st.AuthToken)
	return st
}

func startStateWatcher(path string, cache *stateCache) {
	go func() {
		var lastMod time.Time
		for {
			info, err := os.Stat(path)
			if err != nil {
				time.Sleep(2 * time.Second)
				continue
			}
			if info.ModTime().After(lastMod) {
				st := loadState(path)
				cache.set(st)
				lastMod = info.ModTime()
			}
			time.Sleep(2 * time.Second)
		}
	}()
}

func main() {
	bindAddr := env("EDGE_GATEWAY_BIND", "127.0.0.1:3900")
	serverURL := strings.TrimRight(env("EDGE_SERVER_URL", "http://127.0.0.1:3002"), "/")
	statePath := env("EDGE_STATE_PATH", "/var/lib/iris-edge/state.json")

	cache := &stateCache{}
	cache.set(loadState(statePath))
	startStateWatcher(statePath, cache)

	client := &http.Client{
		Timeout: 90 * time.Second,
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		st := cache.get()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":      "ok",
			"server_url":  serverURL,
			"worker_id":   st.WorkerID,
			"has_token":   st.AuthToken != "",
			"state_path":  statePath,
			"binary_path": filepath.Clean(os.Args[0]),
		})
	})

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		targetURL := serverURL + r.URL.Path
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}

		req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
		if err != nil {
			http.Error(w, "failed to create upstream request", http.StatusInternalServerError)
			return
		}
		req.ContentLength = r.ContentLength
		req.Header = r.Header.Clone()
		req.Host = ""

		if shouldAttachWorkerHeaders(r.URL.Path) {
			st := cache.get()
			if req.Header.Get("X-Worker-ID") == "" && st.WorkerID != "" {
				req.Header.Set("X-Worker-ID", st.WorkerID)
			}
			if req.Header.Get("X-Auth-Token") == "" && st.AuthToken != "" {
				req.Header.Set("X-Auth-Token", st.AuthToken)
			}
		}

		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "upstream request failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		for k, vals := range resp.Header {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})

	srv := &http.Server{
		Addr:              bindAddr,
		Handler:           mux,
		ReadTimeout:       30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("IRIS edge gateway listening on %s -> %s", bindAddr, serverURL)

	go func() {
		<-context.Background().Done()
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("gateway failed: %v", err)
	}
}
