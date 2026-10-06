// sha3.si quantum-safety checker.
//
// GET /check?host=example.com connects to https://example.com twice:
//   1. offering ONLY the hybrid post-quantum group X25519MLKEM768 (ML-KEM, FIPS 203).
//      If the handshake completes, the site supports post-quantum key exchange.
//   2. a normal handshake, to read the TLS version, cipher and certificate.
//
// It only ever dials port 443 of a public IP it resolved and vetted itself, so it
// cannot be pointed at internal networks. Results are cached, callers are rate
// limited, and nothing about who checked what is logged.
package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	dialTimeout   = 6 * time.Second
	resolveTO     = 4 * time.Second
	cacheTTL      = 10 * time.Minute
	ratePerMinute = 8
	maxInFlight   = 20
)

var allowedOrigins = map[string]bool{
	"https://sha3.si":     true,
	"https://www.sha3.si": true,
	"http://sha3.si":      true,
	"http://localhost:8791": true,
	"http://127.0.0.1:8791": true,
}

// ---------------------------------------------------------------- result types

type PQResult struct {
	Supported bool   `json:"supported"`
	Group     string `json:"group,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

type TLSResult struct {
	Version     string `json:"version"`
	Cipher      string `json:"cipher"`
	TLS13       bool   `json:"tls13"`
	DefaultKEX  string `json:"default_key_exchange,omitempty"`
}

type CertResult struct {
	Subject       string `json:"subject"`
	Issuer        string `json:"issuer"`
	KeyType       string `json:"key_type"`
	Signature     string `json:"signature"`
	NotAfter      string `json:"not_after"`
	DaysLeft      int    `json:"days_left"`
	Valid         bool   `json:"valid"`
	ValidError    string `json:"valid_error,omitempty"`
	QuantumSafe   bool   `json:"quantum_safe"`
}

type Result struct {
	Host      string      `json:"host"`
	CheckedAt string      `json:"checked_at"`
	Reachable bool        `json:"reachable"`
	Error     string      `json:"error,omitempty"`
	PQ        *PQResult   `json:"pq_key_exchange,omitempty"`
	TLS       *TLSResult  `json:"tls,omitempty"`
	Cert      *CertResult `json:"certificate,omitempty"`
	Score     int         `json:"score"`
	MaxScore  int         `json:"max_score"`
	Verdict   string      `json:"verdict"`
	Advice    []string    `json:"advice,omitempty"`
	Cached    bool        `json:"cached"`
}

// ---------------------------------------------------------------- input

var hostRe = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$`)

// normalizeHost accepts "Example.com", "https://example.com/path", "example.com:443".
func normalizeHost(raw string) (string, error) {
	h := strings.TrimSpace(strings.ToLower(raw))
	for _, p := range []string{"https://", "http://"} {
		h = strings.TrimPrefix(h, p)
	}
	if i := strings.IndexAny(h, "/?#"); i >= 0 {
		h = h[:i]
	}
	if i := strings.LastIndex(h, "@"); i >= 0 { // drop userinfo
		h = h[i+1:]
	}
	if hp, port, err := net.SplitHostPort(h); err == nil {
		if port != "443" {
			return "", errors.New("only port 443 (https) can be checked")
		}
		h = hp
	}
	h = strings.TrimSuffix(h, ".")
	if h == "" || len(h) > 253 {
		return "", errors.New("enter a website address, for example example.com")
	}
	if _, err := netip.ParseAddr(h); err == nil {
		return "", errors.New("enter a domain name, not an IP address")
	}
	if !hostRe.MatchString(h) {
		return "", errors.New("that does not look like a valid domain name")
	}
	last := h[strings.LastIndex(h, ".")+1:]
	if !strings.ContainsAny(last, "abcdefghijklmnopqrstuvwxyz") {
		return "", errors.New("that does not look like a valid domain name")
	}
	for _, bad := range []string{"localhost", ".local", ".internal", ".lan", ".home.arpa", ".corp"} {
		if h == strings.TrimPrefix(bad, ".") || strings.HasSuffix(h, bad) {
			return "", errors.New("internal names cannot be checked")
		}
	}
	return h, nil
}

// ---------------------------------------------------------------- SSRF guard

var blocked = func() []netip.Prefix {
	var ps []netip.Prefix
	for _, s := range []string{
		"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
		"172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15",
		"198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
		"::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32", "100::/64",
	} {
		ps = append(ps, netip.MustParsePrefix(s))
	}
	return ps
}()

var nat64 = netip.MustParsePrefix("64:ff9b::/96")

