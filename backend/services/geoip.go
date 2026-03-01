package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type GeoIPResult struct {
	Country   string
	Region    string
	City      string
	Latitude  *float64
	Longitude *float64
	Timezone  string
}

type geoCacheEntry struct {
	res       *GeoIPResult
	expiresAt time.Time
}

var (
	geoMu    sync.Mutex
	geoCache = map[string]geoCacheEntry{}
)

func geoProvider() string {
	return strings.TrimSpace(strings.ToLower(os.Getenv("GEOIP_PROVIDER")))
}

func geoTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GEOIP_TIMEOUT_MS"))
	if raw == "" {
		return 1500 * time.Millisecond
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 100 || ms > 10_000 {
		return 1500 * time.Millisecond
	}
	return time.Duration(ms) * time.Millisecond
}

func geoCacheTTL() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GEOIP_CACHE_TTL_MINUTES"))
	if raw == "" {
		return 24 * time.Hour
	}
	mins, err := strconv.Atoi(raw)
	if err != nil || mins <= 0 || mins > 24*7*60 {
		return 24 * time.Hour
	}
	return time.Duration(mins) * time.Minute
}

func isPublicIP(ip net.IP) bool {
	// Skip private/reserved ranges. We only want internet-origin IPs.
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	// Treat unspecified as non-public.
	if ip.IsUnspecified() {
		return false
	}
	return true
}

func cachedGeo(ip string) *GeoIPResult {
	geoMu.Lock()
	defer geoMu.Unlock()
	if e, ok := geoCache[ip]; ok {
		if time.Now().Before(e.expiresAt) {
			return e.res
		}
		delete(geoCache, ip)
	}
	return nil
}

func putGeo(ip string, res *GeoIPResult) {
	geoMu.Lock()
	defer geoMu.Unlock()
	geoCache[ip] = geoCacheEntry{res: res, expiresAt: time.Now().Add(geoCacheTTL())}
}

func LookupGeoIP(ipStr string) (*GeoIPResult, error) {
	ipStr = strings.TrimSpace(ipStr)
	if ipStr == "" {
		return nil, errors.New("missing ip")
	}

	if res := cachedGeo(ipStr); res != nil {
		return res, nil
	}

	ip := net.ParseIP(ipStr)
	if ip == nil {
		return nil, errors.New("invalid ip")
	}
	if !isPublicIP(ip) {
		return nil, errors.New("non-public ip")
	}

	p := geoProvider()
	switch p {
	case "", "disabled", "off", "none":
		return nil, errors.New("geoip disabled (set GEOIP_PROVIDER)")
	case "ipapi":
		return lookupIPAPI(ipStr)
	case "ipinfo":
		return lookupIPInfo(ipStr)
	case "ipwhois", "ipwho.is":
		return lookupIPWhoIs(ipStr)
	default:
		return nil, fmt.Errorf("unsupported GEOIP_PROVIDER: %s", p)
	}
}

func httpClient() *http.Client {
	// No keepalive tuning needed here; low QPS + cached.
	return &http.Client{Timeout: geoTimeout()}
}

func lookupIPAPI(ip string) (*GeoIPResult, error) {
	// Free-ish service. No token by default. Subject to rate limits.
	// https://ipapi.co/<ip>/json/
	u := fmt.Sprintf("https://ipapi.co/%s/json/", ip)
	ctx, cancel := context.WithTimeout(context.Background(), geoTimeout())
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var body struct {
		CountryName string   `json:"country_name"`
		Region      string   `json:"region"`
		City        string   `json:"city"`
		Latitude    *float64 `json:"latitude"`
		Longitude   *float64 `json:"longitude"`
		Timezone    string   `json:"timezone"`
		Error       bool     `json:"error"`
		Reason      string   `json:"reason"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Error {
		return nil, fmt.Errorf("ipapi error: %s", body.Reason)
	}

	res := &GeoIPResult{
		Country:   strings.TrimSpace(body.CountryName),
		Region:    strings.TrimSpace(body.Region),
		City:      strings.TrimSpace(body.City),
		Latitude:  body.Latitude,
		Longitude: body.Longitude,
		Timezone:  strings.TrimSpace(body.Timezone),
	}
	putGeo(ip, res)
	return res, nil
}

func lookupIPInfo(ip string) (*GeoIPResult, error) {
	// Requires GEOIP_TOKEN.
	// https://ipinfo.io/<ip>/json?token=...
	token := strings.TrimSpace(os.Getenv("GEOIP_TOKEN"))
	if token == "" {
		return nil, errors.New("missing GEOIP_TOKEN for ipinfo provider")
	}
	u := fmt.Sprintf("https://ipinfo.io/%s/json?token=%s", ip, token)

	ctx, cancel := context.WithTimeout(context.Background(), geoTimeout())
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var body struct {
		Country  string `json:"country"`
		Region   string `json:"region"`
		City     string `json:"city"`
		Loc      string `json:"loc"` // "lat,lon"
		Timezone string `json:"timezone"`
		Error    struct {
			Title   string `json:"title"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Error.Title != "" {
		return nil, fmt.Errorf("ipinfo error: %s", body.Error.Message)
	}

	var latPtr *float64
	var lonPtr *float64
	if strings.Contains(body.Loc, ",") {
		parts := strings.SplitN(body.Loc, ",", 2)
		if lat, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64); err == nil {
			if lon, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
				latPtr = &lat
				lonPtr = &lon
			}
		}
	}

	res := &GeoIPResult{
		Country:   strings.TrimSpace(body.Country),
		Region:    strings.TrimSpace(body.Region),
		City:      strings.TrimSpace(body.City),
		Latitude:  latPtr,
		Longitude: lonPtr,
		Timezone:  strings.TrimSpace(body.Timezone),
	}
	putGeo(ip, res)
	return res, nil
}

func lookupIPWhoIs(ip string) (*GeoIPResult, error) {
	// Free provider without token: https://ipwho.is/<ip>
	u := fmt.Sprintf("https://ipwho.is/%s", ip)

	ctx, cancel := context.WithTimeout(context.Background(), geoTimeout())
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var body struct {
		Success   bool     `json:"success"`
		Message   string   `json:"message"`
		Country   string   `json:"country"`
		Region    string   `json:"region"`
		City      string   `json:"city"`
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
		Timezone  struct {
			ID string `json:"id"`
		} `json:"timezone"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if !body.Success {
		if body.Message == "" {
			body.Message = "lookup failed"
		}
		return nil, fmt.Errorf("ipwhois error: %s", body.Message)
	}

	res := &GeoIPResult{
		Country:   strings.TrimSpace(body.Country),
		Region:    strings.TrimSpace(body.Region),
		City:      strings.TrimSpace(body.City),
		Latitude:  body.Latitude,
		Longitude: body.Longitude,
		Timezone:  strings.TrimSpace(body.Timezone.ID),
	}
	putGeo(ip, res)
	return res, nil
}