// isPublic reports whether ip may be dialled. NAT64 (64:ff9b::/96) and
// IPv4-mapped addresses are judged by the IPv4 address they carry.
func isPublic(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.Is6() && nat64.Contains(ip) {
		b := ip.As16()
		ip = netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]})
	}
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsMulticast() || ip.IsUnspecified() || !ip.IsGlobalUnicast() {
		return false
	}
	for _, p := range blocked {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// resolve returns one vetted public address for host; any non-public answer
// rejects the whole host, so DNS cannot mix in an internal target.
func resolve(ctx context.Context, host string) (netip.Addr, error) {
	ctx, cancel := context.WithTimeout(ctx, resolveTO)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(addrs) == 0 {
		return netip.Addr{}, errors.New("this domain does not resolve (check the spelling)")
	}
	var pick netip.Addr
	for _, a := range addrs {
		if !isPublic(a) {
			return netip.Addr{}, errors.New("this domain points to a private or reserved address, which cannot be checked")
		}
		if !pick.IsValid() || (a.Unmap().Is4() && !pick.Unmap().Is4()) {
			pick = a.Unmap()
		}
	}
	return pick, nil
}

// ---------------------------------------------------------------- probes

func handshake(ctx context.Context, ip netip.Addr, host string, curves []tls.CurveID, minVer uint16) (*tls.ConnectionState, error) {
	d := net.Dialer{Timeout: dialTimeout}
	ctx, cancel := context.WithTimeout(ctx, dialTimeout+2*time.Second)
	defer cancel()
	raw, err := d.DialContext(ctx, "tcp", netip.AddrPortFrom(ip, 443).String())
	if err != nil {
		return nil, err
	}
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(dialTimeout))
	cfg := &tls.Config{
		ServerName:         host,
		InsecureSkipVerify: true, // we verify ourselves below, so invalid certs still get a report
		MinVersion:         minVer,
		CurvePreferences:   curves,
		NextProtos:         []string{"h2", "http/1.1"},
	}
	c := tls.Client(raw, cfg)
	if err := c.HandshakeContext(ctx); err != nil {
		return nil, err
	}
	st := c.ConnectionState()
	return &st, nil
}

func keyType(cert *x509.Certificate) string {
	switch k := cert.PublicKey.(type) {
	case *rsa.PublicKey:
		return fmt.Sprintf("RSA %d-bit", k.N.BitLen())
	case *ecdsa.PublicKey:
		return "ECDSA " + k.Curve.Params().Name
	case ed25519.PublicKey:
		return "Ed25519"
	default:
		return cert.PublicKeyAlgorithm.String()
	}
}

func certInfo(st *tls.ConnectionState, host string) *CertResult {
	if len(st.PeerCertificates) == 0 {
		return nil
	}
	leaf := st.PeerCertificates[0]
	inter := x509.NewCertPool()
	for _, c := range st.PeerCertificates[1:] {
		inter.AddCert(c)
	}
	_, verr := leaf.Verify(x509.VerifyOptions{DNSName: host, Intermediates: inter})
	issuer := leaf.Issuer.CommonName
	if len(leaf.Issuer.Organization) > 0 {
		issuer = leaf.Issuer.Organization[0] + " (" + leaf.Issuer.CommonName + ")"
	}
	kt := keyType(leaf)
	cr := &CertResult{
		Subject:   leaf.Subject.CommonName,
		Issuer:    issuer,
		KeyType:   kt,
		Signature: leaf.SignatureAlgorithm.String(),
		NotAfter:  leaf.NotAfter.UTC().Format("2006-01-02"),
		DaysLeft:  int(time.Until(leaf.NotAfter).Hours() / 24),
		Valid:     verr == nil,
		// No public CA issues ML-DSA certificates yet, so every site is classical here.
		QuantumSafe: strings.Contains(strings.ToUpper(kt), "ML-DSA"),
	}
	if verr != nil {
		cr.ValidError = verr.Error()
	}
	return cr
}

func curveName(id tls.CurveID) string {
	switch id {
	case tls.X25519MLKEM768:
		return "X25519MLKEM768 (hybrid post-quantum)"
	case tls.X25519:
		return "X25519 (classical)"
	case tls.CurveP256:
		return "P-256 (classical)"
	case tls.CurveP384:
		return "P-384 (classical)"
	case tls.CurveP521:
		return "P-521 (classical)"
	case 0:
		return ""
	default:
		return id.String()
	}
}

func check(ctx context.Context, host string) Result {
	r := Result{Host: host, CheckedAt: time.Now().UTC().Format(time.RFC3339), MaxScore: 3}
	ip, err := resolve(ctx, host)
	if err != nil {
		r.Error = err.Error()
		r.Verdict = "Could not check this site."
		return r
	}

	// 1. post-quantum only
	pq := &PQResult{}
	pqState, pqErr := handshake(ctx, ip, host, []tls.CurveID{tls.X25519MLKEM768}, tls.VersionTLS13)
	if pqErr == nil {
		pq.Supported = true
		pq.Group = curveName(tls.X25519MLKEM768)
	}

	// 2. normal handshake for the rest of the report
	st, err := handshake(ctx, ip, host, nil, tls.VersionTLS12)
	if err != nil && pqState == nil {
		r.Error = "could not open an https connection to this site (" + shortErr(err) + ")"
		r.Verdict = "Could not check this site."
		return r
	}
	if st == nil {
		st = pqState
	}
	r.Reachable = true
	r.PQ = pq
	if !pq.Supported {
		pq.Detail = "The server refused a handshake that offered only post-quantum key exchange."
	}
	r.TLS = &TLSResult{
		Version:    tls.VersionName(st.Version),
		Cipher:     tls.CipherSuiteName(st.CipherSuite),
		TLS13:      st.Version == tls.VersionTLS13,
		DefaultKEX: curveName(st.CurveID),
	}
	r.Cert = certInfo(st, host)

	if pq.Supported {
		r.Score += 2
	}
	if r.TLS.TLS13 {
		r.Score++
	}
	switch {
	case pq.Supported:
		r.Verdict = "Quantum-safe key exchange: traffic to this site is protected against harvest-now, decrypt-later attacks."
	case r.TLS.TLS13:
		r.Verdict = "Not quantum-safe: modern TLS 1.3, but no post-quantum key exchange. Recorded traffic could be decrypted by a future quantum computer."
	default:
		r.Verdict = "Not quantum-safe, and not on TLS 1.3. Upgrading TLS is the first step."
	}
	if !pq.Supported {
		r.Advice = append(r.Advice,
			"Enable the hybrid group X25519MLKEM768. It is on by default with Cloudflare, Go 1.24+ servers and Caddy built with Go 1.24+.",
			"nginx or Apache built against OpenSSL 3.5 or later: list X25519MLKEM768 first in the key-exchange groups (nginx: ssl_ecdh_curve X25519MLKEM768:X25519;).",
			"Behind a CDN or cloud load balancer? Look for its post-quantum TLS option; several now offer one.")
	}
	if !r.TLS.TLS13 {
		r.Advice = append(r.Advice, "Turn on TLS 1.3: post-quantum key exchange is only defined for TLS 1.3.")
	}
	if r.Cert != nil && !r.Cert.Valid {
		r.Advice = append(r.Advice, "The certificate did not validate for this name: "+r.Cert.ValidError)
	}
	return r
}

func shortErr(err error) string {
	s := err.Error()
	switch {
	case strings.Contains(s, "timeout"), strings.Contains(s, "deadline"):
		return "timed out"
	case strings.Contains(s, "refused"):
		return "connection refused on port 443"
	case strings.Contains(s, "reset"):
		return "connection reset"
	}
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

// ---------------------------------------------------------------- rate limit and cache

type limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cut := now.Add(-time.Minute)
	ts := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			ts = append(ts, t)
		}
	}
	if len(ts) >= ratePerMinute {
		l.hits[key] = ts
		return false
	}
	l.hits[key] = append(ts, now)
	return true
}

func (l *limiter) sweep() {
	for range time.Tick(5 * time.Minute) {
		l.mu.Lock()
		cut := time.Now().Add(-time.Minute)
		for k, ts := range l.hits {
			if len(ts) == 0 || ts[len(ts)-1].Before(cut) {
				delete(l.hits, k)
			}
		}
		l.mu.Unlock()
	}
}

type cacheEntry struct {
	r   Result
	exp time.Time
}

var (
	cacheMu sync.Mutex
	cache   = map[string]cacheEntry{}
	slots   = make(chan struct{}, maxInFlight)
	lim     = &limiter{hits: map[string][]time.Time{}}
	checks  int64
)

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		return strings.TrimSpace(strings.Split(xf, ",")[0])
	}
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return h
}

// ---------------------------------------------------------------- HTTP

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func cors(w http.ResponseWriter, r *http.Request) {
	if o := r.Header.Get("Origin"); allowedOrigins[o] {
		w.Header().Set("Access-Control-Allow-Origin", o)
		w.Header().Set("Vary", "Origin")
	}
}

func handleCheck(w http.ResponseWriter, r *http.Request) {
	cors(w, r)
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET only"})
		return
	}
	host, err := normalizeHost(r.URL.Query().Get("host"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	cacheMu.Lock()
	if e, ok := cache[host]; ok && time.Now().Before(e.exp) {
		cacheMu.Unlock()
		res := e.r
		res.Cached = true
		writeJSON(w, http.StatusOK, res)
		return
	}
	cacheMu.Unlock()

	if !lim.allow(clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many checks; please wait a minute"})
		return
	}
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "busy; please try again in a moment"})
		return
	}
	res := check(r.Context(), host)
	cacheMu.Lock()
	cache[host] = cacheEntry{r: res, exp: time.Now().Add(cacheTTL)}
	if len(cache) > 5000 { // crude bound; entries are tiny
		for k, e := range cache {
			if time.Now().After(e.exp) {
				delete(cache, k)
			}
		}
	}
	checks++
	cacheMu.Unlock()
	writeJSON(w, http.StatusOK, res)
}

func main() {
	go lim.sweep()
	mux := http.NewServeMux()
	mux.HandleFunc("/check", handleCheck)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		cacheMu.Lock()
		n := checks
		cacheMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "checks": n})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://sha3.si/quantum-safe/", http.StatusFound)
	})
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    8 << 10,
	}
	log.Printf("sha3.si checker listening on :%s", port)
	log.Fatal(srv.ListenAndServe())
}
